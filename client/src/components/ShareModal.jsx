import React, { useState, useEffect } from 'react';
import { getDocAccess, shareDoc } from '../api';

export default function ShareModal({ docId, title, token, onClose }) {
  const [role, setRole] = useState('viewer');
  const [accessList, setAccessList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    if (docId && token) {
      fetchAccess();
    }
  }, [docId, token]);

  async function fetchAccess() {
    setLoading(true);
    setError(null);
    try {
      const data = await getDocAccess(token, docId);
      console.log('Access data fetched:', data);
      setAccessList(data.access || []);
    } catch (err) {
      console.error('Failed to fetch access list:', err);
      setError(err.message || 'Failed to load access list');
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    setSharing(true);
    setCopySuccess(false);
    setError(null);
    try {
      const { shareUrl } = await shareDoc(token, docId, role);
      setShareUrl(shareUrl);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setCopySuccess(true);
      }
    } catch (err) {
      console.error('Failed to generate share link:', err);
      setError(err.message || 'Failed to generate share link');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ pointerEvents: 'auto' }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Share "{title || 'Untitled Document'}"</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-text" style={{ marginBottom: '16px', padding: '10px', background: '#fee2e2', borderRadius: '8px' }}>{error}</div>}
          
          <div className="share-role-select">
            <label style={{ display: 'block', fontSize: '14px', marginBottom: '8px', fontWeight: '500' }}>
              Access type for new link:
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select 
                className="input" 
                value={role} 
                onChange={(e) => setRole(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="viewer">Viewer (can only read)</option>
                <option value="editor">Editor (can edit and comment)</option>
              </select>
              <button 
                className="btn btn-primary" 
                onClick={handleShare}
                disabled={sharing}
              >
                {sharing ? '...' : 'Get Link'}
              </button>
            </div>
          </div>

          {shareUrl && (
            <div className="share-link-box">
              <span style={{ fontSize: '18px' }}>🔗</span>
              <div className="share-link-input">{shareUrl}</div>
              <button 
                className="btn" 
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopySuccess(true);
                }}
              >
                {copySuccess ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}

          <div className="access-list" style={{ minHeight: '100px' }}>
            <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              People with access
              <button 
                onClick={fetchAccess} 
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '12px', cursor: 'pointer' }}
                title="Refresh"
              >
                ↻
              </button>
            </h3>
            {loading ? (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '14px', color: 'var(--muted)' }}>
                 Loading access list...
              </div>
            ) : accessList.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '14px', color: 'var(--muted)' }}>
                No users found.
              </div>
            ) : (
              accessList.map((user) => (
                <div key={user.id} className="access-item">
                  <div className="access-avatar">
                    {user.name ? user.name[0].toUpperCase() : '?'}
                  </div>
                  <div className="access-info">
                    <div className="access-name">{user.name} {user.role === 'owner' && '(Owner)'}</div>
                    <div className="access-email">{user.email}</div>
                  </div>
                  <div className="access-role">
                    {user.role === 'owner' ? 'Owner' : user.role === 'editor' ? 'Editor' : 'Viewer'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
