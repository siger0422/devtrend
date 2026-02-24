const fs = require("node:fs");
const path = require("node:path");

const PUBLISHED_KEY = "inblog:published";
const DRAFT_KEY = "inblog:draft";
const LOCAL_FILE_PATH = path.join(process.cwd(), ".snapshot-store.json");

const mem = globalThis.__inblogSnapshotMem || { published: null, draft: null };
globalThis.__inblogSnapshotMem = mem;

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return { enabled: Boolean(url && token), url, token };
}

async function kvGet(key) {
  const cfg = getKvConfig();
  if (!cfg.enabled) return null;
  const response = await fetch(`${cfg.url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!response.ok) throw new Error(`KV GET failed: ${response.status}`);
  const body = await response.json();
  if (!body || body.result == null) return null;
  try {
    return JSON.parse(body.result);
  } catch (_) {
    return null;
  }
}

async function kvSet(key, value) {
  const cfg = getKvConfig();
  if (!cfg.enabled) return false;
  const payload = JSON.stringify(value);
  const response = await fetch(
    `${cfg.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`,
    { headers: { Authorization: `Bearer ${cfg.token}` } }
  );
  if (!response.ok) throw new Error(`KV SET failed: ${response.status}`);
  return true;
}

function loadLocalFile() {
  try {
    if (!fs.existsSync(LOCAL_FILE_PATH)) return;
    const raw = fs.readFileSync(LOCAL_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    mem.published = parsed?.published || mem.published;
    mem.draft = parsed?.draft || mem.draft;
  } catch (_) {
    // ignore
  }
}

function saveLocalFile() {
  try {
    fs.writeFileSync(
      LOCAL_FILE_PATH,
      JSON.stringify({ published: mem.published, draft: mem.draft }, null, 2),
      "utf8"
    );
  } catch (_) {
    // ignore
  }
}

loadLocalFile();

async function getPublished() {
  const kv = await kvGet(PUBLISHED_KEY);
  if (kv) return kv;
  return mem.published;
}

async function getDraft() {
  const kv = await kvGet(DRAFT_KEY);
  if (kv) return kv;
  return mem.draft;
}

async function setDraft(payload) {
  const wrapped = {
    payload,
    syncedAt: new Date().toISOString(),
  };
  mem.draft = wrapped;
  saveLocalFile();
  await kvSet(DRAFT_KEY, wrapped).catch(() => false);
  return wrapped;
}

async function publishDraft() {
  const draft = await getDraft();
  if (!draft || !draft.payload) throw new Error("No draft snapshot to publish");
  const wrapped = {
    payload: draft.payload,
    publishedAt: new Date().toISOString(),
    syncedAt: draft.syncedAt || null,
  };
  mem.published = wrapped;
  saveLocalFile();
  await kvSet(PUBLISHED_KEY, wrapped).catch(() => false);
  return wrapped;
}

module.exports = {
  getPublished,
  getDraft,
  setDraft,
  publishDraft,
};

