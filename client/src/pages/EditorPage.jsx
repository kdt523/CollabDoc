import React, { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useCollabDoc } from '../hooks/useCollabDoc.js';
import DocHeader from '../components/DocHeader.jsx';
import PeerCursors from '../components/PeerCursors.jsx';
import Editor from '../components/Editor.jsx';
import VersionHistory from '../components/VersionHistory.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import AnnotationGutter from '../components/AnnotationGutter.jsx';
import ReplayTimeline from '../components/ReplayTimeline.jsx';
import CRDTDebugPanel from '../components/CRDTDebugPanel.jsx';
import ThreadPopover from '../components/ThreadPopover.jsx';
import CallWindow from '../components/CallWindow.jsx';

import { getSocket } from '../socket.js';

import { useChat } from '../hooks/useChat.js';
import { useAnnotations } from '../hooks/useAnnotations.js';
import { useReplay } from '../hooks/useReplay.js';

import { 
  getDocMeta, 
  patchDocTitle, 
  shareDoc, 
  joinSharedDoc,
  resolveAnnotation
} from '../api.js';

import '../styles/editor.css';
import '../styles/chat.css';
import '../styles/annotations.css';
import '../styles/replay.css';
import '../styles/debug.css';
import '../styles/call.css';

export default function EditorPage() {
  const { docId } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const shareToken = searchParams.get('shareToken');

  const [shareAccessReady, setShareAccessReady] = useState(!shareToken);
  
  const { 
    ydoc, 
    ytext, 
    synced, 
    peers, 
    sendAwareness, 
    connectionStatus, 
    awareness,
    debugLog 
  } = useCollabDoc(docId, {
    enabled: shareAccessReady,
  });

  const {
    messages,
    ephemeralMsgs,
    threads,
    sendMessage,
    createThread,
    resolveThread: resolveChatThread
  } = useChat(ydoc, token);

  const {
    annotations
  } = useAnnotations(ydoc);

  const {
    events,
    isReplaying,
    replayIndex,
    startReplay,
    stopReplay,
    stepTo,
    currentSnapshot,
    snapshotChat
  } = useReplay(docId, token);

  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState('');
  const [title, setTitle] = useState('Untitled Document');
  const [canEdit, setCanEdit] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  const [shareError, setShareError] = useState('');
  
  const [showHistory, setShowHistory] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [activePopover, setActivePopover] = useState(null);

  useEffect(() => {
    setShareAccessReady(!shareToken);
  }, [shareToken]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!shareToken || shareAccessReady) return;

      setMetaLoading(true);
      setMetaError('');
      try {
        await joinSharedDoc(token, shareToken);
        if (cancelled) return;
        setShareAccessReady(true);
        navigate(`/editor/${docId}`, { replace: true });
      } catch (err) {
        if (cancelled) return;
        setMetaError(err?.message || 'Failed to join shared document');
        setMetaLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [shareToken, shareAccessReady, token, docId, navigate]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!shareAccessReady) return;

      setMetaLoading(true);
      setMetaError('');
      try {
        const meta = await getDocMeta(token, docId);
        if (cancelled) return;
        setTitle(meta.title || 'Untitled Document');
        setCanEdit(!!meta.canEdit);
      } catch (err) {
        if (cancelled) return;
        setMetaError(err?.message || 'Failed to load document');
      } finally {
        if (cancelled) return;
        setMetaLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [shareAccessReady, token, docId]);

  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') setDebugOpen(v => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function onTitleChange(nextTitle) {
    setTitle(nextTitle);
    await patchDocTitle(token, docId, nextTitle);
  }

  async function onShare() {
    setShareNotice('');
    setShareError('');
    try {
      const result = await shareDoc(token, docId);
      const shareUrl = result.shareUrl;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareNotice('Share link copied to clipboard.');
        return;
      }
      window.prompt('Copy this share link:', shareUrl);
      setShareNotice('Share link generated.');
    } catch (err) {
      setShareError(err?.message || 'Failed to generate share link');
      throw err;
    }
  }

  const onHandleComment = (threadTitle) => {
    if (activePopover?.selection) {
      createThread(activePopover.selection, threadTitle, ytext);
      setActivePopover(null);
    }
  };

  const onResolve = async (threadId) => {
    const annId = activePopover?.thread?.annotationId || activePopover?.annotationId;
    resolveChatThread(threadId, annId);
    if (annId) {
      await resolveAnnotation(token, docId, annId, threadId);
    }
    setActivePopover(null);
  };

  const handleSelectionChange = React.useCallback((selection, pos) => {
    if (selection && selection.from !== selection.to) {
      setActivePopover({ ...pos, selection });
    } else if (!activePopover?.thread) {
      setActivePopover(null);
    }
  }, [activePopover?.thread]);

  if (metaLoading) return <div className="app-card" style={{ margin: 24, padding: 16 }}>Loading document...</div>;
  if (metaError) return <div className="app-card" style={{ margin: 24, padding: 16 }}>{metaError}</div>;

  return (
    <div className={`editor-page ${chatOpen ? 'chat-open' : ''} ${isReplaying ? 'replaying' : ''}`}>
      <DocHeader
        title={title}
        canEdit={canEdit}
        peers={peers}
        onTitleChange={onTitleChange}
        onShare={onShare}
        onShowHistory={() => setShowHistory(true)}
        onChatToggle={() => setChatOpen(!chatOpen)}
        onReplayToggle={startReplay}
        connectionStatus={connectionStatus}
        shareNotice={shareNotice}
        shareError={shareError}
      />
      
      <div className="editor-layout" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <AnnotationGutter 
          annotations={annotations}
          editorView={window.cmView}
          onAnnotationClick={(ann) => {
            const thread = threads.get(ann.thread_id);
            setActivePopover({ 
              top: 100, // actual positioning can be improved with coordsAtPos
              left: 50,
              thread,
              annotationId: ann.id
            });
          }}
        />

        <div className="editor-main" style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {isReplaying ? (
            <div className="replay-viewer" style={{ flex: 1, padding: 20, overflow: 'auto', background: '#1e1e1e', color: '#fff' }}>
              <pre>{currentSnapshot}</pre>
            </div>
          ) : (
            <Editor
              ydoc={ydoc}
              ytext={ytext}
              active={synced}
              awareness={awareness}
              user={user}
              sendAwareness={sendAwareness}
              onSelectionChange={handleSelectionChange}
            />
          )}

          {activePopover && (
            <ThreadPopover 
              position={activePopover}
              thread={activePopover.thread}
              onComment={onHandleComment}
              onReply={(threadId, data) => sendMessage(data.text, 'persistent', data.mentions, threadId)}
              onResolve={onResolve}
              onClose={() => setActivePopover(null)}
              suggestions={peers}
            />
          )}
        </div>

        {chatOpen && (
          <ChatPanel 
            messages={isReplaying ? snapshotChat : messages}
            ephemeralMsgs={isReplaying ? [] : ephemeralMsgs}
            threads={threads}
            peers={peers}
            user={{ ...user, role: canEdit ? 'editor' : 'viewer' }}
            onSend={(data) => sendMessage(data.text, data.mode, data.mentions)}
            onGoToThread={(t) => {
              const ann = annotations.find(a => a.threadId === t.id);
              if (ann && window.cmView) {
                const startPos = Y.createRelativePositionFromJSON(ann.anchor.start);
                const absStart = Y.createAbsolutePositionFromRelativePosition(startPos, ydoc);
                if (absStart) {
                   window.cmView.dispatch({
                     selection: { anchor: absStart.index },
                     scrollIntoView: true
                   });
                   window.cmView.focus();
                   setActivePopover({ 
                     top: 150, 
                     left: 60, 
                     thread: t, 
                     annotationId: ann.id 
                   });
                }
              }
            }}
            onResolveThread={onResolve}
          />
        )}
      </div>

      {isReplaying && (
        <ReplayTimeline 
          events={events}
          replayIndex={replayIndex}
          isReplaying={isReplaying}
          onStepTo={stepTo}
          onStop={stopReplay}
        />
      )}

      {debugOpen && (
        <CRDTDebugPanel 
          ydoc={ydoc}
          debugLog={debugLog}
          messages={messages}
          threads={threads}
          ephemeral={ephemeralMsgs}
        />
      )}

      {showHistory && (
        <VersionHistory docId={docId} onClose={() => setShowHistory(false)} />
      )}


      <CallWindow 
        socket={getSocket(token)} 
        docId={docId} 
        currentUser={{ name: user.name, color: user.color }} 
      />
    </div>
  );
}
