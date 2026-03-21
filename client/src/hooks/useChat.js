import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { getSocket } from '../socket';

export function useChat(ydoc, token) {
  const [messages, setMessages] = useState([]);
  const [ephemeralMsgs, setEphemeralMsgs] = useState([]);
  const [threads, setThreads] = useState(new Map());

  const socket = getSocket(token);

  useEffect(() => {
    if (!ydoc) return;

    const msgsArray = ydoc.getArray('messages');
    const ephemArray = ydoc.getArray('ephemeral');
    const threadsMap = ydoc.getMap('threads');

    const updateMessages = () => {
      setMessages(msgsArray.toArray().map(m => m.toJSON()));
    };

    const updateEphemeral = () => {
      setEphemeralMsgs(ephemArray.toArray().map(m => m.toJSON()));
    };

    const updateThreads = () => {
      const newThreads = new Map();
      threadsMap.forEach((threadMeta, id) => {
        newThreads.set(id, threadMeta.toJSON());
      });
      setThreads(newThreads);
    };

    msgsArray.observe(updateMessages);
    ephemArray.observe(updateEphemeral);
    threadsMap.observeDeep(updateThreads); // use observeDeep for nested map/array changes

    // Initial load
    updateMessages();
    updateEphemeral();
    updateThreads();

    return () => {
      msgsArray.unobserve(updateMessages);
      ephemArray.unobserve(updateEphemeral);
      threadsMap.unobserveDeep(updateThreads);
    };
  }, [ydoc]);

  const sendMessage = useCallback((text, mode = 'persistent', mentions = [], threadId = null) => {
    if (!socket) return;
    socket.emit('chat:message', { text, mode, mentions, threadId });
  }, [socket]);

  const createThread = useCallback((selection, title, ytext) => {
    if (!socket || !ytext) return;
    
    const annotationId = crypto.randomUUID();
    const threadId = `thread_${annotationId}`;
    
    const anchorStart = Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(ytext, selection.from)
    );
    const anchorEnd = Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(ytext, selection.to)
    );
    
    socket.emit('thread:create', { 
      threadId, 
      annotationId, 
      anchorStart, 
      anchorEnd, 
      title 
    });
    
    return { threadId, annotationId };
  }, [socket]);

  const resolveThread = useCallback((threadId, annotationId) => {
    if (!socket) return;
    socket.emit('thread:resolve', { threadId, annotationId });
  }, [socket]);

  return {
    messages,
    ephemeralMsgs,
    threads,
    sendMessage,
    createThread,
    resolveThread
  };
}
