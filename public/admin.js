const SOURCE_KEY = 'inblog_source_mode';
const API_BASE_KEY = 'inblog_api_base';
const logoutBtn = document.getElementById('logoutBtn');

const apiBaseInputEl = document.getElementById('apiBaseInput');
const saveIntegrationBtn = document.getElementById('saveIntegrationBtn');
const testHealthBtn = document.getElementById('testHealthBtn');
const refreshContentBtn = document.getElementById('refreshContentBtn');
const publishContentBtn = document.getElementById('publishContentBtn');
const openMainBtn = document.getElementById('openMainBtn');
const integrationStatusEl = document.getElementById('integrationStatus');
const groupListEl = document.getElementById('groupList');
const articlePreviewEl = document.getElementById('articlePreview');
const mainViewLinkEl = document.querySelector('.top-actions a');
const LOCAL_SESSION_KEY = 'inblog_local_admin_auth';
const LOCAL_PUBLISHED_SNAPSHOT_KEY = 'inblog_local_published_snapshot';

let data = { groups: [] };
let selected = { groupId: null, itemId: null };
let bootstrapped = false;

function showAdminApp() {
  if (!bootstrapped) {
    bootstrapAdmin();
    bootstrapped = true;
  }
}

function currentApiBase() {
  const saved = normalizeApiBase(localStorage.getItem(API_BASE_KEY) || '');
  if (saved) return saved;
  return defaultApiBase();
}

function defaultApiBase() {
  const host = window.location.hostname;
  if (host === '127.0.0.1' || host === 'localhost') {
    return 'http://127.0.0.1:8787';
  }
  return window.location.origin;
}

function isLocalStaticAdminMode() {
  const host = window.location.hostname;
  return (host === '127.0.0.1' || host === 'localhost') && window.location.port === '4173';
}

function normalizeApiBase(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

async function probeApiBase(baseUrl) {
  const base = normalizeApiBase(baseUrl);
  if (!base) return { ok: false, base, error: 'API 기본값이 비어 있습니다.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);

  try {
    const response = await fetch(`${base}/api/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    const bodyText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    clearTimeout(timer);

    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        base,
        error: '노션 API가 아닌 HTML이 반환되었습니다.',
      };
    }

    const payload = JSON.parse(bodyText || '{}');
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        base,
        error: payload?.error || `HTTP ${response.status}`,
      };
    }

    return { ok: true, base };
  } catch (error) {
    return {
      ok: false,
      base,
      error: error?.name === 'AbortError' ? '연결 시간이 초과되었습니다.' : String(error.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveApiBase() {
  const saved = normalizeApiBase(localStorage.getItem(API_BASE_KEY) || '');
  const host = window.location.hostname;
  const candidateList = [];
  if (saved) candidateList.push(saved);
  if (defaultApiBase() !== saved) candidateList.push(defaultApiBase());
  if ((host === '127.0.0.1' || host === 'localhost') && saved !== 'http://127.0.0.1:8787') {
    candidateList.push('http://127.0.0.1:8787');
  }
  if (window.location.origin && defaultApiBase() !== window.location.origin) {
    candidateList.push(window.location.origin);
  }

  const seen = new Set();
  for (const base of candidateList) {
    if (!base || seen.has(base)) continue;
    seen.add(base);
    const result = await probeApiBase(base);
    if (result.ok) {
      localStorage.setItem(API_BASE_KEY, base);
      return base;
    }
  }

  return normalizeApiBase(saved || defaultApiBase());
}

function forceNotionMode() {
  localStorage.setItem(SOURCE_KEY, 'notion');
}

function setStatus(message) {
  integrationStatusEl.textContent = message;
}

function updateMainLink() {
  const href = '/index.html';
  if (mainViewLinkEl) mainViewLinkEl.href = href;
  return href;
}

function renderIntegrationUI() {
  forceNotionMode();
  apiBaseInputEl.value = currentApiBase();
  updateMainLink();
}

function persistIntegrationSettings() {
  const api = apiBaseInputEl.value.trim() || window.location.origin;
  localStorage.setItem(API_BASE_KEY, api);
  forceNotionMode();
  renderIntegrationUI();
}

function findSelectedItem() {
  const group = data.groups.find((g) => g.id === selected.groupId);
  if (!group) return null;
  return group.items.find((item) => item.id === selected.itemId) || null;
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').trim();
}

function renderPreview() {
  const item = findSelectedItem();
  if (!item) {
    articlePreviewEl.classList.add('empty');
    articlePreviewEl.innerHTML = '좌측에서 문서를 선택해 주세요.';
    return;
  }

  const content = item.content || {};
  const sectionsHtml = (content.sections || [])
    .map((section) => {
      const body = section.body_html
        ? section.body_html
        : (section.body || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => `<p>${line}</p>`)
            .join('');

      return `
        <section class="preview-section">
          <h3>${section.subtitle || ''}</h3>
          ${body || ''}
        </section>
      `;
    })
    .join('');

  articlePreviewEl.classList.remove('empty');
  articlePreviewEl.innerHTML = `
    <h1>${content.title || item.title}</h1>
    <p class="preview-lead">${content.lead || ''}</p>
    <hr />
    ${sectionsHtml || '<p>본문 블록이 없습니다. Notion 페이지 본문에 heading + paragraph를 추가해 주세요.</p>'}
  `;
}

function renderGroups() {
  groupListEl.innerHTML = '';
  if (!data.groups.length) {
    groupListEl.innerHTML = '<div class="empty">로드된 카테고리가 없습니다.</div>';
    renderPreview();
    return;
  }

  data.groups.forEach((group) => {
    const wrap = document.createElement('section');

    const title = document.createElement('button');
    title.className = 'list-title';
    title.textContent = `${group.title} (${group.items.length})`;
    if (selected.groupId === group.id) title.classList.add('active');
    title.addEventListener('click', () => {
      selected.groupId = group.id;
      selected.itemId = group.items[0]?.id || null;
      renderGroups();
      renderPreview();
    });

    const list = document.createElement('div');
    list.className = 'item-list';
    (group.items || []).forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'sub-item';
      btn.textContent = item.title;
      if (selected.groupId === group.id && selected.itemId === item.id) btn.classList.add('active');
      btn.title = stripHtml(item.content?.lead || '');
      btn.addEventListener('click', () => {
        selected.groupId = group.id;
        selected.itemId = item.id;
        renderGroups();
        renderPreview();
      });
      list.appendChild(btn);
    });

    wrap.appendChild(title);
    wrap.appendChild(list);
    groupListEl.appendChild(wrap);
  });
}

function ensureSelection() {
  const group = data.groups.find((g) => g.id === selected.groupId);
  if (group && group.items.some((item) => item.id === selected.itemId)) return;
  selected.groupId = data.groups[0]?.id || null;
  selected.itemId = data.groups[0]?.items?.[0]?.id || null;
}

async function fetchContent() {
  const api = await resolveApiBase();
  apiBaseInputEl.value = api;
  updateMainLink();
  const params = new URLSearchParams();
  params.set('_t', String(Date.now()));
  const url = isLocalStaticAdminMode()
    ? `${api}/api/inblog/content?${params.toString()}`
    : '/api/admin/content';

  try {
    setStatus('저장된 데이터 로드 중...');
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: isLocalStaticAdminMode() ? 'omit' : 'include',
    });
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    let payload = null;

    if (contentType.includes('application/json')) {
      try {
        payload = JSON.parse(raw);
      } catch (_) {
        throw new Error('API 응답 JSON 파싱 실패');
      }
    } else {
      throw new Error('API 라우트가 배포되지 않았거나 HTML이 반환되었습니다.');
    }

    if (!response.ok || payload.ok === false) {
      const missing = Array.isArray(payload.missing) ? ` (missing: ${payload.missing.join(', ')})` : '';
      throw new Error((payload.error || `HTTP ${response.status}`) + missing);
    }

    data = {
      groups: (payload.groups || []).map((group) => ({
        ...group,
        items: group.items || [],
      })),
    };
    ensureSelection();
    renderGroups();
    renderPreview();
    setStatus(`로드 완료 (${payload.source || (isLocalStaticAdminMode() ? 'local-notion' : 'unknown')})`);
  } catch (error) {
    setStatus(`로드 실패: ${error.message}`);
  }
}

async function syncFromNotion() {
  if (isLocalStaticAdminMode()) {
    const api = await resolveApiBase();
    const params = new URLSearchParams();
    params.set('refresh', '1');
    params.set('_t', String(Date.now()));
    const url = `${api}/api/inblog/content?${params.toString()}`;
    try {
      setStatus('로컬 노션 동기화 중...');
      const response = await fetch(url, { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';
      const raw = await response.text();
      if (!contentType.includes('application/json')) {
        throw new Error('로컬 Notion API에서 HTML이 반환되었습니다.');
      }
      const payload = JSON.parse(raw);
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      data = {
        groups: (payload.groups || []).map((group) => ({
          ...group,
          items: group.items || [],
        })),
      };
      ensureSelection();
      renderGroups();
      renderPreview();
      setStatus(`로컬 동기화 완료: ${payload.updatedAt || new Date().toISOString()}`);
      return;
    } catch (error) {
      setStatus(`로컬 동기화 실패: ${error.message}`);
      return;
    }
  }

  try {
    setStatus('노션에서 초안 동기화 중...');
    const response = await fetch('/api/admin/sync', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      const missing = Array.isArray(payload.missing) ? ` (missing: ${payload.missing.join(', ')})` : '';
      throw new Error((payload.error || `HTTP ${response.status}`) + missing);
    }
    setStatus(`초안 동기화 완료: 문서 ${payload.items}개`);
    fetchContent(false);
  } catch (error) {
    setStatus(`초안 동기화 실패: ${error.message}`);
  }
}

async function publishDraft() {
  if (isLocalStaticAdminMode()) {
    try {
      const snapshot = {
        version: 1,
        source: 'local-admin-published',
        publishedAt: new Date().toISOString(),
        groups: data.groups || [],
      };
      localStorage.setItem(LOCAL_PUBLISHED_SNAPSHOT_KEY, JSON.stringify(snapshot));
      setStatus(`로컬 발행 저장 완료: ${snapshot.publishedAt}`);
    } catch (error) {
      setStatus(`로컬 발행 실패: ${error.message}`);
    }
    return;
  }

  try {
    setStatus('발행 저장 중...');
    const response = await fetch('/api/admin/publish', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    setStatus(`발행 완료: ${payload.publishedAt}`);
    fetchContent(false);
  } catch (error) {
    setStatus(`발행 실패: ${error.message}`);
  }
}

async function testHealth() {
  const api = await resolveApiBase();
  apiBaseInputEl.value = api;
  try {
    setStatus(`헬스체크 중... (${api})`);
    const result = await probeApiBase(api);
    if (!result.ok) throw new Error(result.error);
    setStatus(`정상 연결됨 (${api})`);
  } catch (error) {
    setStatus(`연결 실패: ${error.message}`);
  }
}

function bootstrapAdmin() {
  saveIntegrationBtn.addEventListener('click', () => {
    persistIntegrationSettings();
    fetchContent(false);
  });

  apiBaseInputEl.addEventListener('change', () => {
    persistIntegrationSettings();
  });

  testHealthBtn.addEventListener('click', testHealth);
  refreshContentBtn.addEventListener('click', syncFromNotion);
  publishContentBtn?.addEventListener('click', publishDraft);

  openMainBtn.addEventListener('click', () => {
    const href = updateMainLink();
    window.open(href, '_blank', 'noopener,noreferrer');
  });
  logoutBtn?.addEventListener('click', async () => {
    try {
      sessionStorage.removeItem(LOCAL_SESSION_KEY);
      await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.href = '/admin-login.html';
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === API_BASE_KEY) {
      renderIntegrationUI();
      fetchContent(false);
    }
  });

  renderIntegrationUI();
  fetchContent(false);
}

async function ensureAuthorized() {
  const host = window.location.hostname;
  if ((host === '127.0.0.1' || host === 'localhost') && sessionStorage.getItem(LOCAL_SESSION_KEY) === '1') {
    showAdminApp();
    return;
  }

  try {
    const response = await fetch('/api/admin/session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      window.location.href = '/admin-login.html?next=%2Fadmin.html';
      return;
    }
    const payload = await response.json();
    if (!payload?.authenticated) {
      window.location.href = '/admin-login.html?next=%2Fadmin.html';
      return;
    }
  } catch (_) {
    window.location.href = '/admin-login.html?next=%2Fadmin.html';
    return;
  }

  showAdminApp();
}

ensureAuthorized();
