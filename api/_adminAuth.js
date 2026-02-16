const crypto = require("node:crypto");

const COOKIE_NAME = "devtrend_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 12;

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function getExpectedCreds() {
  const user = String(process.env.ADMIN_USER || "");
  const password = String(process.env.ADMIN_PASSWORD || "");
  return { user, password };
}

function hasConfiguredCreds() {
  const { user, password } = getExpectedCreds();
  return Boolean(user && password);
}

function makeSessionToken(user, password) {
  return Buffer.from(`${user}:${password}`, "utf8").toString("base64url");
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx <= 0) return;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      out[key] = value;
    });
  return out;
}

function isAuthedByCookie(cookieHeader) {
  if (!hasConfiguredCreds()) return false;
  const cookies = parseCookieHeader(cookieHeader);
  const session = cookies[COOKIE_NAME] || "";
  if (!session) return false;
  const { user, password } = getExpectedCreds();
  const expected = makeSessionToken(user, password);
  return safeEqual(session, expected);
}

function buildAuthCookie() {
  const { user, password } = getExpectedCreds();
  const token = makeSessionToken(user, password);
  return `${COOKIE_NAME}=${token}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function buildClearCookie() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

module.exports = {
  COOKIE_NAME,
  getExpectedCreds,
  hasConfiguredCreds,
  safeEqual,
  isAuthedByCookie,
  buildAuthCookie,
  buildClearCookie,
};

