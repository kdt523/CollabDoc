const Y = require('yjs');
const { pool } = require('./db');
const docManager = require('./docManager');
const persistence = require('./persistence');

function hashToHslColor(userId) {
  let hash = 0;
  const s = String(userId);
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  // y-codemirror uses colorLight to create selection background.
  const color = `hsl(${hue}, 70%, 55%)`;
  const colorLight = `hsla(${hue}, 70%, 55%, 0.2)`;
  return { color, colorLight };
}

function parseStateVectorMaybe(payload) {
  if (!payload) return null;
  // Socket.io serializes Uint8Array as an array of numbers.
  if (Array.isArray(payload)) return new Uint8Array(payload);
  if (payload instanceof Uint8Array) return payload;
  return null;
}

function inferDocIdFromSocket(socket) {
  // socket.rooms includes the socket.id itself. Any other room should be the docId.
  const rooms = Array.from(socket.rooms || []).filter((r) => r !== socket.id);
  return rooms[0] || null;
}

function setupRedisSubscriberRelay({ io, subscriber }) {
  subscriber.on('message', (channel, message) => {
    try {
      const docId = channel.replace('room:', '');

      // We send JSON payload: { update: number[], origin: socket.id }
      const raw =
        typeof message === 'string'
          ? message
          : Buffer.isBuffer(message)
            ? message.toString('utf8')
            : String(message);

      const payload = JSON.parse(raw);
      const update = payload?.update;
      const origin = payload?.origin;

      // Redis deduplication: if this update originated from a socket on *this* server,
      // local clients have already received the update via socket.to(docId).emit(...)
      if (origin && io.sockets.sockets.has(origin)) {
        return;
      }

      if (docId && Array.isArray(update)) {
        io.to(docId).emit('doc:update', update);
      }
    } catch (err) {
      console.error('[socketHandlers] redis relay failed:', err);
    }
  });
}

function ensureSubscribedRoom({ subscriber, room }) {
  if (!ensureSubscribedRoom.subscribed) ensureSubscribedRoom.subscribed = new Set();
  if (ensureSubscribedRoom.subscribed.has(room)) return;
  subscriber.subscribe(room).catch((err) => {
    console.error(`[socketHandlers] failed to subscribe ${room}:`, err);
  });
  ensureSubscribedRoom.subscribed.add(room);
}

function registerSocketHandlers({ io, publisher, subscriber }) {
  setupRedisSubscriberRelay({ io, subscriber });

  io.on('connection', (socket) => {
    socket.joinedDocId = null;
    socket.awarenessClientId = null; // numeric Yjs awareness clientID

    // doc:join — { docId, stateVector? , awarenessClientId? }
    socket.on('doc:join', async (payload) => {
      try {
        const docId = payload?.docId;
        if (!docId) {
          socket.emit('error', { code: 'BAD_REQUEST', message: 'docId is required' });
          return;
        }

        const stateVector = parseStateVectorMaybe(payload?.stateVector);
        const awarenessClientId = payload?.awarenessClientId ?? null;

        // 1) Verify access
        const { rows } = await pool.query(
          `SELECT role FROM document_access WHERE doc_id = $1 AND user_id = $2`,
          [docId, socket.user.userId]
        );
        if (!rows.length) {
          socket.emit('error', { code: 'FORBIDDEN', message: 'No access to document' });
          return;
        }

        socket.joinedDocId = docId;
        if (awarenessClientId != null) socket.awarenessClientId = awarenessClientId;

        // 2) join room
        await socket.join(docId);

        // 3) Load doc via persistence
        const serverDoc = docManager.getOrCreateDoc(docId);
        const loaded = await persistence.loadDoc(docId);
        if (loaded) {
          // Merge loaded state into the server doc (idempotent by CRDT IDs).
          const update = Y.encodeStateAsUpdate(loaded);
          Y.applyUpdate(serverDoc, update);
        }

        // 4/5) Sync with either delta-only or full init.
        const serverStateVector = docManager.getStateVector(docId);
        if (stateVector) {
          const delta = docManager.getMissingUpdates(docId, stateVector);
          socket.emit('doc:sync:response', {
            delta: Array.from(delta),
            serverStateVector: Array.from(serverStateVector),
          });
        } else {
          const stateUpdate = docManager.getStateAsUpdate(docId);
          socket.emit('doc:init', {
            update: Array.from(stateUpdate),
            serverStateVector: Array.from(serverStateVector),
          });
        }

        // 6) Ensure Redis pub/sub subscription
        ensureSubscribedRoom({ subscriber: subscriber, room: `room:${docId}` });

        // 7) Broadcast awareness:update to the room (initial presence).
        const { color, colorLight } = hashToHslColor(socket.user.userId);
        io.to(docId).emit('awareness:update', {
          clientId: socket.awarenessClientId || socket.id,
          userId: socket.user.userId,
          name: socket.user.name,
          color,
          colorLight,
          cursor: null,
          selection: null,
        });
      } catch (err) {
        console.error('[socketHandlers] doc:join failed:', err);
        socket.emit('error', { code: 'SERVER_ERROR', message: 'Failed to join' });
      }
    });

    // doc:sync — state vector only (legacy) or { docId, stateVector }.
    socket.on('doc:sync', async (payload) => {
      try {
        let docId;
        let stateVector;

        if (Array.isArray(payload)) {
          docId = inferDocIdFromSocket(socket);
          stateVector = parseStateVectorMaybe(payload);
        } else {
          docId = payload?.docId || inferDocIdFromSocket(socket);
          stateVector = parseStateVectorMaybe(payload?.stateVector);
        }

        if (!docId) {
          socket.emit('error', { code: 'NOT_JOINED', message: 'Join the document before syncing' });
          return;
        }
        if (!stateVector) {
          socket.emit('error', { code: 'BAD_REQUEST', message: 'stateVector is required' });
          return;
        }

        const delta = docManager.getMissingUpdates(docId, stateVector);
        const serverStateVector = docManager.getStateVector(docId);
        socket.emit('doc:sync:response', {
          delta: Array.from(delta),
          serverStateVector: Array.from(serverStateVector),
        });
      } catch (err) {
        console.error('[socketHandlers] doc:sync failed:', err);
        socket.emit('error', { code: 'SERVER_ERROR', message: 'Sync failed' });
      }
    });

    // doc:update — incremental CRDT update as Array<number>.
    socket.on('doc:update', async (updateArray) => {
      try {
        const docId = socket.joinedDocId || inferDocIdFromSocket(socket);
        if (!docId) {
          socket.emit('error', { code: 'NOT_JOINED', message: 'Join the document before updating' });
          return;
        }

        // 1) Convert Array -> Uint8Array
        const update = new Uint8Array(updateArray);

        // 2) Apply to server Y.Doc
        const serverDoc = docManager.getOrCreateDoc(docId);
        docManager.applyUpdate(docId, update);

        // 3) Broadcast to other local clients
        socket.to(docId).emit('doc:update', Array.from(update));

        // 4) Publish to Redis for other server instances (dedup via origin)
        const channel = `room:${docId}`;
        publisher.publish(
          channel,
          JSON.stringify({ update: Array.from(update), origin: socket.id })
        );

        // 5/6) Persist
        persistence.scheduleFlushToPostgres(docId, serverDoc);
        persistence.saveDocToRedis(docId, serverDoc).catch(() => {});
      } catch (err) {
        console.error('[socketHandlers] doc:update failed:', err);
      }
    });

    // awareness:update — { cursor, selection, name, color, colorLight, clientId? }
    socket.on('awareness:update', async (payload) => {
      const docId = socket.joinedDocId || inferDocIdFromSocket(socket);
      if (!docId) return;

      const clientId = payload?.clientId ?? socket.awarenessClientId ?? socket.id;
      socket.awarenessClientId = clientId;

      const cursor = payload?.cursor ?? null;
      const selection = payload?.selection ?? null;

      io.to(docId).emit('awareness:update', {
        clientId,
        userId: socket.user.userId,
        name: payload?.name ?? socket.user.name,
        color: payload?.color ?? null,
        colorLight: payload?.colorLight ?? null,
        cursor,
        selection,
      });
    });

    socket.on('disconnect', () => {
      const docId = socket.joinedDocId || null;
      if (!docId) return;

      const clientId = socket.awarenessClientId || socket.id;
      io.to(docId).emit('awareness:leave', { clientId });
    });
  });
}

module.exports = {
  registerSocketHandlers,
};

