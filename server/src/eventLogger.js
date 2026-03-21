const { pool } = require('./db');

async function logEvent(docId, eventType, actor, { yjsUpdate, payload, clock }) {
  try {
    const actorId = actor?.id || actor?.userId || null;
    const actorName = actor?.name || 'System';
    
    // We use a fire-and-forget style for performance but log errors if they happen.
    pool.query(
      `INSERT INTO doc_events (doc_id, event_type, actor_id, actor_name, yjs_update, payload, clock)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        docId, 
        eventType, 
        actorId, 
        actorName, 
        yjsUpdate ? Buffer.from(yjsUpdate) : null, 
        payload ? JSON.stringify(payload) : null, 
        clock || 0
      ]
    ).catch(err => {
      console.error('[eventLogger] failed to log event:', err);
    });
  } catch (err) {
    console.error('[eventLogger] error in logEvent:', err);
  }
}

async function getEventLog(docId, { since, limit = 200 } = {}) {
  const query = since
    ? [`SELECT * FROM doc_events WHERE doc_id = $1 AND created_at > $2 ORDER BY created_at ASC LIMIT $3`, [docId, since, limit]]
    : [`SELECT * FROM doc_events WHERE doc_id = $1 ORDER BY created_at ASC LIMIT $2`, [docId, limit]];

  const { rows } = await pool.query(...query);
  return rows;
}

async function getConflictEvents(docId) {
  const { rows } = await pool.query(
    `SELECT * FROM doc_events WHERE doc_id = $1 AND event_type = 'conflict:detected' ORDER BY created_at DESC LIMIT 50`,
    [docId]
  );
  return rows;
}

module.exports = {
  logEvent,
  getEventLog,
  getConflictEvents
};
