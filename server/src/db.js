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
  `);
}

module.exports = {
  pool,
  initSchema,
};

