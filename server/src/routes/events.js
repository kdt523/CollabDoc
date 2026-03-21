const express = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../authMiddleware');
const eventLogger = require('../eventLogger');

const router = express.Router();

router.get('/:id/events', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { id: docId } = req.params;
    const { since, limit } = req.query;

    const { rows: accessRows } = await pool.query(
      `SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2`,
      [docId, userId]
    );
    if (!accessRows.length) return res.status(403).json({ code: 'FORBIDDEN', message: 'No access' });

    const events = await eventLogger.getEventLog(docId, { since, limit: parseInt(limit, 10) || 200 });
    
    // We map rows to sanitize yjsUpdate (which is BYTEA) for JSON
    const sanitizedEvents = events.map(e => ({
      ...e,
      yjs_update: e.yjs_update ? Array.from(e.yjs_update) : null,
      payload: (typeof e.payload === 'string') ? JSON.parse(e.payload) : e.payload
    }));

    return res.json({ events: sanitizedEvents });
  } catch (err) {
    console.error('[eventsRoute] GET events failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to load events' });
  }
});

router.get('/:id/events/conflicts', authMiddleware, async (req, res) => {
  try {
    const { id: docId } = req.params;
    const events = await eventLogger.getConflictEvents(docId);
    return res.json({ events });
  } catch (err) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Sync failed' });
  }
});

module.exports = router;
