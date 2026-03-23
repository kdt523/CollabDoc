import React, { useEffect, useState } from 'react';
import { getDocVersions, createDocVersion, restoreDocVersion } from '../api.js';
import { useAuth } from '../hooks/useAuth.js';

export default function VersionHistory({ docId, onClose }) {
  const { token } = useAuth();
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadVersions() {
    try {
      setLoading(true);
      const data = await getDocVersions(token, docId);
      setVersions(data.versions || []);
    } catch (err) {
      setError('Failed to load version history');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadVersions();
  }, [docId, token]);

  const onSaveSnapshot = async () => {
    const name = window.prompt('Enter version name (optional):');
    if (name === null) return;
    try {
      setSaving(true);
      await createDocVersion(token, docId, name);
      await loadVersions();
    } catch (err) {
      alert('Failed to save version snapshot');
    } finally {
      setSaving(false);
    }
  };

  const onRestore = async (v) => {
    if (!window.confirm(`Are you sure you want to restore to version from ${new Date(v.created_at).toLocaleString()}? This will merge the old state into the current document.`)) return;
    try {
      await restoreDocVersion(token, docId, v.id);
      alert('Version restored successfully. Updates will propagate shortly.');
      onClose();
    } catch (err) {
      alert(`Failed to restore version: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="version-history-panel">
      <div className="version-history-header">
        <h3>Version History</h3>
        <button className="close-history" onClick={onClose}>✕</button>
      </div>
      
      <button className="snapshot-btn" disabled={saving} onClick={onSaveSnapshot}>
        {saving ? 'Saving...' : 'Snapshot Now'}
      </button>

      <div className="version-list-container">
        {loading ? (
          <div className="loading-text">Loading history...</div>
        ) : error ? (
          <div className="error-text">{error}</div>
        ) : versions.length === 0 ? (
          <div className="empty-text">No versions saved yet.</div>
        ) : (
          <>
            {versions.map((v) => (
              <div key={v.id} className="version-item" onClick={() => onRestore(v)}>
                <div className="version-name">{v.version_name || (v.user_name ? `${v.user_name}'s snapshot` : 'Unnamed Snapshot')}</div>
                <div className="version-meta">
                  {new Date(v.created_at).toLocaleString()}
                </div>
                <div className="version-actions">
                  <button className="restore-btn">Restore</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
