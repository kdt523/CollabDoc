import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useCollabDoc } from '../hooks/useCollabDoc.js';
import { getDocMeta, patchDocTitle, shareDoc, joinSharedDoc } from '../api.js';
import DocHeader from '../components/DocHeader.jsx';
import PeerCursors from '../components/PeerCursors.jsx';
import Editor from '../components/Editor.jsx';
import VersionHistory from '../components/VersionHistory.jsx';
import '../styles/editor.css';

export default function EditorPage() {
  const { docId } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const shareToken = searchParams.get('shareToken');

  const [shareAccessReady, setShareAccessReady] = useState(!shareToken);
  const { ytext, awareness, synced, peers, sendAwareness, connectionStatus } = useCollabDoc(docId, {
    enabled: shareAccessReady,
  });

  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState('');
  const [title, setTitle] = useState('Untitled Document');
  const [canEdit, setCanEdit] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  const [shareError, setShareError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    // Reset the gate when the query changes (e.g. opening a different share link).
    setShareAccessReady(!shareToken);
  }, [shareToken]);

  // 1) If we arrived from a share link, grant access first, then enable collaboration.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!shareToken) return;
      if (shareAccessReady) return;

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
    return () => {
      cancelled = true;
    };
  }, [shareToken, shareAccessReady, token, docId, navigate]);

  // 2) Fetch document metadata once access is ready.
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
    return () => {
      cancelled = true;
    };
  }, [shareAccessReady, token, docId]);

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

      // Fallback in older/insecure browser contexts.
      window.prompt('Copy this share link:', shareUrl);
      setShareNotice('Share link generated.');
    } catch (err) {
      setShareError(err?.message || 'Failed to generate share link');
      throw err;
    }
  }

  return (
    <div className="editor-page">
      {metaLoading ? (
        <div className="app-card" style={{ margin: 24, padding: 16 }}>
          Loading document...
        </div>
      ) : metaError ? (
        <div className="app-card" style={{ margin: 24, padding: 16 }}>
          {metaError}
        </div>
      ) : (
        <>
          <DocHeader
            title={title}
            canEdit={canEdit}
            onTitleChange={onTitleChange}
            onShare={onShare}
            onShowHistory={() => setShowHistory(true)}
            connectionStatus={connectionStatus}
            shareNotice={shareNotice}
            shareError={shareError}
          />
          <PeerCursors peers={peers} />
          <div className="editor-body">
            <Editor
              user={user}
              ytext={ytext}
              awareness={awareness}
              synced={synced}
              sendAwareness={sendAwareness}
            />
          </div>
          {showHistory && (
            <VersionHistory 
              docId={docId} 
              onClose={() => setShowHistory(false)} 
            />
          )}
        </>
      )}
    </div>
  );
}

