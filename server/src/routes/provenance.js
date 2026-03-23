const express = require('express')
const router = express.Router()
const Y = require('yjs')
const { authMiddleware } = require('../authMiddleware')
const { pool } = require('../db')
const docManager = require('../docManager')
const causalGraph = require('../causalGraph')
const intentAnalyzer = require('../intentAnalyzer')
const contributionMapper = require('../contributionMapper')

// All routes require auth
router.use(authMiddleware)

/**
 * GET /docs/:id/provenance?from=<number>&to=<number>
 * 
 * Returns the causal chain for a text range.
 * Cached in Postgres — invalidated when document stateVector changes.
 */
router.get('/docs/:id/provenance', async (req, res) => {
  const { id: docId } = req.params
  const from = parseInt(req.query.from)
  const to = parseInt(req.query.to)

  if (isNaN(from) || isNaN(to) || to - from > 5000) {
    return res.status(400).json({ error: 'Invalid range. Max 5000 characters.' })
  }

  // Access check
  const access = await pool.query(
    'SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2',
    [docId, req.user.userId]
  )
  if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' })

  const doc = docManager.getOrCreateDoc(docId)
  const stateVector = Array.from(Y.encodeStateVector(doc))
  const cacheKey = causalGraph.provenanceCacheKey(docId, from, to, stateVector)

  // Check cache
  const cached = await pool.query(
    'SELECT chain FROM provenance_cache WHERE doc_id = $1 AND range_hash = $2',
    [docId, cacheKey]
  )

  if (cached.rows.length > 0) {
    return res.json(cached.rows[0].chain)
  }

  // Compute provenance
  const resolver = contributionMapper.getClientIdResolver(docId)
  const chain = causalGraph.extractCausalChain(doc, from, to)
  const provenance = causalGraph.buildProvenanceResult(chain, resolver)

  // Cache result (upsert)
  pool.query(
    `INSERT INTO provenance_cache (doc_id, range_hash, chain)
     VALUES ($1, $2, $3)
     ON CONFLICT (doc_id, range_hash) DO UPDATE SET chain = $3, computed_at = NOW()`,
    [docId, cacheKey, JSON.stringify(provenance)]
  ).catch(() => {})  // fire and forget

  res.json(provenance)
})

/**
 * GET /docs/:id/contribution?from=<number>&to=<number>
 * 
 * Returns per-author contribution percentages for a text range.
 */
router.get('/docs/:id/contribution', async (req, res) => {
  const { id: docId } = req.params
  const from = parseInt(req.query.from || '0')
  const to = parseInt(req.query.to || '99999999')

  const access = await pool.query(
    'SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2',
    [docId, req.user.userId]
  )
  if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' })

  const doc = docManager.getOrCreateDoc(docId)
  const contributions = await contributionMapper.getContributionForRange(doc, docId, from, to)

  res.json({ contributions, range: { from, to } })
})

/**
 * GET /docs/:id/conflicts/:threadId/analysis
 * 
 * Returns (or triggers) LLM semantic analysis for a conflict thread.
 * If not yet analyzed, triggers analysis async and returns 202 Accepted.
 * Client should poll again after 2 seconds.
 */
router.get('/docs/:id/conflicts/:threadId/analysis', async (req, res) => {
  const { id: docId, threadId } = req.params

  const access = await pool.query(
    'SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2',
    [docId, req.user.userId]
  )
  if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' })

  // Check if analysis already exists
  const existing = await pool.query(
    'SELECT analysis FROM conflict_analyses WHERE thread_id = $1',
    [threadId]
  )
  if (existing.rows.length > 0) {
    return res.json({ status: 'ready', analysis: existing.rows[0].analysis })
  }

  // Get conflict data from event log
  const conflictEvent = await pool.query(
    `SELECT payload, actor_name FROM doc_events
     WHERE doc_id = $1 AND event_type = 'conflict:detected'
     AND payload->>'threadId' = $2`,
    [docId, threadId]
  )

  if (conflictEvent.rows.length === 0) {
    return res.status(404).json({ error: 'Conflict event not found' })
  }

  const { payload } = conflictEvent.rows[0]

  // Trigger analysis async — don't await
  intentAnalyzer.analyzeConflict({
    threadId,
    docId,
    beforeText: payload.beforeText || '',
    aliceEdit: payload.aliceEdit || '',
    bobEdit: payload.bobEdit || '',
    mergedResult: payload.mergedResult || '',
    contextText: payload.contextText || '',
    aliceName: payload.conflictingUsers?.[0] || 'User A',
    bobName: payload.conflictingUsers?.[1] || 'User B'
  }).catch(e => console.error('Background analysis failed:', e.message))

  // Return 202 — client should poll
  res.status(202).json({ status: 'analyzing', retryAfter: 2 })
})

/**
 * GET /docs/:id/health
 * 
 * Returns the document health score.
 * Used by DocumentHealthBar in the editor header.
 */
router.get('/docs/:id/health', async (req, res) => {
  const { id: docId } = req.params

  const access = await pool.query(
    'SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2',
    [docId, req.user.userId]
  )
  if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' })

  const health = await intentAnalyzer.getDocumentHealthScore(docId)
  res.json(health)
})

module.exports = router
