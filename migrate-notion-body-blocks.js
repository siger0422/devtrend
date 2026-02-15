const fs = require('node:fs');
const path = require('node:path');

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvFromFile(path.join(process.cwd(), '.env.notion.local'));

const token = process.env.NOTION_TOKEN;
const notionVersion = process.env.NOTION_VERSION || '2022-06-28';
const articlesDbId = process.env.NOTION_ARTICLES_DB_ID;

if (!token || !articlesDbId) {
  console.error('Missing env: NOTION_TOKEN / NOTION_ARTICLES_DB_ID');
  process.exit(1);
}

function text(value) {
  return [{ type: 'text', text: { content: value || '' } }];
}

async function notion(pathname, method = 'GET', body) {
  const response = await fetch(`https://api.notion.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': notionVersion,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed: ${data.message || response.status}`);
  }
  return data;
}

async function queryAllArticles() {
  const rows = [];
  let cursor;
  while (true) {
    const payload = await notion(`/v1/databases/${articlesDbId}/query`, 'POST', {
      page_size: 100,
      start_cursor: cursor,
    });
    rows.push(...(payload.results || []));
    if (!payload.has_more) break;
    cursor = payload.next_cursor;
  }
  return rows;
}

function richTextToString(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map((n) => n.plain_text || '').join('').trim();
}

function propTitle(props, names) {
  for (const name of names) {
    const p = props[name];
    if (!p) continue;
    if (p.type === 'title') return richTextToString(p.title);
    if (p.type === 'rich_text') return richTextToString(p.rich_text);
  }
  return '';
}

function propText(props, names) {
  for (const name of names) {
    const p = props[name];
    if (!p) continue;
    if (p.type === 'rich_text') return richTextToString(p.rich_text);
    if (p.type === 'title') return richTextToString(p.title);
  }
  return '';
}

function hasHeadingBlock(blocks) {
  return blocks.some((b) => b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3');
}

function buildBlocksFromLegacy(title, bodyDataRaw, tocRaw) {
  let sections = [];
  if (bodyDataRaw) {
    try {
      const parsed = JSON.parse(bodyDataRaw);
      if (Array.isArray(parsed)) sections = parsed;
    } catch (_) {
      sections = [];
    }
  }

  if (!sections.length && tocRaw) {
    const toc = String(tocRaw)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    sections = toc.map((subtitle) => ({ subtitle, body: '' }));
  }

  if (!sections.length) {
    sections = [
      { subtitle: `${title} 소개`, body: `${title} 본문을 여기에 작성하세요.` },
      { subtitle: '진행 기준', body: '진행 기준을 작성하세요.' },
      { subtitle: '실행 체크리스트', body: '체크리스트를 작성하세요.' },
    ];
  }

  const blocks = [];
  for (const sec of sections) {
    blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: text(sec.subtitle || '소제목') } });
    const body = String(sec.body || '').trim();
    if (body) {
      body.split('\n').forEach((line) => {
        if (!line.trim()) return;
        blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: text(line.trim()) } });
      });
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: text('내용을 입력해 주세요.') } });
    }
  }
  return blocks;
}

async function getPageBlocks(pageId) {
  const payload = await notion(`/v1/blocks/${pageId}/children?page_size=100`);
  return payload.results || [];
}

(async () => {
  try {
    const pages = await queryAllArticles();
    console.log(`articles=${pages.length}`);

    for (const page of pages) {
      const props = page.properties || {};
      const title = propTitle(props, ['문서제목', '이름', 'Title', 'Name']) || '문서';
      const bodyDataRaw = propText(props, ['본문데이터', 'BodyBlocks']);
      const tocRaw = propText(props, ['목차', 'TOC']);

      const blocks = await getPageBlocks(page.id);
      const already = hasHeadingBlock(blocks);

      if (!already) {
        const children = buildBlocksFromLegacy(title, bodyDataRaw, tocRaw);
        await notion(`/v1/blocks/${page.id}/children`, 'PATCH', { children });
        console.log(`migrated blocks: ${title}`);
      }

      await notion(`/v1/pages/${page.id}`, 'PATCH', {
        properties: {
          목차: { rich_text: text('') },
          본문데이터: { rich_text: text('') },
          편집가이드: { rich_text: text('소제목/본문은 이 페이지 본문에서 Heading + Paragraph로 편집하세요.') },
        },
      });
    }

    console.log('Done: migration complete');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
