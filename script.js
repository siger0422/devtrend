const SOURCE_KEY = 'inblog_source_mode';
const API_BASE_KEY = 'inblog_api_base';
const NOTION_CACHE_KEY = 'inblog_notion_cache_v1';
const NOTION_BOOTSTRAP_KEY = 'inblog_notion_bootstrap_v1';
const INITIAL_FETCH_TIMEOUT_MS = 3500;

const accordionEl = document.getElementById('accordion');
const articleEl = document.getElementById('article');
const tocEl = document.getElementById('toc');
const searchInputEl = document.getElementById('searchInput');
const mobileNavToggleEl = document.getElementById('mobileNavToggle');
const mobileSearchToggleEl = document.getElementById('mobileSearchToggle');
const mobileNavCloseEl = document.getElementById('mobileNavClose');
const drawerBackdropEl = document.getElementById('drawerBackdrop');
const SOCIAL_LINKS = {
  kakao: 'https://open.kakao.com/',
  instagram: 'https://www.instagram.com/dev.trend_official/?utm_source=ig_web_button_share_sheet',
  homepage: 'https://www.devtrend.co.kr/',
};

const query = new URLSearchParams(window.location.search);
localStorage.setItem(SOURCE_KEY, 'notion');
if (query.get('api')) localStorage.setItem(API_BASE_KEY, query.get('api'));

function isLocalDevHost() {
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

function defaultApiBase() {
  if (isLocalDevHost()) {
    return 'http://127.0.0.1:8787';
  }
  return window.location.origin;
}

function normalizeApiBase(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

async function probeApiBase(baseUrl) {
  const base = normalizeApiBase(baseUrl);
  if (!base) return { ok: false, base, error: 'base is empty' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);

  try {
    const response = await fetch(`${base}/api/health`, {
      signal: controller.signal,
      cache: 'default',
    });
    const bodyText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      return { ok: false, base, error: 'notion-api-health-html' };
    }

    const payload = JSON.parse(bodyText || '{}');
    if (!response.ok || payload?.ok !== true) {
      return { ok: false, base, error: payload?.error || `HTTP ${response.status}` };
    }

    return { ok: true, base };
  } catch (error) {
    return {
      ok: false,
      base,
      error: error?.name === 'AbortError' ? 'health-timeout' : String(error.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveApiBase() {
  const queryOverride = normalizeApiBase(query.get('api') || '');
  if (!isLocalDevHost()) {
    const fixed = queryOverride || normalizeApiBase(window.location.origin);
    if (fixed) localStorage.setItem(API_BASE_KEY, fixed);
    return fixed;
  }

  const saved = normalizeApiBase(localStorage.getItem(API_BASE_KEY) || '');
  const candidates = [];

  if (saved) candidates.push(saved);
  if (!saved.includes('8787')) {
    candidates.push('http://127.0.0.1:8787');
  }
  if (window.location.origin !== 'http://127.0.0.1:8787') {
    candidates.push(window.location.origin);
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const result = await probeApiBase(candidate);
    if (result.ok) {
      localStorage.setItem(API_BASE_KEY, candidate);
      return candidate;
    }
  }

  return saved || 'http://127.0.0.1:8787';
}

let sourceMode = localStorage.getItem(SOURCE_KEY) || 'notion';
let apiBase = localStorage.getItem(API_BASE_KEY) || defaultApiBase();
let notionPollTimer = null;

let data = { version: 1, groups: [] };
let openedGroups = new Set([data.groups?.[0]?.id].filter(Boolean));
let selected = {
  groupId: data.groups?.[0]?.id || null,
  itemId: data.groups?.[0]?.items?.[0]?.id || null,
};
let syncError = '';
let hasLoadedFromNotionApi = false;
let hasResolvedInitialNotionLoad = false;
let lastRenderedItemId = null;
let isBootstrapPending = false;
let isBootstrapRouteUnavailable = false;
let contentFetchPromise = null;
let searchDebounceTimer = null;

function isMobileViewport() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function closeMobilePanels() {
  document.body.classList.remove('mobile-nav-open');
  document.body.classList.remove('mobile-search-open');
}

function toggleMobileNav() {
  if (!isMobileViewport()) return;
  const willOpen = !document.body.classList.contains('mobile-nav-open');
  document.body.classList.toggle('mobile-nav-open', willOpen);
  if (willOpen) document.body.classList.remove('mobile-search-open');
}

function toggleMobileSearch() {
  if (!isMobileViewport()) return;
  const willOpen = !document.body.classList.contains('mobile-search-open');
  document.body.classList.toggle('mobile-search-open', willOpen);
  if (willOpen) {
    document.body.classList.remove('mobile-nav-open');
    setTimeout(() => searchInputEl?.focus(), 0);
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

function normalizePayload(payload) {
  if (!payload || !Array.isArray(payload.groups)) {
    throw new Error('Invalid payload: groups is required');
  }

  return {
    version: payload.version || 1,
    updatedAt: payload.updatedAt || new Date().toISOString(),
    groups: payload.groups.map((group) => ({
      id: group.id,
      title: group.title,
      slug: group.slug || slugify(group.title),
      order: group.order || 0,
      visible: group.visible !== false,
      items: (group.items || []).map((item) => ({
        id: item.id,
        title: item.title,
        slug: item.slug || slugify(item.title),
        order: item.order || 0,
        status: item.status || 'published',
        visible: item.visible !== false,
        content: {
          title: item.content?.title || item.title,
          lead: item.content?.lead || '',
          sections: (item.content?.sections || []).map((section, idx) => ({
            id: section.id || `sec_${idx + 1}`,
            subtitle: section.subtitle || `소제목 ${idx + 1}`,
            level: section.level || 3,
            body_html: section.body_html || '',
            body: section.body || '',
          })),
        },
      })),
    })),
  };
}

async function loadFromNotionApi(force = false, options = {}) {
  if (!force && contentFetchPromise) {
    return contentFetchPromise;
  }
  const task = loadFromNotionApiInternal(force, options);
  if (!force) contentFetchPromise = task;
  try {
    return await task;
  } finally {
    if (!force && contentFetchPromise === task) {
      contentFetchPromise = null;
    }
  }
}

async function loadFromNotionApiInternal(force = false, options = {}) {
  const { markResolved = true, holdResolveWhileBootstrap = false } = options;
  apiBase = await resolveApiBase();
  const params = new URLSearchParams();
  if (force) params.set('refresh', '1');
  if (force || isLocalDevHost()) {
    params.set('_t', String(Date.now()));
  }
  const querySuffix = params.toString() ? `?${params.toString()}` : '';

  const apiEndpoint = `${apiBase}/api/inblog/content${querySuffix}`;
  const contentJsonEndpoint =
    !isLocalDevHost() && normalizeApiBase(window.location.origin) === normalizeApiBase(apiBase)
      ? `${window.location.origin}/content.json${querySuffix}`
      : '';
  // In production, prefer content.json first for CDN cache hit.
  const endpoints = contentJsonEndpoint ? [contentJsonEndpoint, apiEndpoint] : [apiEndpoint];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INITIAL_FETCH_TIMEOUT_MS);

  try {
    let payload = null;
    let lastError = null;

    for (const target of endpoints) {
      try {
        const response = await fetch(target, { signal: controller.signal, cache: 'default' });
        const contentType = response.headers.get('content-type') || '';
        const raw = await response.text();

        if (!contentType.includes('application/json')) {
          throw new Error('API 라우트가 배포되지 않았거나 HTML이 반환되었습니다.');
        }

        const parsed = JSON.parse(raw);
        if (!response.ok || parsed.ok === false) {
          const missing = Array.isArray(parsed.missing) ? ` (missing: ${parsed.missing.join(', ')})` : '';
          throw new Error((parsed.error || `HTTP ${response.status}`) + missing);
        }
        payload = parsed;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!payload) {
      throw lastError || new Error('콘텐츠를 불러오지 못했습니다.');
    }

    data = normalizePayload(payload);
    syncError = '';
    hasLoadedFromNotionApi = true;
    localStorage.setItem(NOTION_CACHE_KEY, JSON.stringify(data));
    if (payload.source === 'bootstrap' || payload.source === 'published') {
      localStorage.setItem(NOTION_BOOTSTRAP_KEY, JSON.stringify(data));
    }
    renderAll();
    return true;
  } catch (error) {
    syncError = `Notion 동기화 실패: ${error.message}`;

    // Use cached payload only before first successful Notion load.
    if (!hasLoadedFromNotionApi) {
      const cached = localStorage.getItem(NOTION_CACHE_KEY);
      if (cached) {
        try {
          data = normalizePayload(JSON.parse(cached));
        } catch (_) {
          // ignore broken cache
        }
      }
    }

    renderAll();
    return false;
  } finally {
    if (markResolved) {
      const shouldHold = holdResolveWhileBootstrap && isBootstrapPending;
      if (!shouldHold) hasResolvedInitialNotionLoad = true;
    }
    clearTimeout(timeout);
  }
}

function syncRuntimeSettings() {
  sourceMode = 'notion';
  localStorage.setItem(SOURCE_KEY, 'notion');
  if (isLocalDevHost()) {
    apiBase = localStorage.getItem(API_BASE_KEY) || defaultApiBase();
    return;
  }
  apiBase = normalizeApiBase(query.get('api') || '') || normalizeApiBase(window.location.origin);
  localStorage.setItem(API_BASE_KEY, apiBase);
}

function hydrateFromLocalCache() {
  const cached = localStorage.getItem(NOTION_CACHE_KEY);
  if (!cached) return false;
  try {
    data = normalizePayload(JSON.parse(cached));
    hasLoadedFromNotionApi = true;
    hasResolvedInitialNotionLoad = true;
    return true;
  } catch (_) {
    return false;
  }
}

function hydrateFromBootstrapCache() {
  const cached = localStorage.getItem(NOTION_BOOTSTRAP_KEY);
  if (!cached) return false;
  try {
    data = normalizePayload(JSON.parse(cached));
    hasLoadedFromNotionApi = true;
    hasResolvedInitialNotionLoad = true;
    return true;
  } catch (_) {
    return false;
  }
}

async function hydrateFromServerBootstrap() {
  if (isLocalDevHost()) return false;
  try {
    const response = await fetch('/notion-bootstrap.json', { cache: 'force-cache' });
    if (!response.ok) {
      isBootstrapRouteUnavailable = true;
      return false;
    }
    const payload = await response.json();
    data = normalizePayload(payload);
    hasLoadedFromNotionApi = true;
    hasResolvedInitialNotionLoad = true;
    isBootstrapRouteUnavailable = false;
    localStorage.setItem(NOTION_BOOTSTRAP_KEY, JSON.stringify(data));
    renderAll();
    return true;
  } catch (_) {
    isBootstrapRouteUnavailable = true;
    return false;
  }
}

function findGroupAndItem(groupId, itemId) {
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) {
    return { group: null, item: null };
  }
  const item = group.items.find((i) => i.id === itemId) || null;
  return { group, item };
}

function getFilteredData() {
  const q = searchInputEl.value.trim().toLowerCase();
  if (!q) {
    return data.groups;
  }

  return data.groups
    .map((group) => {
      const groupMatch = group.title.toLowerCase().includes(q);
      const filteredItems = group.items.filter((item) => {
        const baseText = [
          item.title,
          item.content?.title,
          item.content?.lead,
          ...(item.content?.sections || []).flatMap((s) => [s.subtitle, s.body]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return baseText.includes(q);
      });

      if (groupMatch) {
        return group;
      }

      return {
        ...group,
        items: filteredItems,
      };
    })
    .filter((group) => group.items.length > 0);
}

function ensureSelection(filteredGroups) {
  const valid = filteredGroups.some(
    (group) => group.id === selected.groupId && group.items.some((item) => item.id === selected.itemId)
  );

  if (!valid) {
    selected.groupId = filteredGroups[0]?.id || null;
    selected.itemId = filteredGroups[0]?.items?.[0]?.id || null;
  }

  if (selected.groupId) {
    openedGroups.add(selected.groupId);
  }
}

function renderAccordion(filteredGroups) {
  accordionEl.innerHTML = '';

  filteredGroups.forEach((group) => {
    const wrap = document.createElement('section');

    const titleBtn = document.createElement('button');
    titleBtn.className = 'group-title';
    titleBtn.textContent = group.title;

    const isOpen = openedGroups.has(group.id);
    if (isOpen) {
      titleBtn.classList.add('open');
    }

    titleBtn.addEventListener('click', () => {
      if (openedGroups.has(group.id)) {
        openedGroups.delete(group.id);
      } else {
        openedGroups.add(group.id);
      }
      renderAll();
    });

    const list = document.createElement('div');
    list.className = 'sub-list';
    if (isOpen) {
      list.classList.add('open');
    }

    group.items.forEach((item) => {
      const itemBtn = document.createElement('button');
      itemBtn.className = 'sub-item';
      itemBtn.textContent = item.title;

      if (selected.groupId === group.id && selected.itemId === item.id) {
        itemBtn.classList.add('active');
      }

      itemBtn.addEventListener('click', () => {
        selected = { groupId: group.id, itemId: item.id };
        if (isMobileViewport()) closeMobilePanels();
        renderAll();
      });

      list.appendChild(itemBtn);
    });

    wrap.appendChild(titleBtn);
    wrap.appendChild(list);
    accordionEl.appendChild(wrap);
  });
}

function renderToc(sections) {
  const sectionLinks = (sections || [])
    .map((section) => {
      const id = slugify(section.subtitle);
      return `<a href="#${id}">${escapeHtml(section.subtitle)}</a>`;
    })
    .join('');

  const connectLinks = `
    <p class="toc-title toc-connect-title">CONNECT</p>
    <a class="toc-connect-link" href="${SOCIAL_LINKS.homepage}" target="_blank" rel="noreferrer noopener">홈페이지</a>
    <a class="toc-connect-link" href="${SOCIAL_LINKS.kakao}" target="_blank" rel="noreferrer noopener">카카오톡</a>
    <a class="toc-connect-link" href="${SOCIAL_LINKS.instagram}" target="_blank" rel="noreferrer noopener">인스타그램</a>
  `;

  tocEl.innerHTML = `
    <p class="toc-title">ON THIS PAGE</p>
    ${sectionLinks || "<a href='#'>섹션이 없습니다</a>"}
    ${connectLinks}
  `;
}

function headingTagFromLevel(level) {
  if (level === 3) return 'h3';
  if (level >= 4) return 'h4';
  return 'h2';
}

function renderArticle(group, item) {
  if (!group || !item) {
    articleEl.innerHTML = "<h1>문서를 찾을 수 없습니다</h1><p class='lead'>좌측 카테고리에서 다른 문서를 선택해 주세요.</p>";
    tocEl.innerHTML = '';
    return;
  }

  const content = item.content || { title: item.title, lead: '', sections: [] };
  const sections = content.sections || [];

  const sectionsHtml = sections
    .map((section) => {
      const id = slugify(section.subtitle);
      const headingTag = headingTagFromLevel(section.level);
      const paragraphs = section.body_html
        ? section.body_html
        : String(section.body || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join('');

      return `
        <section class="doc-section" id="${id}">
          <${headingTag}>${escapeHtml(section.subtitle)}</${headingTag}>
          ${paragraphs || ''}
        </section>
      `;
    })
    .join('');

  articleEl.innerHTML = `
    <h1>${escapeHtml(content.title || item.title)}</h1>
    <p class="lead">${escapeHtml(content.lead || `${group.title} 문서`)}</p>
    <hr />
    ${sectionsHtml || "<section class='doc-section'><h2>내용 준비 중</h2><p>어드민에서 소제목과 본문을 추가해 주세요.</p></section>"}
  `;

  renderToc(sections);
}

function renderAll() {
  if (!hasResolvedInitialNotionLoad) {
    accordionEl.innerHTML = '<p style="color:#98a7c4;padding:8px;">데이터 불러오는 중...</p>';
    articleEl.innerHTML = "<h1>데이터를 불러오는 중입니다</h1><p class='lead'>잠시만 기다려 주세요.</p>";
    tocEl.innerHTML = '';
    return;
  }

  const filteredGroups = getFilteredData();

  if (!filteredGroups.length) {
    accordionEl.innerHTML = '<p style="color:#98a7c4;padding:8px;">검색 결과가 없습니다.</p>';
    if (syncError) {
      const refreshGuide =
        isBootstrapRouteUnavailable || !hasLoadedFromNotionApi
          ? "<p class='lead'>안내: 첫 접속 로딩이 실패하면 새로고침을 1회 해주세요.</p>"
          : '';
      articleEl.innerHTML = `<h1>데이터를 불러오지 못했습니다</h1><p class='lead'>${escapeHtml(syncError)}</p>${refreshGuide}`;
    } else {
      articleEl.innerHTML = "<h1>검색 결과가 없습니다</h1><p class='lead'>다른 키워드로 검색해 주세요.</p>";
    }
    tocEl.innerHTML = '';
    return;
  }

  ensureSelection(filteredGroups);
  renderAccordion(filteredGroups);

  const { group, item } = findGroupAndItem(selected.groupId, selected.itemId);
  const hasChangedItem = Boolean(item?.id) && item.id !== lastRenderedItemId;
  if (hasChangedItem) {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    lastRenderedItemId = item.id;
  }
  renderArticle(group, item);
}

searchInputEl.addEventListener('input', () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    renderAll();
    searchDebounceTimer = null;
  }, 120);
});
mobileNavToggleEl?.addEventListener('click', toggleMobileNav);
mobileSearchToggleEl?.addEventListener('click', toggleMobileSearch);
mobileNavCloseEl?.addEventListener('click', closeMobilePanels);
drawerBackdropEl?.addEventListener('click', closeMobilePanels);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMobilePanels();
});

window.addEventListener('resize', () => {
  if (!isMobileViewport()) closeMobilePanels();
});

function startByMode() {
  syncRuntimeSettings();

  if (notionPollTimer) {
    clearInterval(notionPollTimer);
    notionPollTimer = null;
  }
  isBootstrapPending = false;
  isBootstrapRouteUnavailable = false;

  // 1) Show local snapshot immediately.
  const hasLocalCache = hydrateFromLocalCache();
  const hasBootstrapCache = !hasLocalCache && hydrateFromBootstrapCache();
  if (hasLocalCache || hasBootstrapCache) {
    hasResolvedInitialNotionLoad = true;
    renderAll();
    // Background refresh from API.
    loadFromNotionApi(false, { markResolved: true });
  } else {
    hasResolvedInitialNotionLoad = false;
    renderAll();
    // 2) First-time visitor: try static server bootstrap snapshot before API.
    isBootstrapPending = true;
    hydrateFromServerBootstrap().finally(() => {
      isBootstrapPending = false;
      if (!hasResolvedInitialNotionLoad) {
        hasResolvedInitialNotionLoad = true;
        renderAll();
      }
    });
    // While bootstrap is pending, do API refresh in parallel but do not resolve UI first.
    loadFromNotionApi(false, { markResolved: true, holdResolveWhileBootstrap: true });
  }
  notionPollTimer = setInterval(() => {
    if (document.hidden) return;
    loadFromNotionApi(false, { markResolved: true });
  }, 60000);
}

window.addEventListener('storage', (event) => {
  if (event.key === SOURCE_KEY || event.key === API_BASE_KEY) {
    startByMode();
  }
});

startByMode();
