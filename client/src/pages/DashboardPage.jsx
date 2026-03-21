import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDocs, createDoc } from '../api.js';
import { useAuth } from '../hooks/useAuth.js';
import '../styles/dashboard.css';

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function DashboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getDocs(token)
      .then((data) => {
        if (cancelled) return;
        setDocs(data?.documents || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load documents');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onCreateDoc() {
    setCreating(true);
    try {
      const result = await createDoc(token, 'Untitled Document');
      navigate(`/editor/${result.id}`);
    } catch (err) {
      setError(err?.message || 'Failed to create document');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="dashboard-wrap">
      <div className="dashboard-top">
        <div className="dashboard-title">Your documents</div>
        <button className="btn btn-primary" onClick={onCreateDoc} disabled={creating}>
          {creating ? 'Creating...' : 'New Document'}
        </button>
      </div>

      {loading ? (
        <div className="app-card" style={{ padding: 16 }}>
          Loading documents...
        </div>
      ) : error ? (
        <div className="app-card" style={{ padding: 16 }}>
          {error}
        </div>
      ) : docs.length === 0 ? (
        <div className="app-card" style={{ padding: 16 }}>
          No documents yet. Create one to start collaborating.
        </div>
      ) : (
        <div className="docs-grid">
          {docs.map((doc) => (
            <Link className="doc-card app-card" key={doc.id} to={`/editor/${doc.id}`}>
              <div className="doc-card-title">{doc.title}</div>
              <div className="doc-card-meta">
                <span className="role-pill">{doc.role}</span>
                <span>{formatDate(doc.updated_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

