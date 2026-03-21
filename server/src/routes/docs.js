const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { authMiddleware } = require('../authMiddleware');
const docManager = require('../docManager');
const persistence = require('../persistence');
const { publisher } = require('../redis');
const Y = require('yjs');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

function normalizeRole(role) {
  if (!role) return 'viewer';
  const r = String(role);
  if (!['owner', 'editor', 'viewer'].includes(r)) return 'viewer';
  return r;
}

router.use(authMiddleware);

// GET /docs — return documents where the user has access
router.get('/', async (req, res) => {
  try {
    const { userId } = req.user;
    const { rows } = await pool.query(
      `SELECT d.id,
              d.title,
              d.updated_at,
              da.role
       FROM document_access da
       JOIN documents d ON d.id = da.doc_id
       WHERE da.user_id = $1
       ORDER BY d.updated_at DESC`,
      [userId]
    );

    return res.json({ documents: rows });
  } catch (err) {
    console.error('[docs] list failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to load documents' });
  }
});

// POST /docs — create a document (owner)
router.post('/', async (req, res) => {
  try {
    const { userId } = req.user;
    const title = (req.body?.title && String(req.body.title).trim()) || 'Untitled Document';

    const { rows } = await pool.query(
      `INSERT INTO documents (title, owner_id)
       VALUES ($1, $2)
       RETURNING id, title`,
      [title, userId]
    );

    const doc = rows[0];

    await pool.query(
      `INSERT INTO document_access (doc_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [doc.id, userId]
    );

    return res.json({ id: doc.id, title: doc.title });
  } catch (err) {
    console.error('[docs] create failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to create document' });
  }
});

// GET /docs/:id — metadata only (no Yjs state)
router.get('/:id', async (req, res) => {
  try {
    const { userId } = req.user;
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT d.id,
              d.title,
              d.owner_id AS ownerId,
              da.role
       FROM documents d
       JOIN document_access da ON da.doc_id = d.id
       WHERE d.id = $1 AND da.user_id = $2`,
      [id, userId]
    );

    const row = rows[0];
    if (!row) return res.status(404).json({ code: 'NOT_FOUND', message: 'Document not found' });

    return res.json({
      id: row.id,
      title: row.title,
      ownerId: row.ownerId,
      role: row.role,
      canEdit: row.role === 'owner' || row.role === 'editor',
    });
  } catch (err) {
    console.error('[docs] get meta failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to load document' });
  }
});

// PATCH /docs/:id/title — title update (owner/editor only)
router.patch('/:id/title', async (req, res) => {
  try {
    const { userId } = req.user;
    const { id } = req.params;
    const title = (req.body?.title && String(req.body.title).trim()) || '';
    if (title.length < 1) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Title cannot be empty' });
    }

    const { rows: accessRows } = await pool.query(
      `SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2`,
      [id, userId]
    );
    const role = accessRows[0]?.role;
    if (!role) return res.status(404).json({ code: 'NOT_FOUND', message: 'Document not found' });
    if (role !== 'owner' && role !== 'editor') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'No permission to edit title' });
    }

    const { rows } = await pool.query(
      `UPDATE documents
       SET title = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, title`,
      [id, title]
    );

    return res.json({ id: rows[0].id, title: rows[0].title });
  } catch (err) {
    console.error('[docs] patch title failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to update title' });
  }
});

// POST /docs/:id/share — generate shareable token
router.post('/:id/share', async (req, res) => {
  try {
    const { userId } = req.user;
    const { id } = req.params;
    const requester = req.user;

    const { rows: accessRows } = await pool.query(
      `SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2`,
      [id, userId]
    );
    const role = accessRows[0]?.role;
    if (!role) return res.status(404).json({ code: 'NOT_FOUND', message: 'Document not found' });
    if (role !== 'owner' && role !== 'editor') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'No permission to share' });
    }

    const shareRole = normalizeRole(req.body?.role) || 'viewer';

    const shareToken = jwt.sign(
      { docId: id, role: shareRole },
      JWT_SECRET,
      { expiresIn: '72h' }
    );

    const shareUrl = `${CLIENT_URL}/editor/${id}?shareToken=${encodeURIComponent(shareToken)}`;
    return res.json({ shareToken, shareUrl });
  } catch (err) {
    console.error('[docs] share failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to generate share link' });
  }
});

// POST /docs/join/:shareToken — decode token, insert access, respond/redirect
router.post('/join/:shareToken', async (req, res) => {
  try {
    const { userId } = req.user;
    const { shareToken } = req.params;

    const payload = jwt.verify(shareToken, JWT_SECRET);
    const docId = payload?.docId;
    const role = normalizeRole(payload?.role);

    if (!docId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Invalid share token' });
    }

    // Ensure the doc exists
    const { rows: docRows } = await pool.query(`SELECT id FROM documents WHERE id = $1`, [docId]);
    if (!docRows.length) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Document not found' });
    }

    await pool.query(
      `INSERT INTO document_access (doc_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (doc_id, user_id)
       DO UPDATE SET role = EXCLUDED.role`,
      [docId, userId, role]
    );

    const redirectUrl = `${CLIENT_URL}/editor/${docId}`;
    const wantsJson = String(req.headers.accept || '').includes('application/json');
    if (wantsJson) {
      return res.json({ id: docId, role, redirectUrl });
    }
    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('[docs] join failed:', err);
    return res.status(401).json({ code: 'INVALID_TOKEN', message: 'Invalid or expired share token' });
  }
});


// GET /docs/:id/versions — list all snapshots
router.get('/:id/versions', async (req, res) => {
  try {
    const { userId } = req.user;
    const { id: docId } = req.params;

    const { rows: accessRows } = await pool.query(
      `SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2`,
      [docId, userId]
    );
    if (!accessRows.length) return res.status(403).json({ code: 'FORBIDDEN', message: 'No access' });

    const { rows } = await pool.query(
      `SELECT v.id, v.version_name, v.created_at, u.name as user_name
       FROM document_versions v
       LEFT JOIN users u ON u.id = v.user_id
       WHERE v.doc_id = $1
       ORDER BY v.created_at DESC`,
      [docId]
    );

    return res.json({ versions: rows });
  } catch (err) {
    console.error('[docs] versions list failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to load version history' });
  }
});

// POST /docs/:id/versions — manual snapshot creation
router.post('/:id/versions', async (req, res) => {
  try {
    const { userId } = req.user;
    const { id: docId } = req.params;
    const { name } = req.body || {};

    const { rows: accessRows } = await pool.query(
      `SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2`,
      [docId, userId]
    );
    const role = accessRows[0]?.role;
    if (role !== 'owner' && role !== 'editor') return res.status(403).json({ code: 'FORBIDDEN', message: 'No permission' });

    // Current full state update from shared docManager memory.
    const state = docManager.getStateAsUpdate(docId);
    if (!state) return res.status(404).json({ code: 'NOT_FOUND', message: 'Document not currently active' });

    const { rows } = await pool.query(
      `INSERT INTO document_versions (doc_id, user_id, yjs_state, version_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [docId, userId, Buffer.from(state), name || null]
    );

    return res.json(rows[0]);
  } catch (err) {
    console.error('[docs] version save failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to save version' });
  }
});

// POST /docs/:id/versions/:versionId/restore — revert to an older snapshot
router.post('/:id/versions/:versionId/restore', async (req, res) => {
  try {
    const { userId } = req.user;
    const { id: docId, versionId } = req.params;

    const { rows: accessRows } = await pool.query(
      `SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2`,
      [docId, userId]
    );
    const role = accessRows[0]?.role;
    if (role !== 'owner' && role !== 'editor') return res.status(403).json({ code: 'FORBIDDEN', message: 'No permission' });

    const { rows } = await pool.query(
      `SELECT yjs_state FROM document_versions WHERE id = $1 AND doc_id = $2`,
      [versionId, docId]
    );
    if (!rows.length) return res.status(404).json({ code: 'NOT_FOUND', message: 'Version not found' });

    const snapshotUpdate = new Uint8Array(rows[0].yjs_state);

    // To cleanly REVERT, we باید current doc ko target state par le jaana hai.
    // Optimal way to revert in Yjs without losing client compatibility:
    const serverDoc = docManager.getOrCreateDoc(docId);
    let revertUpdate = null;
    const capture = (u) => { revertUpdate = u; };
    serverDoc.once('update', capture);

    serverDoc.transact(() => {
      const ytext = serverDoc.getText('codemirror');
      
      // 1) Load target state into a temp doc to get its string content
      const targetDoc = new Y.Doc();
      Y.applyUpdate(targetDoc, snapshotUpdate);
      const targetText = targetDoc.getText('codemirror').toString();
      
      // 2) Replace current content with target content
      // This generates NEW updates that reflect the "revert" correctly to all clients.
      const currentText = ytext.toString();
      if (currentText !== targetText) {
        ytext.delete(0, ytext.length);
        ytext.insert(0, targetText);
      }
    }, 'revert');

    serverDoc.off('update', capture);

    // 3) Broadcast to all active clients (on this or other servers via Redis)
    if (revertUpdate) {
      const channel = `room:${docId}`;
      publisher.publish(
        channel,
        JSON.stringify({ update: Array.from(revertUpdate), origin: 'server' })
      );
    }

    // Persistence: ensure this is saved to DB and Redis
    persistence.scheduleFlushToPostgres(docId, serverDoc);
    persistence.saveDocToRedis(docId, serverDoc).catch(() => {});

    return res.json({ success: true, message: 'Version restored. Active clients will sync on naturally.' });
  } catch (err) {
    console.error('[docs] version restore failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Failed to restore version' });
  }
});

module.exports = router;

