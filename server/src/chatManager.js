const Y = require('yjs');

const SERVER_ORIGIN = 'server-init';

function createMessage(ydoc, { id, authorId, authorName, authorColor, text, mentions, mode }) {
  ydoc.transact(() => {
    const msgMap = new Y.Map();
    msgMap.set('id', id);
    msgMap.set('authorId', authorId);
    msgMap.set('authorName', authorName);
    msgMap.set('authorColor', authorColor);
    msgMap.set('text', text);
    msgMap.set('timestamp', Date.now());
    msgMap.set('mode', mode);
    msgMap.set('edited', false);

    const yMentions = new Y.Array();
    if (Array.isArray(mentions)) {
      yMentions.push(mentions);
    }
    msgMap.set('mentions', yMentions);

    if (mode === 'ephemeral') {
      ydoc.getArray('ephemeral').insert(0, [msgMap]);
    } else {
      ydoc.getArray('messages').insert(0, [msgMap]);
    }
  }, SERVER_ORIGIN);
}

function createThread(ydoc, { threadId, triggerType, annotationId, title, conflictingUsers }) {
  ydoc.transact(() => {
    const threadsMap = ydoc.getMap('threads');
    if (!threadsMap.has(threadId)) {
      const threadMeta = new Y.Map();
      threadMeta.set('id', threadId);
      threadMeta.set('triggerType', triggerType);
      threadMeta.set('annotationId', annotationId);
      threadMeta.set('title', title);
      threadMeta.set('createdAt', Date.now());
      threadMeta.set('resolved', false);

      if (Array.isArray(conflictingUsers)) {
        const yConfMeta = new Y.Array();
        yConfMeta.push(conflictingUsers);
        threadMeta.set('conflictingUsers', yConfMeta);
      }
      
      const repliesArray = new Y.Array();
      threadMeta.set('replies', repliesArray);
      
      threadsMap.set(threadId, threadMeta);
    }
  }, SERVER_ORIGIN);
}

function addThreadReply(ydoc, threadId, { id, authorId, authorName, text, mentions }) {
  ydoc.transact(() => {
    const threadsMap = ydoc.getMap('threads');
    const threadMeta = threadsMap.get(threadId);
    if (threadMeta) {
      const repliesArray = threadMeta.get('replies');
      if (repliesArray) {
        const replyMap = new Y.Map();
        replyMap.set('id', id);
        replyMap.set('authorId', authorId);
        replyMap.set('authorName', authorName);
        replyMap.set('text', text);
        replyMap.set('timestamp', Date.now());
        
        const yMentions = new Y.Array();
        if (Array.isArray(mentions)) {
          yMentions.push(mentions);
        }
        replyMap.set('mentions', yMentions);
        
        repliesArray.push([replyMap]);
      }
    }
  }, SERVER_ORIGIN);
}

function resolveThread(ydoc, threadId) {
  ydoc.transact(() => {
    const threadsMap = ydoc.getMap('threads');
    const threadMeta = threadsMap.get(threadId);
    if (threadMeta) {
      threadMeta.set('resolved', true);
    }
  }, SERVER_ORIGIN);
}

function createAnnotation(ydoc, { id, anchor, threadId, authorId }) {
  ydoc.transact(() => {
    const annotationsMap = ydoc.getMap('annotations');
    const annotation = new Y.Map();
    annotation.set('id', id);
    annotation.set('anchor', anchor);
    annotation.set('threadId', threadId);
    annotation.set('authorId', authorId);
    annotation.set('createdAt', Date.now());
    annotationsMap.set(id, annotation);
  }, SERVER_ORIGIN);
}

function clearEphemeral(ydoc) {
  ydoc.transact(() => {
    const ephemeral = ydoc.getArray('ephemeral');
    if (ephemeral.length > 0) {
      ephemeral.delete(0, ephemeral.length);
    }
  }, SERVER_ORIGIN);
}

module.exports = {
  createMessage,
  createThread,
  addThreadReply,
  resolveThread,
  createAnnotation,
  clearEphemeral
};
