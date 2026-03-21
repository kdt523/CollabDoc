import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { Link } from 'react-router-dom';

export default function RegisterPage() {
  const { register, isAuthenticated } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      await register(name.trim(), email.trim(), password);
    } catch (err) {
      setError(err?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (isAuthenticated) {
    return (
      <div className="center-page">
        <div className="app-card" style={{ padding: 20, maxWidth: 420 }}>
          You are already logged in.
        </div>
      </div>
    );
  }

  return (
    <div className="center-page">
      <div className="app-card" style={{ padding: 20, width: '100%', maxWidth: 420 }}>
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12 }}>Create account</div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontWeight: 800, fontSize: 13 }}>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <label style={{ fontWeight: 800, fontSize: 13 }}>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label style={{ fontWeight: 800, fontSize: 13 }}>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {error ? <div className="error-text">{error}</div> : null}

          <button className="btn btn-primary" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? 'Creating...' : 'Create account'}
          </button>

          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

