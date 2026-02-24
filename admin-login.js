const loginFormEl = document.getElementById('loginForm');
const loginUserEl = document.getElementById('loginUser');
const loginPasswordEl = document.getElementById('loginPassword');
const loginErrorEl = document.getElementById('loginError');
const LOCAL_ADMIN_USER = 'slnsln890';
const LOCAL_ADMIN_PASSWORD = 'slnsln000';
const LOCAL_SESSION_KEY = 'inblog_local_admin_auth';

function showLoginError(message) {
  loginErrorEl.textContent = message || '아이디 또는 비밀번호가 올바르지 않습니다.';
  loginErrorEl.classList.remove('hidden');
}

function hideLoginError() {
  loginErrorEl.classList.add('hidden');
}

function nextPath() {
  const query = new URLSearchParams(window.location.search);
  const next = query.get('next') || '/admin.html';
  if (!next.startsWith('/')) return '/admin.html';
  return next;
}

function isLocalHost() {
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

function enableLocalSession() {
  sessionStorage.setItem(LOCAL_SESSION_KEY, '1');
}

async function checkExistingSession() {
  try {
    const response = await fetch('/api/admin/session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload?.authenticated) {
      window.location.replace(nextPath());
    }
  } catch (_) {
    // ignore
  }
}

loginFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideLoginError();

  const user = loginUserEl.value.trim();
  const password = loginPasswordEl.value;
  if (!user || !password) {
    showLoginError('아이디와 비밀번호를 입력해 주세요.');
    return;
  }

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ user, password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      if (
        isLocalHost() &&
        user === LOCAL_ADMIN_USER &&
        password === LOCAL_ADMIN_PASSWORD
      ) {
        enableLocalSession();
        window.location.replace(nextPath());
        return;
      }
      showLoginError(payload.error || '로그인에 실패했습니다.');
      loginPasswordEl.value = '';
      loginPasswordEl.focus();
      return;
    }
    window.location.replace(nextPath());
  } catch (_) {
    if (
      isLocalHost() &&
      user === LOCAL_ADMIN_USER &&
      password === LOCAL_ADMIN_PASSWORD
    ) {
      enableLocalSession();
      window.location.replace(nextPath());
      return;
    }
    showLoginError('서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

hideLoginError();
loginUserEl.focus();
checkExistingSession();
