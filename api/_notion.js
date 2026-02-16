const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";
const CATEGORIES_DB_ID = process.env.NOTION_CATEGORIES_DB_ID || "";
const ARTICLES_DB_ID = process.env.NOTION_ARTICLES_DB_ID || "";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30000);

const cache = globalThis.__inblogNotionCache || { at: 0, payload: null, pending: null };
globalThis.__inblogNotionCache = cache;

function missingEnv() {
  const missing = [];
  if (!NOTION_TOKEN) missing.push("NOTION_TOKEN");
  if (!CATEGORIES_DB_ID) missing.push("NOTION_CATEGORIES_DB_ID");
  if (!ARTICLES_DB_ID) missing.push("NOTION_ARTICLES_DB_ID");
  return missing;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(input) {
  return (
    String(input || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "untitled"
  );
}

function firstDefined(obj, names) {
  for (const name of names) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
  }
  return undefined;
}

function richTextToString(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.map((node) => node.plain_text || "").join("").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function richTextToHtml(arr) {
  if (!Array.isArray(arr)) return "";
  return arr
    .map((node) => {
      const annotations = node.annotations || {};
      let text = escapeHtml(node.plain_text || "").replace(/\n/g, "<br/>");
      if (!text) return "";
      if (node.href) {
        const href = escapeHtml(node.href);
        text = `<a href="${href}" target="_blank" rel="noreferrer noopener">${text}</a>`;
      }
      if (annotations.code) text = `<code>${text}</code>`;
      if (annotations.bold) text = `<strong>${text}</strong>`;
      if (annotations.italic) text = `<em>${text}</em>`;
      if (annotations.underline) text = `<u>${text}</u>`;
      if (annotations.strikethrough) text = `<s>${text}</s>`;
      return text;
    })
    .join("");
}

function propTitle(props, names) {
  const prop = firstDefined(props, names);
  if (!prop) return "";
  if (prop.type === "title") return richTextToString(prop.title);
  if (prop.type === "rich_text") return richTextToString(prop.rich_text);
  return "";
}

function propText(props, names) {
  const prop = firstDefined(props, names);
  if (!prop) return "";
  if (prop.type === "rich_text") return richTextToString(prop.rich_text);
  if (prop.type === "title") return richTextToString(prop.title);
  return "";
}

function propNumber(props, names, fallback = 0) {
  const prop = firstDefined(props, names);
  if (!prop) return fallback;
  if (prop.type === "number" && typeof prop.number === "number") return prop.number;
  return fallback;
}

function propCheckbox(props, names, fallback = true) {
  const prop = firstDefined(props, names);
  if (!prop) return fallback;
  if (prop.type === "checkbox") return Boolean(prop.checkbox);
  return fallback;
}

function propSelect(props, names, fallback = "") {
  const prop = firstDefined(props, names);
  if (!prop) return fallback;
  if (prop.type === "select") return (prop.select && prop.select.name) || fallback;
  return fallback;
}

function propRelationIds(props, names) {
  const prop = firstDefined(props, names);
  if (!prop) return [];
  if (prop.type === "relation" && Array.isArray(prop.relation)) {
    return prop.relation.map((entry) => entry.id).filter(Boolean);
  }
  return [];
}

async function notionFetch(path, method = "GET", body, attempt = 0) {
  const response = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const jsonBody = await response.json();
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after") || 0);
      await sleep((retryAfter > 0 ? retryAfter : attempt + 1) * 1000);
      return notionFetch(path, method, body, attempt + 1);
    }
    const message = jsonBody && jsonBody.message ? jsonBody.message : "Unknown Notion API error";
    throw new Error(`Notion API ${response.status}: ${message}`);
  }

  return jsonBody;
}

async function queryAllPages(databaseId) {
  const pages = [];
  let cursor = undefined;
  while (true) {
    const payload = await notionFetch(`/v1/databases/${databaseId}/query`, "POST", {
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
      `/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`
    );
    blocks.push(...(payload.results || []));
    if (!payload.has_more) break;
    cursor = payload.next_cursor;
  }
  return blocks;
}

function getBlockRichText(block) {
  const payload = block[block.type];
  if (!payload) return [];
  return payload.rich_text || [];
}

function parseSectionsFromBlocks(blocks, defaultTitle) {
  const sections = [];
  let current = { id: "sec_1", subtitle: `${defaultTitle} 소개`, level: 2, body_html: "", body: "" };
  let secIndex = 1;

  function flush() {
    if (current.body_html || current.body) sections.push(current);
  }

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const type = block.type;

    if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
      flush();
      secIndex += 1;
      current = {
        id: `sec_${secIndex}`,
        subtitle: richTextToString(getBlockRichText(block)) || `소제목 ${secIndex}`,
        level: type === "heading_1" ? 2 : type === "heading_2" ? 3 : 4,
        body_html: "",
        body: "",
      };
      i += 1;
      continue;
    }

    if (type === "paragraph") {
      const html = richTextToHtml(getBlockRichText(block));
      if (html) current.body_html += `<p>${html}</p>`;
      i += 1;
      continue;
    }

    if (type === "bulleted_list_item") {
      const lis = [];
      while (i < blocks.length && blocks[i].type === "bulleted_list_item") {
        lis.push(`<li>${richTextToHtml(getBlockRichText(blocks[i]))}</li>`);
        i += 1;
      }
      if (lis.length) current.body_html += `<ul class="notion-bulleted">${lis.join("")}</ul>`;
      continue;
    }

    if (type === "numbered_list_item") {
      const lis = [];
      while (i < blocks.length && blocks[i].type === "numbered_list_item") {
        lis.push(`<li>${richTextToHtml(getBlockRichText(blocks[i]))}</li>`);
        i += 1;
      }
      if (lis.length) current.body_html += `<ol class="notion-numbered">${lis.join("")}</ol>`;
      continue;
    }

    const fallback = richTextToHtml(getBlockRichText(block));
    if (fallback) current.body_html += `<p>${fallback}</p>`;
    i += 1;
  }

  flush();
  return sections;
}

function normalizeCategories(rawPages) {
  return rawPages.map((page) => {
    const props = page.properties || {};
    const title =
      propTitle(props, ["카테고리명", "이름", "Name", "name"]) ||
      propText(props, ["카테고리명", "이름", "Name", "name"]) ||
      "무제 카테고리";
    return {
      id: page.id,
      title,
      slug: propText(props, ["슬러그", "Slug"]) || slugify(title),
      order: propNumber(props, ["정렬순서", "Order"], 9999),
      visible: propCheckbox(props, ["노출", "Visible"], true),
      description: propText(props, ["설명", "Description"]),
    };
  });
}

async function normalizeArticles(rawPages) {
  const blocksMap = new Map();
  for (const page of rawPages) {
    try {
      blocksMap.set(page.id, await getPageBlocks(page.id));
      await sleep(80);
    } catch (_) {
      blocksMap.set(page.id, []);
    }
  }

  return rawPages.map((page) => {
    const props = page.properties || {};
    const menuTitle =
      propTitle(props, ["문서제목", "이름", "Title", "Name"]) ||
      propText(props, ["문서제목", "이름", "Title", "Name"]) ||
      "무제 문서";

    const sections = parseSectionsFromBlocks(blocksMap.get(page.id) || [], menuTitle);
    return {
      id: page.id,
      title: menuTitle,
      slug: propText(props, ["문서슬러그", "Slug"]) || slugify(menuTitle),
      categoryIds: propRelationIds(props, ["상위카테고리", "Category"]),
      order: propNumber(props, ["카테고리내정렬", "Order"], 9999),
      status: (propSelect(props, ["상태", "Status"], "draft") || "draft").toLowerCase(),
      visible: propCheckbox(props, ["노출", "Visible"], true),
      updatedAt: page.last_edited_time,
      content: {
        title: propText(props, ["본문제목"]) || menuTitle,
        lead: propText(props, ["요약", "Lead"]) || "",
        sections,
      },
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
        .filter((article) => (preview ? true : article.status === "published"))
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
    source: "notion",
    updatedAt: new Date().toISOString(),
    groups,
  };
}

async function getPayload({ preview = false, force = false } = {}) {
  const missing = missingEnv();
  if (missing.length) {
    const error = new Error("Missing required environment variables");
    error.missing = missing;
    throw error;
  }

  const now = Date.now();
  if (!force && cache.payload && now - cache.at < CACHE_TTL_MS && !preview) {
    return cache.payload;
  }
  if (!preview && cache.pending) {
    return cache.pending;
  }

  const job = (async () => {
    const [rawCategories, rawArticles] = await Promise.all([
      queryAllPages(CATEGORIES_DB_ID),
      queryAllPages(ARTICLES_DB_ID),
    ]);
    const payload = composePayload(
      normalizeCategories(rawCategories),
      await normalizeArticles(rawArticles),
      preview
    );
    if (!preview) {
      cache.payload = payload;
      cache.at = Date.now();
    }
    return payload;
  })();

  if (!preview) cache.pending = job;
  try {
    return await job;
  } finally {
    if (!preview) cache.pending = null;
  }
}

module.exports = { getPayload };
