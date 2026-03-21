import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { getSocket } from '../socket.js';
import { useAuth } from './useAuth.js';

function hashToHslColor(userId) {
  let hash = 0;
  const s = String(userId);
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const color = `hsl(${hue}, 70%, 55%)`;
  const colorLight = `hsla(${hue}, 70%, 55%, 0.2)`;
  return { color, colorLight };
}

// Minimal awareness implementation compatible with `y-codemirror.next`'s remote cursor rendering.
// We intentionally avoid pulling in `y-protocols` so the project can build with the requested deps list.
class SimpleAwareness {
  constructor(doc) {
    this.doc = doc;
    this.states = new Map(); // Map<clientId, state>
    this._listeners = new Map(); // event -> Set<fn>
  }

  on(eventName, fn) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(fn);
  }

  off(eventName, fn) {
    this._listeners.get(eventName)?.delete(fn);
  }

  emit(eventName, payload) {
    for (const fn of this._listeners.get(eventName) || []) {
      try {
        fn(payload);
      } catch (err) {
        // Avoid crashing the editor due to a buggy listener.
        console.error('[SimpleAwareness] listener error:', err);
      }
    }
  }

  getLocalState() {
    return this.states.get(this.doc.clientID) || null;
  }

  getStates() {
    return this.states;
  }

  setLocalStateField(fieldName, value) {
    const localId = this.doc.clientID;
    const prev = this.states.get(localId) || {};
    let nextValue = value;

    // y-codemirror.next expects cursor anchor/head to be JSON-relative positions.
    // The editor binding will call setLocalStateField('cursor', { anchor, head }) where
    // anchor/head are Y.RelativePosition objects; we normalize them to JSON.
    if (fieldName === 'cursor' && value && typeof value === 'object') {
      const anchor = value.anchor;
      const head = value.head;
      nextValue = {
        ...value,
        anchor: anchor && typeof anchor.toJSON === 'function' ? anchor.toJSON() : anchor,
        head: head && typeof head.toJSON === 'function' ? head.toJSON() : head,
      };
    }

    const next = { ...prev, [fieldName]: nextValue };
    this.states.set(localId, next);
    this.emit('change', { added: [], updated: [localId], removed: [] });
  }

  setLocalState(state) {
    const localId = this.doc.clientID;
    if (state === null) {
      this.states.delete(localId);
      this.emit('change', { added: [], updated: [], removed: [localId] });
      return;
    }
    if (state && typeof state === 'object' && state.cursor) {
      const anchor = state.cursor.anchor;
      const head = state.cursor.head;
      state = {
        ...state,
        cursor: {
          ...state.cursor,
          anchor: anchor && typeof anchor.toJSON === 'function' ? anchor.toJSON() : anchor,
          head: head && typeof head.toJSON === 'function' ? head.toJSON() : head,
        },
      };
    }
    this.states.set(localId, state);
    this.emit('change', { added: [], updated: [localId], removed: [] });
  }
}

export function useCollabDoc(docId, { enabled = true } = {}) {
  const { user, token } = useAuth();

  const [ydoc, setYdoc] = useState(null);
  const [ytext, setYtext] = useState(null);
  const [awareness, setAwareness] = useState(null);
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('offline'); // 'connected' | 'reconnecting' | 'offline'

  const peersMapRef = useRef(new Map()); // clientId -> peer data
  const joinedOnceRef = useRef(false);
  const joinedRef = useRef(false);
  const pendingUpdatesRef = useRef([]); // Uint8Array[] generated before we join
  const sendAwarenessRef = useRef(() => {});
  const debugLog = useRef([]); // max 50 entries

  const myColors = useMemo(() => {
    if (!user?.id) return { color: '#30bced', colorLight: '#30bced33' };
    return hashToHslColor(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!enabled || !docId || !token || !user) return;

    const socket = getSocket(token);
    if (!socket) return;

    const ydocInstance = new Y.Doc();
    const ytextInstance = ydocInstance.getText('codemirror');
    const awarenessInstance = new SimpleAwareness(ydocInstance);

    // Set local identity for cursor rendering (y-remote-selections reads awareness.states.user.*).
    awarenessInstance.setLocalStateField('user', {
      name: user.name,
      color: myColors.color,
      colorLight: myColors.colorLight,
    });
    awarenessInstance.setLocalStateField('cursor', null);

    setYdoc(ydocInstance);
    setYtext(ytextInstance);
    setAwareness(awarenessInstance);

    // IndexedDB persistence: load local state ASAP so the user sees content immediately.
    const indexedDBPersistence = new IndexeddbPersistence(docId, ydocInstance);

    let didCancel = false;
    indexedDBPersistence.whenSynced
      .then(() => {
        if (didCancel) return;
        setSynced(true);
      })
      .catch(() => {
        if (didCancel) return;
        setSynced(true);
      });

    // CRDT update propagation: send local changes to the server.
    const onYdocUpdate = (update, origin) => {
      if (origin === 'remote') return;
      if (!joinedRef.current) {
        // Buffer until we have joined the doc room; otherwise the server may reject updates.
        pendingUpdatesRef.current.push(update.slice());
        return;
      }
      // Socket.io serializes Uint8Array as arrays of numbers.
      socket.emit('doc:update', Array.from(update));
    };
    ydocInstance.on('update', onYdocUpdate);

    const onDocInit = (payload) => {
      const update = new Uint8Array(payload.update);
      const serverStateVector = new Uint8Array(payload.serverStateVector);
      Y.applyUpdate(ydocInstance, update, 'remote');

      // Send back updates missing on the server
      const clientUpdate = Y.encodeStateAsUpdate(ydocInstance, serverStateVector);
      if (clientUpdate.length > 2) {
        socket.emit('doc:update', Array.from(clientUpdate));
      }
    };

    const onDocSyncResponse = (payload) => {
      const update = new Uint8Array(payload.delta);
      const serverStateVector = new Uint8Array(payload.serverStateVector);
      Y.applyUpdate(ydocInstance, update, 'remote');

      // Send back updates missing on the server
      const clientUpdate = Y.encodeStateAsUpdate(ydocInstance, serverStateVector);
      if (clientUpdate.length > 2) {
        socket.emit('doc:update', Array.from(clientUpdate));
      }
    };

    const onDocUpdate = (updateArray) => {
      const update = new Uint8Array(updateArray);
      Y.applyUpdate(ydocInstance, update, 'remote');
      
      const receivedAt = Date.now();
      debugLog.current = [
        { socketId: 'remote', receivedAt, size: updateArray.length },
        ...debugLog.current.slice(0, 49)
      ].filter(Boolean);
    };

    // Awareness handling: relay remote cursors into the local awareness instance.
    const onAwarenessUpdate = (peer) => {
      if (!peer) return;

      const peerClientId = peer.clientId;
      const peerUserId = peer.userId;
      if (!peerClientId || !peerUserId) return;

      // Keep our own peer out of the "others editing" list.
      if (peerUserId === user.id || peerClientId === awarenessInstance.doc.clientID) {
        // Still update awareness if needed, but avoid UI duplication.
      } else {
        peersMapRef.current.set(peerClientId, {
          clientId: peerClientId,
          userId: peerUserId,
          name: peer.name,
          color: peer.color,
          colorLight: peer.colorLight,
        });
        setPeers(Array.from(peersMapRef.current.values()));
      }

      if (peerClientId === awarenessInstance.doc.clientID) return;

      awarenessInstance.states.set(peerClientId, {
        user: {
          name: peer.name,
          color: peer.color,
          colorLight: peer.colorLight,
        },
        cursor: peer.cursor ?? null,
      });

      awarenessInstance.emit('change', {
        added: [],
        updated: [peerClientId],
        removed: [],
      });
    };

    const onAwarenessLeave = ({ clientId }) => {
      if (!clientId) return;

      peersMapRef.current.delete(clientId);
      setPeers(Array.from(peersMapRef.current.values()));

      if (clientId === awarenessInstance.doc.clientID) return;

      awarenessInstance.states.delete(clientId);
      awarenessInstance.emit('change', {
        added: [],
        updated: [],
        removed: [clientId],
      });
    };

    const onError = (payload) => {
      const code = payload?.code;
      if (code === 'NOT_JOINED') {
        joinedRef.current = false;
        // Fallback if the server lost our room state on reconnect.
        const stateVector = Y.encodeStateVector(ydocInstance);
        socket.emit('doc:join', {
          docId,
          stateVector: Array.from(stateVector),
          awarenessClientId: awarenessInstance.doc.clientID,
        });
        joinedOnceRef.current = true;
        joinedRef.current = true;
        for (const pending of pendingUpdatesRef.current) {
          socket.emit('doc:update', Array.from(pending));
        }
        pendingUpdatesRef.current = [];
      }
    };

    // Socket connection lifecycle: join once, then request delta on reconnect.
    const doJoinOrSync = () => {
      const stateVector = Y.encodeStateVector(ydocInstance);
      if (!joinedOnceRef.current) {
        socket.emit('doc:join', {
          docId,
          stateVector: Array.from(stateVector),
          awarenessClientId: awarenessInstance.doc.clientID,
        });
        joinedOnceRef.current = true;
      } else {
        socket.emit('doc:sync', Array.from(stateVector));
      }

      joinedRef.current = true;
      // Flush any updates made while disconnected.
      if (pendingUpdatesRef.current.length > 0) {
        for (const pending of pendingUpdatesRef.current) {
          socket.emit('doc:update', Array.from(pending));
        }
        pendingUpdatesRef.current = [];
      }
    };

    // Set initial status + attach listeners.
    const updateStatus = () => {
      if (socket.connected) setConnectionStatus('connected');
      else setConnectionStatus('offline');
    };

    updateStatus();

    const onConnect = () => {
      setConnectionStatus('connected');
      doJoinOrSync();
    };
    const onDisconnect = () => setConnectionStatus('offline');
    const onReconnectAttempt = () => setConnectionStatus('reconnecting');

    // Bind listeners
    socket.on('doc:init', onDocInit);
    socket.on('doc:sync:response', onDocSyncResponse);
    socket.on('doc:update', onDocUpdate);

    socket.on('awareness:update', onAwarenessUpdate);
    socket.on('awareness:leave', onAwarenessLeave);
    socket.on('error', onError);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);

    // Trigger initial join immediately if already connected.
    if (socket.connected) {
      doJoinOrSync();
    }

    function sendAwareness(cursor, selection) {
      socket.emit('awareness:update', {
        clientId: awarenessInstance.doc.clientID,
        cursor,
        selection,
        name: user.name,
        color: myColors.color,
        colorLight: myColors.colorLight,
      });
    }
    sendAwarenessRef.current = sendAwareness;

    // Cleanup
    return () => {
      didCancel = true;

      socket.off('doc:init', onDocInit);
      socket.off('doc:sync:response', onDocSyncResponse);
      socket.off('doc:update', onDocUpdate);
      socket.off('awareness:update', onAwarenessUpdate);
      socket.off('awareness:leave', onAwarenessLeave);
      socket.off('error', onError);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);

      ydocInstance.off('update', onYdocUpdate);
      ydocInstance.destroy();
    };
  }, [docId, enabled, token, user, myColors.color, myColors.colorLight]);

  return {
    ydoc,
    ytext,
    synced,
    peers,
    sendAwareness: (...args) => sendAwarenessRef.current(...args),
    connectionStatus,
    awareness,
    debugLog: debugLog.current,
  };
}

