const Y = require('yjs');
const { pool } = require('./db');
const docManager = require('./docManager');
const persistence = require('./persistence');
const chatManager = require('./chatManager');
const eventLogger = require('./eventLogger');
const conflictDetector = require('./conflictDetector');
const callManager = require('./callManager');
const contributionMapper = require('./contributionMapper');


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

  // NEW: WebRTC signaling relay across servers
  subscriber.on('message', (channel, message) => {
    if (!channel.startsWith('signal:')) return;
    const docId = channel.replace('signal:', '');
    try {
      const { type, from, to, payload } = JSON.parse(message);
      if (to) {
        const targetSocket = io.sockets.sockets.get(to);
        if (targetSocket) {
          targetSocket.emit(type, { from, ...payload });
        }
      } else {
        io.to(docId).except(from).emit(type, { from, ...payload });
      }
    } catch (e) {
      console.error('[socketHandlers] signal relay failed:', e);
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
    socket.awarenessClientId = null;

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
        await socket.join(docId);

        // 3) Load doc
        const serverDoc = docManager.getOrCreateDoc(docId);
        const yjsClientId = serverDoc.clientID;

        contributionMapper.registerClientId(docId, yjsClientId, {
          userId: socket.user.userId,
          name: socket.user.name,
          color: socket.user.color || '#888'
        });

        // Persist the mapping so past sessions can be resolved too
        pool.query(
          `INSERT INTO session_clients (doc_id, yjs_client_id, user_id, user_name, user_color)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (doc_id, yjs_client_id) DO UPDATE
           SET user_name = $4, user_color = $5`,
          [docId, yjsClientId, socket.user.userId, socket.user.name, socket.user.color || '#888']
        ).catch(() => {});

        const loaded = await persistence.loadDoc(docId);
        if (loaded) {
          Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(loaded));
        }

        // 4) Initial Sync
        const serverStateVector = docManager.getStateVector(docId);
        if (stateVector) {
          const delta = docManager.getMissingUpdates(docId, stateVector);
          socket.emit('doc:sync:response', {
            delta: Array.from(delta),
            serverStateVector: Array.from(serverStateVector),
            activeCallers: callManager.getCallParticipants(docId),
          });
        } else {
          const stateUpdate = docManager.getStateAsUpdate(docId);
          socket.emit('doc:init', {
            update: Array.from(stateUpdate),
            serverStateVector: Array.from(serverStateVector),
            activeCallers: callManager.getCallParticipants(docId),
          });
        }

        ensureSubscribedRoom({ subscriber: subscriber, room: `room:${docId}` });
        ensureSubscribedRoom({ subscriber: subscriber, room: `signal:${docId}` });

        // 5) Broadcast awareness
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

        // 6) CRITICAL: CRDT Broadcast Listener for server-side changes
        if (serverDoc && !serverDoc.broadcastBound) {
          serverDoc.on('update', (update, origin) => {
            if (origin === 'server-init') {
              // We use the room ID from the closure
              io.to(docId).emit('doc:update', Array.from(update));
            }
          });
          serverDoc.broadcastBound = true;
        }

      } catch (err) {
        console.error('[socketHandlers] doc:join failed:', err);
        socket.emit('error', { code: 'SERVER_ERROR', message: 'Failed to join' });
      }
    });

    // doc:sync
    socket.on('doc:sync', async (payload) => {
      try {
        let docId = payload?.docId || inferDocIdFromSocket(socket);
        let stateVector = parseStateVectorMaybe(payload?.stateVector || payload);
        if (!docId || !stateVector) return;

        const delta = docManager.getMissingUpdates(docId, stateVector);
        const serverStateVector = docManager.getStateVector(docId);
        socket.emit('doc:sync:response', {
          delta: Array.from(delta),
          serverStateVector: Array.from(serverStateVector),
        });
      } catch (err) {
        console.error('[socketHandlers] doc:sync failed:', err);
      }
    });

    // doc:update
    socket.on('doc:update', async (updateArray) => {
      try {
        const docId = socket.joinedDocId || inferDocIdFromSocket(socket);
        if (!docId) return;

        const update = new Uint8Array(updateArray);
        const serverDoc = docManager.getOrCreateDoc(docId);
        docManager.applyUpdate(docId, update);

        socket.to(docId).emit('doc:update', Array.from(update));
        publisher.publish(`room:${docId}`, JSON.stringify({ update: Array.from(update), origin: socket.id }));

        // Conflict Detection
        const ranges = conflictDetector.extractAffectedRanges(update, serverDoc);
        const conflict = conflictDetector.detectConflict(docId, socket.id, ranges);
        conflictDetector.recordEdit(docId, socket.id, socket.user.userId, socket.user.name, ranges);

        if (conflict.detected) {
          const threadId = `conflict_${Date.now()}`;
          const conflictingUsers = [socket.user.name, conflict.conflictingEdit.userName];
          chatManager.createThread(serverDoc, {
            threadId,
            triggerType: 'conflict',
            title: `Conflict: ${socket.user.name} and ${conflict.conflictingEdit.userName}`,
            conflictingUsers
          });
          chatManager.addThreadReply(serverDoc, threadId, {
            id: `sys_${Date.now()}`,
            authorId: 'system',
            authorName: 'CollabEdit',
            text: `@${socket.user.name} and @${conflict.conflictingEdit.userName} edited overlapping text.`,
            mentions: [socket.user.userId, conflict.conflictingEdit.userId]
          });

          // NEW: capture text context for LLM analysis
          const ytext = serverDoc.getText('content');
          const fullText = ytext.toString();

          // Find the conflicting region in the current text
          const conflictFrom = Math.max(0, Math.min(...ranges.map(r => r.from)) - 10);
          const conflictTo = Math.min(fullText.length, Math.max(...ranges.map(r => r.to)) + 10);
          const mergedResult = fullText.slice(conflictFrom, conflictTo);

          // Context window: 250 chars before and after the conflict
          const contextFrom = Math.max(0, conflictFrom - 250);
          const contextTo = Math.min(fullText.length, conflictTo + 250);
          const contextText = fullText.slice(contextFrom, contextTo);

          eventLogger.logEvent(docId, 'conflict:detected', socket.user, {
            payload: {
              threadId,
              conflictingUsers: [socket.user.name, conflict.conflictingEdit.userName],
              // Text snapshots for LLM analysis — stored in JSONB payload
              beforeText: conflict.conflictingEdit.textBefore || '',
              aliceEdit: conflict.conflictingEdit.editedText || '',
              bobEdit: mergedResult,
              mergedResult,
              contextText,
              ranges: ranges
            },
            clock: Y.encodeStateVector(serverDoc).length
          });
        }

        eventLogger.logEvent(docId, 'doc:update', socket.user, {
          yjsUpdate: update,
          clock: Y.encodeStateVector(serverDoc).length
        });

        persistence.scheduleFlushToPostgres(docId, serverDoc);
        persistence.saveDocToRedis(docId, serverDoc).catch(() => {});
      } catch (err) {
        console.error('[socketHandlers] doc:update failed:', err);
      }
    });

    // chat:message
    socket.on('chat:message', (data) => {
      const docId = socket.joinedDocId || inferDocIdFromSocket(socket);
      if (!docId) return;
      const serverDoc = docManager.getOrCreateDoc(docId);
      const msgId = `msg_${Date.now()}`;

      if (data.threadId) {
        chatManager.addThreadReply(serverDoc, data.threadId, {
          id: msgId,
          authorId: socket.user.userId,
          authorName: socket.user.name,
          text: data.text,
          mentions: data.mentions || []
        });
      } else {
        chatManager.createMessage(serverDoc, {
          id: msgId,
          authorId: socket.user.userId,
          authorName: socket.user.name,
          authorColor: socket.user.color,
          text: data.text,
          mentions: data.mentions || [],
          mode: data.mode || 'persistent'
        });
      }

      eventLogger.logEvent(docId, 'chat:message', socket.user, {
        payload: { msgId, text: data.text, mode: data.mode, threadId: data.threadId },
        clock: Y.encodeStateVector(serverDoc).length
      });
    });

    // thread:create
    socket.on('thread:create', async (data) => {
      const docId = socket.joinedDocId || inferDocIdFromSocket(socket);
      if (!docId) return;
      const serverDoc = docManager.getOrCreateDoc(docId);

      chatManager.createThread(serverDoc, {
        threadId: data.threadId,
        triggerType: 'manual',
        annotationId: data.annotationId,
        title: data.title
      });

      chatManager.createAnnotation(serverDoc, {
        id: data.annotationId,
        anchor: { start: data.anchorStart, end: data.anchorEnd },
        threadId: data.threadId,
        authorId: socket.user.userId
      });

      await pool.query(
        `INSERT INTO annotations (id, doc_id, yjs_anchor, thread_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [data.annotationId, docId, JSON.stringify({ start: data.anchorStart, end: data.anchorEnd }), data.threadId, socket.user.userId]
      );

      eventLogger.logEvent(docId, 'thread:create', socket.user, {
        payload: { threadId: data.threadId, annotationId: data.annotationId, title: data.title },
        clock: Y.encodeStateVector(serverDoc).length
      });
    });

    // thread:resolve
    socket.on('thread:resolve', async (data) => {
      const docId = socket.joinedDocId || inferDocIdFromSocket(socket);
      if (!docId) return;
      const serverDoc = docManager.getOrCreateDoc(docId);
      chatManager.resolveThread(serverDoc, data.threadId);
      await pool.query('UPDATE annotations SET resolved = true WHERE id = $1', [data.annotationId]);
    });

    // ─── CALL EVENTS ───────────────────────────────────────────────

    socket.on('call:join', () => {
      const docId = socket.joinedDocId;
      if (!docId) return;

      callManager.joinCall(docId, socket.id, {
        userId: socket.user.userId,
        name: socket.user.name,
        color: socket.user.color || '#888'
      });

      const existing = callManager.getCallParticipants(docId).filter(p => p.socketId !== socket.id);
      
      // Specifically tell the joiner who is already in the call
      socket.emit('call:participants', existing);
      
      // Also broadcast to the room that a join event happened (this prompts offers)
      socket.to(docId).emit('call:peer-joined', {
        socketId: socket.id,
        userId: socket.user.userId,
        name: socket.user.name,
        color: socket.user.color || '#888'
      });

      publisher.publish(`signal:${docId}`, JSON.stringify({
        type: 'call:peer-joined',
        from: socket.id,
        payload: { socketId: socket.id, userId: socket.user.userId, name: socket.user.name }
      }));
    });

    socket.on('call:leave', () => {
      const docId = socket.joinedDocId;
      if (!docId) return;

      callManager.leaveCall(docId, socket.id);
      socket.to(docId).emit('call:peer-left', { socketId: socket.id });
      publisher.publish(`signal:${docId}`, JSON.stringify({
        type: 'call:peer-left',
        from: socket.id,
        payload: { socketId: socket.id }
      }));
    });

    socket.on('signal:offer', ({ to, offer }) => {
      const targetSocket = io.sockets.sockets.get(to);
      if (targetSocket) {
        targetSocket.emit('signal:offer', { from: socket.id, offer });
      } else {
        publisher.publish(`signal:${socket.joinedDocId}`, JSON.stringify({
          type: 'signal:offer',
          from: socket.id,
          to,
          payload: { offer }
        }));
      }
    });

    socket.on('signal:answer', ({ to, answer }) => {
      const targetSocket = io.sockets.sockets.get(to);
      if (targetSocket) {
        targetSocket.emit('signal:answer', { from: socket.id, answer });
      } else {
        publisher.publish(`signal:${socket.joinedDocId}`, JSON.stringify({
          type: 'signal:answer',
          from: socket.id,
          to,
          payload: { answer }
        }));
      }
    });

    socket.on('signal:ice', ({ to, candidate }) => {
      const targetSocket = io.sockets.sockets.get(to);
      if (targetSocket) {
        targetSocket.emit('signal:ice', { from: socket.id, candidate });
      } else {
        publisher.publish(`signal:${socket.joinedDocId}`, JSON.stringify({
          type: 'signal:ice',
          from: socket.id,
          to,
          payload: { candidate }
        }));
      }
    });

    socket.on('call:state-change', (state) => {
      socket.to(socket.joinedDocId).emit('call:peer-state-change', {
        socketId: socket.id,
        ...state
      });
    });

    // awareness:update
    socket.on('awareness:update', async (payload) => {
      const docId = socket.joinedDocId || inferDocIdFromSocket(socket);
      if (!docId) return;
      const clientId = payload?.clientId ?? socket.awarenessClientId ?? socket.id;
      io.to(docId).emit('awareness:update', {
        clientId,
        userId: socket.user.userId,
        name: payload?.name ?? socket.user.name,
        color: payload?.color ?? null,
        cursor: payload?.cursor ?? null,
        selection: payload?.selection ?? null,
      });
    });

    socket.on('disconnect', () => {
      const docId = socket.joinedDocId;
      if (!docId) return;
      io.to(docId).emit('awareness:leave', { clientId: socket.awarenessClientId || socket.id });
      const room = io.sockets.adapter.rooms.get(docId);
      if (!room || room.size === 0) {
        chatManager.clearEphemeral(docManager.getOrCreateDoc(docId));
      }

      const leftCallDocId = callManager.handleDisconnect(socket.id);
      if (leftCallDocId) {
        io.to(leftCallDocId).emit('call:peer-left', { socketId: socket.id });
      }
    });

  });
}

module.exports = {
  registerSocketHandlers,
};

