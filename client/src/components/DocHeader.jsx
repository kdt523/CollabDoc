import React, { useEffect, useMemo, useState } from 'react';

export default function DocHeader({
  title,
  canEdit,
  peers = [],
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
  const [activeMenu, setActiveMenu] = useState(null); // 'file' | 'insert' | 'format' | null

  useEffect(() => {
    setDraft(title || '');
  }, [title]);

  // Handle click outside to close menus
  useEffect(() => {
    if (!activeMenu) return;
    const handler = () => setActiveMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [activeMenu]);

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

  const insertMarkdown = (prefix, suffix = '') => {
    if (window.cmView) {
      const sel = window.cmView.state.selection.main;
      const selected = window.cmView.state.sliceDoc(sel.from, sel.to);
      window.cmView.dispatch({
        changes: { from: sel.from, to: sel.to, insert: `${prefix}${selected}${suffix}` },
        selection: { anchor: sel.from + prefix.length, head: sel.from + prefix.length + selected.length },
        scrollIntoView: true
      });
      window.cmView.focus();
    }
  };

  const handleDownload = () => {
    const text = window.cmView?.state.doc.toString() || '';
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="editor-topbar">
      <div className="doc-header-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="doc-icon" style={{ color: '#1a73e8', fontSize: 24 }}>📄</div>
          <div className="doc-title-stack">
            <div className="doc-title-wrap">
              {canEdit && isEditing ? (
                <input
                  className="doc-title-input"
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
                  autoFocus
                />
              ) : (
                <div
                  className="doc-title"
                  onDoubleClick={() => canEdit && setIsEditing(true)}
                >
                  {title || 'Untitled Document'}
                </div>
              )}
              {connectionStatus === 'connected' && (
                <span className="save-status" title="All changes saved to cloud">☁️</span>
              )}
            </div>
            
            <div className="doc-menu">
              <div className="menu-item-wrap">
                <span onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'file' ? null : 'file'); }}>File</span>
                {activeMenu === 'file' && (
                  <div className="dropdown-menu">
                    <div className="dropdown-item" onClick={() => { setIsEditing(true); }}>Rename</div>
                    <div className="dropdown-item" onClick={onShare}>Share</div>
                    <div className="dropdown-divider" />
                    <div className="dropdown-item" onClick={handleDownload}>Download (.md)</div>
                    <div className="dropdown-item" onClick={onShowHistory}>Version history</div>
                    <div className="dropdown-divider" />
                    <div className="dropdown-item" onClick={() => window.print()}>Print</div>
                  </div>
                )}
              </div>
              <div className="menu-item-wrap">
                <span onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'insert' ? null : 'insert'); }}>Insert</span>
                {activeMenu === 'insert' && (
                  <div className="dropdown-menu">
                    <div className="dropdown-item" onClick={() => {
                        const url = window.prompt('Enter Image URL:');
                        if (url) insertMarkdown('![image](', `${url})`);
                    }}>Image</div>
                    <div className="dropdown-item" onClick={() => insertMarkdown('[', '](url)')}>Link</div>
                    <div className="dropdown-item" onClick={() => insertMarkdown('\n---\n')}>Horizontal line</div>
                    <div className="dropdown-item">Comment (Select text)</div>
                  </div>
                )}
              </div>
              <div className="menu-item-wrap">
                <span onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'format' ? null : 'format'); }}>Format</span>
                {activeMenu === 'format' && (
                  <div className="dropdown-menu">
                    <div className="dropdown-item" onClick={() => insertMarkdown('**', '**')}>Bold (Selection)</div>
                    <div className="dropdown-item" onClick={() => insertMarkdown('*', '*')}>Italic (Selection)</div>
                    <div className="dropdown-item" onClick={() => insertMarkdown('<u>', '</u>')}>Underline (Selection)</div>
                    <div className="dropdown-divider" />
                    <div className="dropdown-item" onClick={() => {
                        if (!window.cmView) return;
                        const sel = window.cmView.state.selection.main;
                        const text = window.cmView.state.sliceDoc(sel.from, sel.to);
                        const clean = text.replace(/(\*\*|\*|<u>|<\/u>)/g, '');
                        window.cmView.dispatch({ changes: { from: sel.from, to: sel.to, insert: clean } });
                    }}>Clear formatting</div>
                  </div>
                )}
              </div>
              <span>Tools</span>
              <span>Extensions</span>
              <span>Help</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div className="peer-avatars">
            {peers.slice(0, 5).map((p) => (
              <div 
                key={p.clientId} 
                className="peer-avatar" 
                style={{ background: p.color }}
                title={p.name}
              >
                {p.name[0]}
              </div>
            ))}
            {peers.length > 5 && <div className="peer-avatar-more">+{peers.length - 5}</div>}
          </div>

          <button className="btn-chat" onClick={onChatToggle} title="Open Chat">💬</button>
          
          <button
            className="btn-share"
            disabled={shareLoading}
            onClick={async () => {
              setShareLoading(true);
              try {
                await onShare();
              } catch (_) {}
              finally { setShareLoading(false); }
            }}
          >
            <span style={{ marginRight: 8 }}>🔒</span>
            {shareLoading ? '...' : 'Share'}
          </button>
        </div>
      </div>
      {shareNotice && <div className="share-toast notice">{shareNotice}</div>}
      {shareError && <div className="share-toast error">{shareError}</div>}
    </div>
  );
}

