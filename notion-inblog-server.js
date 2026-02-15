const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

loadEnvFromFile(path.join(process.cwd(), '.env.notion.local'));

const PORT = Number(process.env.PORT || 8787);
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';
const CATEGORIES_DB_ID = process.env.NOTION_CATEGORIES_DB_ID || '';
const ARTICLES_DB_ID = process.env.NOTION_ARTICLES_DB_ID || '';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30000);
const ENABLE_ADMIN_PAGE = process.env.ENABLE_ADMIN_PAGE === 'true';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '*';
const ALLOWED_STATIC = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/script.js', 'script.js'],
  ['/favicon.ico', 'favicon.ico'],
  ['/robots.txt', 'robots.txt'],
]);

const cache = {
  at: 0,
  payload: null,
  refreshPromise: null,
};
const CACHE_FILE_PATH = path.join(process.cwd(), '.notion-cache.json');
const rateLimitMap = new Map();

function loadDiskCache() {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) return;
    const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.groups)) {
      cache.payload = parsed;
      cache.at = Date.now();
    }
  } catch (_) {
    // ignore invalid disk cache
  }
}

function saveDiskCache(payload) {
  try {
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (_) {
    // ignore disk cache write error
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': PUBLIC_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(text);
}

function getMimeType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  if (filePath.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(res, urlPath) {
  const fileName = ALLOWED_STATIC.get(urlPath);
  if (!fileName) return false;
  if (fileName === 'robots.txt' && !fs.existsSync(path.join(process.cwd(), fileName))) {
    const body = 'User-agent: *\nDisallow: /admin.html\n';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
    return true;
  }

  const absolutePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(absolutePath)) return false;

  const body = fs.readFileSync(absolutePath);
  res.writeHead(200, {
    'Content-Type': getMimeType(absolutePath),
    'Cache-Control': fileName.endsWith('.html') ? 'no-store' : 'public, max-age=600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
  return true;
}

function clientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.length) return xfwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function isRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 120;
  const times = rateLimitMap.get(ip) || [];
  const recent = times.filter((t) => now - t < windowMs);
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return recent.length > limit;
}

function assertEnv() {
  const missing = [];
  if (!NOTION_TOKEN) missing.push('NOTION_TOKEN');
  if (!CATEGORIES_DB_ID) missing.push('NOTION_CATEGORIES_DB_ID');
  if (!ARTICLES_DB_ID) missing.push('NOTION_ARTICLES_DB_ID');
  return missing;
}

function slugify(input) {
  const text = String(input || '').trim().toLowerCase();
  return text
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'untitled';
}

function firstDefined(obj, names) {
  for (const name of names) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, name)) {
      return obj[name];
    }
  }
  return undefined;
}

function richTextToString(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map((node) => node.plain_text || '').join('').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function richTextToHtml(arr) {
  if (!Array.isArray(arr)) return '';

  return arr
    .map((node) => {
      const annotations = node.annotations || {};
      let text = escapeHtml(node.plain_text || '').replace(/\n/g, '<br/>');
      if (!text) return '';

      if (node.href) {
        const href = escapeHtml(node.href);
        text = `<a href="${href}" target="_blank" rel="noreferrer noopener">${text}</a>`;
      }
      if (annotations.code) text = `<code>${text}</code>`;
      if (annotations.bold) text = `<strong>${text}</strong>`;
      if (annotations.italic) text = `<em>${text}</em>`;
      if (annotations.underline) text = `<u>${text}</u>`;
      if (annotations.strikethrough) text = `<s>${text}</s>`;

      if (annotations.color && annotations.color !== 'default') {
        text = `<span data-notion-color="${escapeHtml(annotations.color)}">${text}</span>`;
      }

      return text;
    })
    .join('');
}

function blockToInlineHtml(block) {
  const type = block.type;
  if (type === 'paragraph' || type === 'quote' || type === 'callout' || type === 'to_do' || type === 'code') {
    return richTextToHtml(getBlockRichText(block));
  }
  if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
    return richTextToHtml(getBlockRichText(block));
  }
  return '';
}

function propTitle(props, names) {
  const prop = firstDefined(props, names);
  if (!prop) return '';
  if (prop.type === 'title') return richTextToString(prop.title);
  if (prop.type === 'rich_text') return richTextToString(prop.rich_text);
  return '';
}

function propText(props, names) {
  const prop = firstDefined(props, names);
  if (!prop) return '';
  if (prop.type === 'rich_text') return richTextToString(prop.rich_text);
  if (prop.type === 'title') return richTextToString(prop.title);
  return '';
}

function propNumber(props, names, fallback = 0) {
  const prop = firstDefined(props, names);
  if (!prop) return fallback;
  if (prop.type === 'number' && typeof prop.number === 'number') return prop.number;
  return fallback;
}

function propCheckbox(props, names, fallback = true) {
  const prop = firstDefined(props, names);
  if (!prop) return fallback;
  if (prop.type === 'checkbox') return Boolean(prop.checkbox);
  return fallback;
}

function propSelect(props, names, fallback = '') {
  const prop = firstDefined(props, names);
  if (!prop) return fallback;
  if (prop.type === 'select') return (prop.select && prop.select.name) || fallback;
  return fallback;
}

function propRelationIds(props, names) {
  const prop = firstDefined(props, names);
  if (!prop) return [];
  if (prop.type === 'relation' && Array.isArray(prop.relation)) {
    return prop.relation.map((entry) => entry.id).filter(Boolean);
  }
  return [];
}

async function notionFetch(path, method = 'GET', body, attempt = 0) {
  const response = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const jsonBody = await response.json();
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1200 * (attempt + 1);
      await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : 1200 * (attempt + 1));
      return notionFetch(path, method, body, attempt + 1);
    }
    const message = jsonBody && jsonBody.message ? jsonBody.message : 'Unknown Notion API error';
    throw new Error(`Notion API ${response.status}: ${message}`);
  }

  return jsonBody;
}

async function queryAllPages(databaseId) {
  const pages = [];
  let cursor = undefined;

  while (true) {
    const payload = await notionFetch(`/v1/databases/${databaseId}/query`, 'POST', {
      page_size: 100,
      start_cursor: cursor,
    });

    pages.push(...(payload.results || []));
    if (!payload.has_more) break;
    cursor = payload.next_cursor;
  }

  return pages;
}

async function getPageBlocks(pageId) {
  const blocks = [];
  let cursor = undefined;

  while (true) {
    const payload = await notionFetch(
      `/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
    );

    const results = payload.results || [];
    for (const block of results) {
      if (block.has_children && block.type === 'toggle') {
        try {
          const childPayload = await notionFetch(`/v1/blocks/${block.id}/children?page_size=100`);
          block.__children = childPayload.results || [];
        } catch (_) {
          block.__children = [];
        }
      }
      blocks.push(block);
    }

    if (!payload.has_more) break;
    cursor = payload.next_cursor;
  }

  return blocks;
}

function getBlockRichText(block) {
  const type = block.type;
  const payload = block[type];
  if (!payload) return [];
  return payload.rich_text || [];
}

function blockPlainTextFallback(block) {
  const rich = getBlockRichText(block);
  const text = richTextToString(rich);
  return text || '';
}

function parseSectionsFromBlocks(blocks, defaultTitle) {
  const sections = [];
  let current = {
    id: 'sec_1',
    subtitle: `${defaultTitle} 소개`,
    level: 2,
    body_html: '',
    body: '',
  };

  function flushCurrent() {
    if (current.body_html || current.body) {
      sections.push(current);
    }
  }

  let secIndex = 1;
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const type = block.type;

    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      flushCurrent();
      secIndex += 1;
      const level = type === 'heading_1' ? 2 : type === 'heading_2' ? 3 : 4;
      const subtitle = richTextToString(getBlockRichText(block)) || `소제목 ${secIndex}`;
      current = {
        id: `sec_${secIndex}`,
        subtitle,
        level,
        body_html: '',
        body: '',
      };
      i += 1;
      continue;
    }

    if (type === 'paragraph') {
      const html = richTextToHtml(getBlockRichText(block));
      if (html) current.body_html += `<p>${html}</p>`;
      i += 1;
      continue;
    }

    if (type === 'quote') {
      const html = richTextToHtml(getBlockRichText(block));
      if (html) current.body_html += `<blockquote class="notion-quote">${html}</blockquote>`;
      i += 1;
      continue;
    }

    if (type === 'callout') {
      const html = richTextToHtml(getBlockRichText(block));
      const icon = block.callout && block.callout.icon && block.callout.icon.type === 'emoji'
        ? block.callout.icon.emoji
        : '💡';
      if (html) {
        current.body_html += `<div class="notion-callout"><span class="notion-callout-icon">${escapeHtml(
          icon
        )}</span><div class="notion-callout-content">${html}</div></div>`;
      }
      i += 1;
      continue;
    }

    if (type === 'to_do') {
      const html = richTextToHtml(getBlockRichText(block));
      const checked = block.to_do && block.to_do.checked ? 'true' : 'false';
      if (html) current.body_html += `<ul class="notion-todo"><li data-checked="${checked}">${html}</li></ul>`;
      i += 1;
      continue;
    }

    if (type === 'divider') {
      current.body_html += '<hr class="notion-divider"/>';
      i += 1;
      continue;
    }

    if (type === 'bulleted_list_item') {
      const lis = [];
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        const html = richTextToHtml(getBlockRichText(blocks[i]));
        lis.push(`<li>${html}</li>`);
        i += 1;
      }
      if (lis.length) current.body_html += `<ul class="notion-bulleted">${lis.join('')}</ul>`;
      continue;
    }

    if (type === 'numbered_list_item') {
      const lis = [];
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        const html = richTextToHtml(getBlockRichText(blocks[i]));
        lis.push(`<li>${html}</li>`);
        i += 1;
      }
      if (lis.length) current.body_html += `<ol class="notion-numbered">${lis.join('')}</ol>`;
      continue;
    }

    if (type === 'code') {
      const html = richTextToHtml(getBlockRichText(block));
      if (html) current.body_html += `<pre class="notion-code"><code>${html}</code></pre>`;
      i += 1;
      continue;
    }

    if (type === 'toggle') {
      const summary = richTextToHtml(getBlockRichText(block)) || '토글';
      const children = Array.isArray(block.__children) ? block.__children : [];
      const childHtml = children
        .map((child) => {
          if (child.type === 'paragraph') return `<p>${blockToInlineHtml(child)}</p>`;
          if (child.type === 'bulleted_list_item') return `<ul class="notion-bulleted"><li>${blockToInlineHtml(child)}</li></ul>`;
          if (child.type === 'numbered_list_item') return `<ol class="notion-numbered"><li>${blockToInlineHtml(child)}</li></ol>`;
          if (child.type === 'to_do') {
            const checked = child.to_do && child.to_do.checked ? 'true' : 'false';
            return `<ul class="notion-todo"><li data-checked="${checked}">${blockToInlineHtml(child)}</li></ul>`;
          }
          return '';
        })
        .join('');
      current.body_html += `<details class="notion-toggle"><summary>${summary}</summary>${childHtml}</details>`;
      continue;
    }

    // Fallback: any block with rich_text is rendered as a plain paragraph.
    // This guarantees "just typed text" under a heading appears on main page.
    const fallback = blockPlainTextFallback(block);
    if (fallback) {
      current.body_html += `<p>${richTextToHtml(getBlockRichText(block))}</p>`;
      i += 1;
      continue;
    }

    i += 1;
  }

  flushCurrent();
  return sections;
}

function parseSections(bodyDataRaw, tocRaw) {
  const toc = String(tocRaw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (bodyDataRaw) {
    try {
      const parsed = JSON.parse(bodyDataRaw);
      if (Array.isArray(parsed)) {
        return parsed.map((sec, idx) => ({
          id: sec.id || `sec_${idx + 1}`,
          subtitle: sec.subtitle || `소제목 ${idx + 1}`,
          body: sec.body || '',
        }));
      }
    } catch (_) {
      // fallback to TOC-based sections
    }
  }

  if (toc.length) {
    return toc.map((subtitle, idx) => ({
      id: `sec_${idx + 1}`,
      subtitle,
      body: '',
    }));
  }

  return [];
}

function normalizeCategories(rawPages) {
  return rawPages.map((page) => {
    const props = page.properties || {};
    const title =
      propTitle(props, ['카테고리명', '이름', 'Name', 'name']) ||
      propText(props, ['카테고리명', '이름', 'Name', 'name']) ||
      '무제 카테고리';

    return {
      id: page.id,
      title,
      slug: propText(props, ['슬러그', 'Slug']) || slugify(title),
      order: propNumber(props, ['정렬순서', 'Order'], 9999),
      visible: propCheckbox(props, ['노출', 'Visible'], true),
      description: propText(props, ['설명', 'Description']),
    };
  });
}

function collectPreviousArticles(payload) {
  const map = new Map();
  if (!payload || !Array.isArray(payload.groups)) return map;

  payload.groups.forEach((group) => {
    (group.items || []).forEach((item) => {
      map.set(item.id, item);
    });
  });

  return map;
}

async function normalizeArticles(rawPages, previousArticlesMap) {
  const blocksMap = new Map();
  for (const page of rawPages) {
    const previous = previousArticlesMap.get(page.id);
    const canReusePreviousBlocks =
      previous && previous.updatedAt === page.last_edited_time && previous.content?.sections?.length;

    if (canReusePreviousBlocks) {
      blocksMap.set(page.id, null);
      continue;
    }

    try {
      const blocks = await getPageBlocks(page.id);
      blocksMap.set(page.id, blocks);
      await sleep(120);
    } catch (_) {
      blocksMap.set(page.id, undefined);
    }
  }

  return rawPages.map((page) => {
    const props = page.properties || {};
    const previous = previousArticlesMap.get(page.id);

    const menuTitle =
      propTitle(props, ['문서제목', '이름', 'Title', 'Name']) ||
      propText(props, ['문서제목', '이름', 'Title', 'Name']) ||
      '무제 문서';

    const lead = propText(props, ['요약', 'Lead']) || '';
    const pageBlocks = blocksMap.get(page.id);
    const hasFreshBlocks = Array.isArray(pageBlocks);
    const shouldReusePrevious =
      pageBlocks === null || (pageBlocks === undefined && previous && previous.content?.sections?.length);

    let sections = [];
    if (shouldReusePrevious) {
      sections = previous.content.sections || [];
    } else if (hasFreshBlocks) {
      const notionSections = parseSectionsFromBlocks(pageBlocks, menuTitle);
      if (notionSections.length) {
        sections = notionSections;
      } else if (previous && previous.content?.sections?.length) {
        sections = previous.content.sections;
      }
    }

    return {
      id: page.id,
      title: menuTitle,
      slug: propText(props, ['문서슬러그', 'Slug']) || slugify(menuTitle),
      categoryIds: propRelationIds(props, ['상위카테고리', 'Category']),
      order: propNumber(props, ['카테고리내정렬', 'Order'], 9999),
      status: (propSelect(props, ['상태', 'Status'], 'draft') || 'draft').toLowerCase(),
      visible: propCheckbox(props, ['노출', 'Visible'], true),
      content: {
        title: propText(props, ['본문제목']) || menuTitle,
        lead,
        sections,
      },
      updatedAt: page.last_edited_time,
    };
  });
}

function composePayload(categories, articles, preview) {
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const groups = sortedCategories
    .filter((cat) => (preview ? true : cat.visible))
    .map((cat) => {
      const items = articles
        .filter((article) => article.categoryIds.includes(cat.id))
        .filter((article) => (preview ? true : article.visible))
        .filter((article) => (preview ? true : article.status === 'published'))
        .sort((a, b) => a.order - b.order)
        .map((article) => ({
          id: article.id,
          title: article.title,
          slug: article.slug,
          order: article.order,
          status: article.status,
          visible: article.visible,
          updatedAt: article.updatedAt,
          content: article.content,
        }));

      return {
        id: cat.id,
        title: cat.title,
        slug: cat.slug,
        order: cat.order,
        visible: cat.visible,
        description: cat.description,
        items,
      };
    })
    .filter((group) => group.items.length > 0 || preview);

  return {
    version: 1,
    source: 'notion',
    updatedAt: new Date().toISOString(),
    groups,
  };
}

async function buildPayload(preview = false) {
  const [rawCategories, rawArticles] = await Promise.all([
    queryAllPages(CATEGORIES_DB_ID),
    queryAllPages(ARTICLES_DB_ID),
  ]);

  const previousArticlesMap = collectPreviousArticles(cache.payload);
  const categories = normalizeCategories(rawCategories);
  const articles = await normalizeArticles(rawArticles, previousArticlesMap);
  return composePayload(categories, articles, preview);
}

async function getPayload(preview = false, force = false) {
  const now = Date.now();
  if (!force && cache.payload && now - cache.at < CACHE_TTL_MS && !preview) {
    return cache.payload;
  }
  if (!preview && cache.refreshPromise) {
    return cache.refreshPromise;
  }

  const refreshJob = (async () => {
    try {
      const payload = await buildPayload(preview);
      if (!preview) {
        cache.payload = payload;
        cache.at = Date.now();
        saveDiskCache(payload);
      }
      return payload;
    } catch (error) {
      if (!preview && cache.payload) {
        return {
          ...cache.payload,
          stale: true,
          staleReason: error.message,
        };
      }
      throw error;
    } finally {
      if (!preview) {
        cache.refreshPromise = null;
      }
    }
  })();

  if (!preview) {
    cache.refreshPromise = refreshJob;
  }

  try {
    return await refreshJob;
  } catch (error) {
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': PUBLIC_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/admin.html' && !ENABLE_ADMIN_PAGE) {
    json(res, 404, { ok: false, message: 'Not found' });
    return;
  }

  if (req.method === 'GET' && serveStatic(res, url.pathname)) {
    return;
  }

  if (url.pathname === '/api/health') {
    json(res, 200, { ok: true, service: 'notion-inblog-server', now: new Date().toISOString() });
    return;
  }

  if (url.pathname === '/api/inblog/content' && req.method === 'GET') {
    try {
      const missing = assertEnv();
      if (missing.length) {
        json(res, 400, {
          ok: false,
          error: 'Missing required environment variables',
          missing,
        });
        return;
      }

      const preview = url.searchParams.get('preview') === '1';
      const force = url.searchParams.get('refresh') === '1';

      if (!preview && isRateLimited(req)) {
        json(res, 429, { ok: false, error: 'Too many requests. Try again shortly.' });
        return;
      }

      const payload = await getPayload(preview, force);
      json(res, 200, payload);
      return;
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
      return;
    }
  }

  if (url.pathname === '/api/inblog/refresh' && req.method === 'POST') {
    try {
      const missing = assertEnv();
      if (missing.length) {
        json(res, 400, { ok: false, error: 'Missing required environment variables', missing });
        return;
      }

      const payload = await getPayload(false, true);
      json(res, 200, { ok: true, updatedAt: payload.updatedAt, groups: payload.groups.length });
      return;
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
      return;
    }
  }

  json(res, 404, {
    ok: false,
    message: 'Not found',
    routes: ['GET /api/health', 'GET /api/inblog/content', 'POST /api/inblog/refresh'],
  });
});

loadDiskCache();

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[notion-inblog-server] listening on port ${PORT}`);
});
