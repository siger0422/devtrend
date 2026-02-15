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
const categoriesDbId = process.env.NOTION_CATEGORIES_DB_ID;
const articlesDbId = process.env.NOTION_ARTICLES_DB_ID;

if (!token || !categoriesDbId || !articlesDbId) {
  console.error('Missing env: NOTION_TOKEN / NOTION_CATEGORIES_DB_ID / NOTION_ARTICLES_DB_ID');
  process.exit(1);
}

const model = [
  {
    group: 'Devtrend 활용TIP',
    items: ['첫 미팅 가이드', '프로덕트 초기 가이드', '커뮤니케이션 가이드'],
  },
  {
    group: '프로젝트 조정',
    items: ['연장/종료/홀딩', '투입시간 조정(상향/하향)', '장기 협업(장기계약)', '크리에이터 교체/추가매칭'],
  },
  {
    group: '계약/결제',
    items: ['계약', '결제', '성과급', '환불'],
  },
  {
    group: 'devtrend 프로세스',
    items: ['사전미팅', '마케팅 컨설팅', '크리에이터 매칭', '풀스텍 영상 제작', '피드백', '게시 및 데이터 분석'],
  },
  {
    group: '크리에이터 매칭 방식',
    items: ['큐레이션'],
  },
  {
    group: '추가 유형',
    items: ['CS', 'CPA', '프로젝트/작업제'],
  },
  {
    group: 'FAQ',
    items: ['자주 묻는 질문', 'devtrend , 왜 좋을까요?', '세금계산서 FAQ'],
  },
  {
    group: '프로모션',
    items: ['Devtrend Risk-Free 프로그램', '고객 Best Practice(BP) 콘텐츠 안내'],
  },
];

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'untitled';
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

async function queryAll(databaseId) {
  const rows = [];
  let cursor;

  while (true) {
    const payload = await notion(`/v1/databases/${databaseId}/query`, 'POST', {
      page_size: 100,
      start_cursor: cursor,
    });

    rows.push(...(payload.results || []));
    if (!payload.has_more) break;
    cursor = payload.next_cursor;
  }

  return rows;
}

async function ensureSchemas() {
  await notion(`/v1/databases/${categoriesDbId}`, 'PATCH', {
    properties: {
      슬러그: { rich_text: {} },
      정렬순서: { number: { format: 'number' } },
      노출: { checkbox: {} },
      설명: { rich_text: {} },
    },
  });

  await notion(`/v1/databases/${articlesDbId}`, 'PATCH', {
    properties: {
      문서슬러그: { rich_text: {} },
      상위카테고리: { relation: { database_id: categoriesDbId, type: 'single_property', single_property: {} } },
      카테고리내정렬: { number: { format: 'number' } },
      상태: { select: { options: [{ name: 'draft' }, { name: 'review' }, { name: 'published' }, { name: 'archived' }] } },
      노출: { checkbox: {} },
      요약: { rich_text: {} },
      목차: { rich_text: {} },
      본문데이터: { rich_text: {} },
      키워드: { multi_select: {} },
    },
  });
}

async function archiveAll(databaseId) {
  const rows = await queryAll(databaseId);
  for (const row of rows) {
    await notion(`/v1/pages/${row.id}`, 'PATCH', { archived: true });
  }
}

function text(value) {
  return [{ type: 'text', text: { content: value || '' } }];
}

async function createCategory(title, order) {
  const page = await notion('/v1/pages', 'POST', {
    parent: { database_id: categoriesDbId },
    properties: {
      이름: { title: text(title) },
      슬러그: { rich_text: text(slugify(title)) },
      정렬순서: { number: order },
      노출: { checkbox: true },
      설명: { rich_text: text('') },
    },
  });

  return page.id;
}

function buildSectionsJson(group, item) {
  const sections = [
    {
      id: `sec_${slugify(item)}_1`,
      subtitle: `${item} 소개`,
      body: `${item}의 핵심 목적과 활용 배경을 정리합니다.`,
    },
    {
      id: `sec_${slugify(item)}_2`,
      subtitle: '진행 기준',
      body: '요청 배경, 기대 결과, 역할 분담을 사전에 합의합니다.',
    },
    {
      id: `sec_${slugify(item)}_3`,
      subtitle: '실행 체크리스트',
      body: `${group} 관점에서 ${item} 적용 여부를 점검합니다.`,
    },
  ];
  return JSON.stringify(sections);
}

function defaultBlocks(groupTitle, title) {
  return [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: text(`${title} 소개`) },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: text(`${title}의 핵심 목적과 활용 배경을 정리합니다.`) },
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: text('진행 기준') },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: text('요청 배경, 기대 결과, 역할 분담을 사전에 합의합니다.') },
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: text('실행 체크리스트') },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: text(`${groupTitle} 관점에서 ${title} 적용 여부를 점검합니다.`) },
    },
  ];
}

async function createArticle(categoryId, groupTitle, title, order) {
  const page = await notion('/v1/pages', 'POST', {
    parent: { database_id: articlesDbId },
    properties: {
      이름: { title: text(title) },
      문서슬러그: { rich_text: text(slugify(title)) },
      상위카테고리: { relation: [{ id: categoryId }] },
      카테고리내정렬: { number: order },
      상태: { select: { name: 'published' } },
      노출: { checkbox: true },
      요약: { rich_text: text(`${groupTitle} 카테고리 문서입니다. 필요한 텍스트를 자유롭게 수정하세요.`) },
      목차: { rich_text: text('') },
      본문데이터: { rich_text: text('') },
      편집가이드: { rich_text: text('소제목과 본문은 이 페이지 본문 블록(Heading/Paragraph/List)에서 수정하세요.') },
    },
  });

  await notion(`/v1/blocks/${page.id}/children`, 'PATCH', {
    children: defaultBlocks(groupTitle, title),
  });
}

(async () => {
  try {
    console.log('1) schema ensure...');
    await ensureSchemas();

    console.log('2) archive previous rows...');
    await archiveAll(categoriesDbId);
    await archiveAll(articlesDbId);

    console.log('3) create categories + articles...');
    let catOrder = 1;
    for (const group of model) {
      const categoryId = await createCategory(group.group, catOrder++);
      let itemOrder = 1;
      for (const item of group.items) {
        await createArticle(categoryId, group.group, item, itemOrder++);
      }
    }

    console.log('Done: Notion seed completed.');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
