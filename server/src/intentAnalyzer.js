const Anthropic = require('@anthropic-ai/sdk')
const { pool } = require('./db')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * Analyze a conflict using Claude.
 * 
 * Input: two concurrent edits to the same region + document context
 * Output: { compatible, aliceIntent, bobIntent, semanticConflict, suggestion }
 * 
 * IMPORTANT DESIGN DECISIONS:
 * 1. We cache results by threadId — the same conflict is never analyzed twice
 * 2. We use claude-sonnet-4-20250514 — fast enough for near-real-time, smart enough for intent
 * 3. We ask for JSON-only response — no preamble, no markdown
 * 4. We cap context to 500 chars surrounding the conflict — enough for semantic understanding
 * 5. The LLM NEVER modifies text. It only interprets. This is non-negotiable.
 */
async function analyzeConflict({
  threadId,
  docId,
  beforeText,
  aliceEdit,      // text after Alice's change
  bobEdit,        // text after Bob's change
  mergedResult,   // what CRDT actually produced
  contextText,    // ~500 chars surrounding the conflict
  aliceName,
  bobName
}) {
  // Check cache first
  const cached = await pool.query(
    'SELECT analysis FROM conflict_analyses WHERE thread_id = $1',
    [threadId]
  )
  if (cached.rows.length > 0) {
    return cached.rows[0].analysis
  }

  const prompt = `You are analyzing a conflict in a collaborative document editor.
Two users edited the same text region simultaneously.
The CRDT (Conflict-free Replicated Data Type) merged both edits automatically.
Your job is to interpret what each person likely intended and whether the merge makes semantic sense.

ORIGINAL TEXT (before either edit):
"${beforeText}"

${aliceName} changed it to:
"${aliceEdit}"

${bobName} changed it to:
"${bobEdit}"

CRDT automatically merged both to:
"${mergedResult}"

SURROUNDING DOCUMENT CONTEXT:
"${contextText}"

Respond with ONLY a JSON object. No explanation, no markdown, no preamble. Just JSON:
{
  "compatible": <boolean — are the two edits semantically compatible with each other>,
  "aliceIntent": "<one concise sentence describing what ${aliceName} was trying to achieve>",
  "bobIntent": "<one concise sentence describing what ${bobName} was trying to achieve>",
  "semanticConflict": <boolean — does the merged result potentially misrepresent either person's intent>,
  "suggestion": "<one actionable sentence for the collaborators, or null if no action needed>",
  "severity": "<'low' | 'medium' | 'high' — how urgently should collaborators review this>"
}`

  let analysis
  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content[0].text.trim()
    // Strip any accidental markdown fences
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    analysis = JSON.parse(clean)
  } catch (err) {
    // If LLM call fails or JSON parse fails, return a safe fallback
    // Never let LLM failure break the collaboration flow
    console.error('intentAnalyzer: LLM call failed:', err.message)
    analysis = {
      compatible: null,
      aliceIntent: 'Unable to analyze — LLM unavailable',
      bobIntent: 'Unable to analyze — LLM unavailable',
      semanticConflict: false,
      suggestion: null,
      severity: 'low',
      error: true
    }
  }

  // Cache the result — fire and forget
  pool.query(
    `INSERT INTO conflict_analyses
      (doc_id, thread_id, before_text, alice_edit, bob_edit, merged_result, context_text, analysis, model_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (thread_id) DO NOTHING`,
    [docId, threadId, beforeText, aliceEdit, bobEdit, mergedResult, contextText,
     JSON.stringify(analysis), 'claude-3-5-sonnet-20241022']
  ).catch(e => console.error('intentAnalyzer: cache write failed:', e.message))

  return analysis
}

/**
 * Compute a "document health score" — how many unresolved semantic conflicts exist.
 * Returns { total, high, medium, low, score: 0-100 }
 * Score 100 = no conflicts. Score 0 = many high-severity unresolved conflicts.
 */
async function getDocumentHealthScore(docId) {
  const result = await pool.query(
    `SELECT ca.analysis, a.resolved
     FROM conflict_analyses ca
     JOIN annotations a ON a.thread_id = ca.thread_id
     WHERE ca.doc_id = $1`,
    [docId]
  )

  const unresolved = result.rows.filter(r => !r.resolved)
  const counts = { high: 0, medium: 0, low: 0 }

  for (const row of unresolved) {
    const severity = row.analysis?.severity || 'low'
    counts[severity] = (counts[severity] || 0) + 1
  }

  const penalty = counts.high * 20 + counts.medium * 8 + counts.low * 2
  const score = Math.max(0, 100 - penalty)

  return {
    total: unresolved.length,
    ...counts,
    score,
    label: score >= 80 ? 'Healthy' : score >= 50 ? 'Needs Review' : 'Conflicts Present'
  }
}

module.exports = { analyzeConflict, getDocumentHealthScore }
