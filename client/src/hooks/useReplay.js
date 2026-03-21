import { useState, useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import { getDocEvents } from '../api';

export function useReplay(docId, token) {
  const [events, setEvents] = useState([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [currentSnapshot, setCurrentSnapshot] = useState('');
  const [snapshotChat, setSnapshotChat] = useState([]);

  const fetchEvents = useCallback(async () => {
    try {
      const response = await getDocEvents(token, docId);
      setEvents(response.events);
    } catch (err) {
      console.error('[useReplay] failed to fetch events:', err);
    }
  }, [docId, token]);

  useEffect(() => {
    if (docId && token) {
      fetchEvents();
    }
  }, [docId, token, fetchEvents]);

  const stepTo = useCallback((index) => {
    if (index < 0 || index >= events.length) return;
    
    setReplayIndex(index);
    
    // Reconstruct Y.Doc state at this point
    const replayDoc = new Y.Doc();
    const chatAtPoint = [];
    
    for (let i = 0; i <= index; i++) {
      const event = events[i];
      if (event.event_type === 'doc:update' && event.yjs_update) {
        Y.applyUpdate(replayDoc, new Uint8Array(event.yjs_update));
      } else if (event.event_type === 'chat:message') {
        chatAtPoint.push(event.payload);
      }
    }
    
    setCurrentSnapshot(replayDoc.getText('codemirror').toString());
    setSnapshotChat(chatAtPoint);
  }, [events]);

  const startReplay = useCallback(() => {
    setIsReplaying(true);
    setReplayIndex(0);
    stepTo(0);
  }, [stepTo]);

  const stopReplay = useCallback(() => {
    setIsReplaying(false);
  }, []);

  return {
    events,
    isReplaying,
    replayIndex,
    startReplay,
    stopReplay,
    stepTo,
    currentSnapshot,
    snapshotChat
  };
}
