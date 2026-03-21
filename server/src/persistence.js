const Y = require('yjs');
const { pool } = require('./db');
const { publisher } = require('./redis');
const docManager = require('./docManager');

const REDIS_TTL_SECONDS = 86400; // 24 hours
const POSTGRES_FLUSH_DEBOUNCE_MS = 5000;

const flushTimers = new Map(); // docId -> Timeout
const latestDocs = new Map(); // docId -> Y.Doc (most recent reference)
let shuttingDown = false;

function redisKey(docId) {
  return `doc:${docId}`;
}

async function loadDoc(docId) {
  // Try Redis cache first.
  const key = redisKey(docId);
  const cached = await publisher.getBuffer(key).catch(() => null);
  if (cached && cached.length > 0) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(cached));
    return doc;
  }

  // Fallback to Postgres binary state.
  const { rows } = await pool.query(
    `SELECT yjs_state FROM documents WHERE id = $1`,
    [docId]
  );
  const yjsState = rows[0]?.yjs_state;
  if (!yjsState) return null;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(yjsState));
  return doc;
}

async function saveDocToRedis(docId, doc) {
  const update = Y.encodeStateAsUpdate(doc);
  const key = redisKey(docId);

  // ioredis can store raw buffers.
  await publisher.setex(key, REDIS_TTL_SECONDS, Buffer.from(update));
}

function scheduleFlushToPostgres(docId, doc) {
  if (shuttingDown) return;

  latestDocs.set(docId, doc);

  const existing = flushTimers.get(docId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    flushTimers.delete(docId);
    try {
      const latest = latestDocs.get(docId) || doc;
      const update = Y.encodeStateAsUpdate(latest);
      await pool.query(
        `UPDATE documents SET yjs_state = $2, updated_at = NOW() WHERE id = $1`,
        [docId, Buffer.from(update)]
      );
    } catch (err) {
      console.error(`[persistence] flush to Postgres failed for doc ${docId}:`, err);
    }
  }, POSTGRES_FLUSH_DEBOUNCE_MS);

  flushTimers.set(docId, timer);
}

async function flushAllDocs() {
  shuttingDown = true;

  // Cancel pending timers so we don't run overlapping flushes.
  for (const [, timer] of flushTimers) {
    clearTimeout(timer);
  }
  flushTimers.clear();

  const docIds = new Set([
    ...Array.from(latestDocs.keys()),
    ...Array.from(docManager.getAllDocs().keys()),
  ]);

  await Promise.all(
    Array.from(docIds).map(async (docId) => {
      try {
        const doc = docManager.getOrCreateDoc(docId);
        const update = Y.encodeStateAsUpdate(doc);
        await pool.query(
          `UPDATE documents SET yjs_state = $2, updated_at = NOW() WHERE id = $1`,
          [docId, Buffer.from(update)]
        );
      } catch (err) {
        // Best-effort during shutdown. Still log loudly so issues aren't silent.
        console.error(`[persistence] shutdown flush failed for doc ${docId}:`, err);
      }
    })
  );
}

module.exports = {
  loadDoc,
  saveDocToRedis,
  scheduleFlushToPostgres,
  flushAllDocs,
};

