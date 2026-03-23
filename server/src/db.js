const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
});

async function initSchema() {
  // pgcrypto provides gen_random_uuid(). Without it, UUID generation fails at runtime.
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL DEFAULT 'Untitled Document',
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      yjs_state BYTEA,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS document_access (
      doc_id UUID REFERENCES documents(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      PRIMARY KEY (doc_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_id UUID REFERENCES documents(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      yjs_state BYTEA NOT NULL,
      version_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Append-only event log for replay functionality
    -- Every doc:update that hits the server gets logged here with wall-clock time
    CREATE TABLE IF NOT EXISTS doc_events (
      id           BIGSERIAL PRIMARY KEY,
      doc_id       UUID REFERENCES documents(id) ON DELETE CASCADE,
      event_type   TEXT NOT NULL,        -- 'doc:update' | 'chat:message' | 'thread:create' | 'conflict:detected'
      actor_id     UUID REFERENCES users(id),
      actor_name   TEXT NOT NULL,
      yjs_update   BYTEA,                -- The raw Yjs binary update (for doc:update events)
      payload      JSONB,                -- Structured data for chat/thread events
      clock        BIGINT NOT NULL,      -- Lamport clock value at time of event (from Y.Doc)
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    -- Persistent annotation anchors
    -- The CRDT anchor itself lives in Y.Doc — this table stores metadata about it
    CREATE TABLE IF NOT EXISTS annotations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_id       UUID REFERENCES documents(id) ON DELETE CASCADE,
      yjs_anchor   JSONB NOT NULL,       -- Serialized Y.RelativePosition for start + end
      thread_id    TEXT NOT NULL,        -- Matches Y.Map key in ydoc.getMap('threads')
      created_by   UUID REFERENCES users(id),
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      resolved     BOOLEAN DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS documents_updated_at_idx ON documents(updated_at);
    CREATE INDEX IF NOT EXISTS document_access_user_idx ON document_access(user_id);
    CREATE INDEX IF NOT EXISTS document_versions_doc_idx ON document_versions(doc_id);
    CREATE INDEX IF NOT EXISTS doc_events_doc_id_idx ON doc_events(doc_id, created_at);

    -- Causal provenance cache
    -- Walking the Yjs linked list is fast for small ranges but expensive for large docs
    -- Cache computed provenance results keyed by (docId, contentHash of range)
    -- TTL-invalidated when the document changes in that region
    CREATE TABLE IF NOT EXISTS provenance_cache (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_id       UUID REFERENCES documents(id) ON DELETE CASCADE,
      range_hash   TEXT NOT NULL,         -- SHA-256 of (fromIndex, toIndex, stateVector)
      chain        JSONB NOT NULL,        -- The computed causal chain result
      computed_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(doc_id, range_hash)
    );

    -- LLM conflict analysis results
    -- Store LLM responses so the same conflict is never analyzed twice
    CREATE TABLE IF NOT EXISTS conflict_analyses (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_id          UUID REFERENCES documents(id) ON DELETE CASCADE,
      thread_id       TEXT NOT NULL UNIQUE,    -- matches thread_id in doc_events
      before_text     TEXT NOT NULL,
      alice_edit      TEXT NOT NULL,
      bob_edit        TEXT NOT NULL,
      merged_result   TEXT NOT NULL,
      context_text    TEXT NOT NULL,
      analysis        JSONB NOT NULL,          -- LLM response: { compatible, aliceIntent, bobIntent, semanticConflict, suggestion }
      model_used      TEXT NOT NULL,
      computed_at     TIMESTAMPTZ DEFAULT NOW()
    );

    -- Maps Yjs Y.Doc.clientID (uint32) to our user UUID
    -- Populated when a user connects to a document session
    -- Needed to resolve "who wrote this character" from causal graph data
    CREATE TABLE IF NOT EXISTS session_clients (
      doc_id      UUID REFERENCES documents(id) ON DELETE CASCADE,
      yjs_client_id  BIGINT NOT NULL,   -- Y.Doc.clientID (uint32, stored as bigint)
      user_id     UUID REFERENCES users(id),
      user_name   TEXT NOT NULL,
      user_color  TEXT NOT NULL,
      first_seen  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (doc_id, yjs_client_id)
    );

    CREATE INDEX IF NOT EXISTS conflict_analyses_doc_idx ON conflict_analyses(doc_id);
    CREATE INDEX IF NOT EXISTS conflict_analyses_thread_idx ON conflict_analyses(thread_id);
    CREATE INDEX IF NOT EXISTS provenance_cache_doc_idx ON provenance_cache(doc_id);
  `);
}

module.exports = {
  pool,
  initSchema,
};

