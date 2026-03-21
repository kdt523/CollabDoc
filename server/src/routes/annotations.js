const express = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../authMiddleware');
const chatManager = require('../chatManager');
const docManager = require('../docManager');

const router = express.Router();

router.get('/:id/annotations', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { id: docId } = req.params;

    const { rows: accessRows } = await pool.query(
      `SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2`,
      [docId, userId]
    );
    if (!accessRows.length) return res.status(403).json({ code: 'FORBIDDEN', message: 'No access' });

    const { rows } = await pool.query(
      `SELECT a.id, a.doc_id, a.yjs_anchor, a.thread_id, a.resolved, u.name as creator_name
       FROM annotations a
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.doc_id = $1 AND a.resolved = FALSE
       ORDER BY a.created_at ASC`,
      [docId]
    );

    return res.json({ annotations: rows });
  } catch (err) {
    console.error('[annotationsRoute] GET list failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to load annotations' });
  }
});

router.post('/:id/annotations', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { id: docId } = req.params;
    const { id, yjs_anchor, thread_id } = req.body;

    await pool.query(
      `INSERT INTO annotations (id, doc_id, yjs_anchor, thread_id, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, docId, JSON.stringify(yjs_anchor), thread_id, userId]
    );

    return res.json({ id });
  } catch (err) {
    console.error('[annotationsRoute] POST create failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to create annotation metadata' });
  }
});

router.patch('/:id/annotations/:annotationId/resolve', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { id: docId, annotationId } = req.params;
    const { threadId } = req.body;

    await pool.query(
      `UPDATE annotations SET resolved = true WHERE id = $1 AND doc_id = $2`,
      [annotationId, docId]
    );
    
    // Also resolve in CRDT
    const doc = docManager.getOrCreateDoc(docId);
    if (doc && threadId) {
      chatManager.resolveThread(doc, threadId);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[annotationsRoute] PATCH resolve failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to resolve annotation' });
  }
});

module.exports = router;
