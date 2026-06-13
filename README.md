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


## Deploying on Render

Set these environment variables on the Render backend service:

```bash
NODE_ENV=production
DATABASE_URL=<your Render Postgres Internal Database URL if the web service is in the same Render region, otherwise use the External Database URL>
DATABASE_SSL=true
REDIS_URL=<your Redis URL>
JWT_SECRET=<a long random production secret>
CLIENT_URL=https://collab-doc-phi.vercel.app
CORS_ORIGINS=https://collab-doc-phi.vercel.app
```

If Render logs show `getaddrinfo ENOTFOUND` for a host like `dpg-...-a`, the backend cannot resolve the Postgres hostname. In Render, make sure the backend and PostgreSQL database are in the same region when using the Internal Database URL. If they are not in the same region, use the database's External Database URL and keep `DATABASE_SSL=true`.

The browser CORS error can appear when the backend fails during startup before it can answer the preflight request. Fix the database connection first, then verify `CLIENT_URL` or `CORS_ORIGINS` exactly matches the deployed frontend origin, including `https://` and no trailing slash.
