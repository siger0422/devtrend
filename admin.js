const SOURCE_KEY = 'inblog_source_mode';
const API_BASE_KEY = 'inblog_api_base';

const apiBaseInputEl = document.getElementById('apiBaseInput');
const saveIntegrationBtn = document.getElementById('saveIntegrationBtn');
const testHealthBtn = document.getElementById('testHealthBtn');
const refreshContentBtn = document.getElementById('refreshContentBtn');
const openMainBtn = document.getElementById('openMainBtn');
const integrationStatusEl = document.getElementById('integrationStatus');
const groupListEl = document.getElementById('groupList');
const articlePreviewEl = document.getElementById('articlePreview');
const mainViewLinkEl = document.querySelector('.top-actions a');

let data = { groups: [] };
let selected = { groupId: null, itemId: null };

function currentApiBase() {
  return localStorage.getItem(API_BASE_KEY) || window.location.origin;
}

function forceNotionMode() {
  localStorage.setItem(SOURCE_KEY, 'notion');
}

function setStatus(message) {
  integrationStatusEl.textContent = message;
}

function updateMainLink() {
  const api = currentApiBase();
  const encodedApi = encodeURIComponent(api);
  const href = `/index.html?source=notion&api=${encodedApi}`;
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

async function fetchContent(force = false) {
  const api = currentApiBase();
  const params = new URLSearchParams();
  if (force) params.set('refresh', '1');
  params.set('_t', String(Date.now()));
  const url = `${api}/api/inblog/content?${params.toString()}`;

  try {
    setStatus('Notion 데이터 동기화 중...');
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
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
    setStatus(`동기화 완료: ${payload.updatedAt}`);
  } catch (error) {
    setStatus(`동기화 실패: ${error.message}`);
  }
}

async function testHealth() {
  const api = currentApiBase();
  try {
    setStatus('헬스체크 중...');
    const response = await fetch(`${api}/api/health`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    setStatus(`정상 연결됨 (${body.service}) ${body.now}`);
  } catch (error) {
    setStatus(`연결 실패: ${error.message}`);
  }
}

saveIntegrationBtn.addEventListener('click', () => {
  persistIntegrationSettings();
  fetchContent(false);
});

apiBaseInputEl.addEventListener('change', () => {
  persistIntegrationSettings();
});

testHealthBtn.addEventListener('click', testHealth);
refreshContentBtn.addEventListener('click', () => fetchContent(true));

openMainBtn.addEventListener('click', () => {
  const href = updateMainLink();
  window.open(href, '_blank', 'noopener,noreferrer');
});

window.addEventListener('storage', (event) => {
  if (event.key === API_BASE_KEY) {
    renderIntegrationUI();
    fetchContent(false);
  }
});

renderIntegrationUI();
fetchContent(false);
