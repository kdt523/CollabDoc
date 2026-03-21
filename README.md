# CollabEdit (CRDT + Yjs via Socket.io)

Portfolio-grade real-time collaborative editor prototype using Yjs (CRDT) with Socket.io, Redis Pub/Sub, and PostgreSQL for persistence.

## Prerequisites

- Redis running locally on `localhost:6379` (no auth)
- PostgreSQL running locally on `localhost:5432`
- A database named `collabdb`

## Create PostgreSQL database

Run in `psql` (or your Postgres client):

```sql
CREATE DATABASE collabdb;
```

## Run locally

```bash
# 1. Copy and configure env
cp .env.example .env
# Edit .env if your local Postgres credentials differ.

# 2. Start server
cd server && npm install && node src/index.js

# 3. Start client (new terminal)
cd client && npm install && npm run dev

# 4. Open http://localhost:5173
```

## Notes

- Auth uses JWT + bcrypt (`/api/auth/register`, `/api/auth/login`).
- Documents are persisted as binary `Y.encodeStateAsUpdate()` blobs in PostgreSQL (`documents.yjs_state`).
- Cursor/selection presence is ephemeral via Socket.io `awareness:*` events (not stored in Postgres).

