import React, { useEffect, useMemo, useState } from 'react';
import DocumentHealthBar from './DocumentHealthBar';
import ContributionBar from './ContributionBar';


export default function DocHeader({
  docId,
  title,
  token,
  canEdit,
  onTitleChange,
  onShare,
  onShowHistory,
  onChatToggle,
  onReplayToggle,
  connectionStatus = 'offline',
  shareNotice = '',
  shareError = '',
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title || '');
  const [shareLoading, setShareLoading] = useState(false);

  useEffect(() => {
    setDraft(title || '');
  }, [title]);

  const statusClass =
    connectionStatus === 'connected'
      ? 'status-connected'
      : connectionStatus === 'reconnecting'
        ? 'status-reconnecting'
        : 'status-offline';

  async function commit() {
    setIsEditing(false);
    const next = String(draft || '').trim();
    if (!canEdit) return;
    if (next && next !== (title || '').trim()) {
      await onTitleChange(next);
    } else {
      setDraft(title || '');
    }
  }

  return (
    <div className="editor-topbar">
      <div className="doc-header-row">
        <div className="doc-title-wrap">
          <span className={`status-dot ${statusClass}`} title={`Connection: ${connectionStatus}`} />
          {canEdit && isEditing ? (
            <input
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setDraft(title || '');
                }
              }}
              style={{ fontSize: 16, fontWeight: 900, padding: '6px 10px', width: 520, maxWidth: '70vw' }}
              autoFocus
            />
          ) : (
            <div
              className="doc-title"
              title={title}
              onDoubleClick={() => {
                if (!canEdit) return;
                setIsEditing(true);
              }}
              style={{ cursor: canEdit ? 'text' : 'default' }}
            >
              {title || 'Untitled Document'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', borderRight: '1px solid #333', paddingRight: 15 }}>
            <DocumentHealthBar docId={docId} token={token} />
            <ContributionBar docId={docId} token={token} compact={true} />
          </div>
          <button
            className="btn"
            disabled={shareLoading}
            onClick={async () => {
              setShareLoading(true);
              try {
                await onShare();
              } catch (_) {
                // parent handles the error state shown below
              } finally {
                setShareLoading(false);
              }
            }}
          >
            {shareLoading ? 'Preparing...' : 'Share'}
          </button>
          <button className="btn btn-secondary" onClick={onReplayToggle} title="Replay History">
            Replay
          </button>
          <button className="btn btn-secondary" onClick={onChatToggle} title="Toggle Chat">
            Chat
          </button>
          <button className="btn btn-secondary" onClick={onShowHistory} title="Version History">
            History
          </button>
        </div>
      </div>
      {shareNotice ? (
        <div style={{ marginTop: 8, color: '#2563eb', fontSize: 13, fontWeight: 700 }}>{shareNotice}</div>
      ) : null}
      {shareError ? (
        <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 13, fontWeight: 700 }}>{shareError}</div>
      ) : null}
    </div>
  );
}

