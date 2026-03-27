import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { Link } from 'react-router-dom';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

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
      await login(email.trim(), password);
    } catch (err) {
      setError(err?.message || 'Login failed');
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
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12 }}>Sign in</div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontWeight: 800, fontSize: 13 }}>Email</label>
            <input
              className="input"
              type="email"
              id="email"
              name="email"
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
              id="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error ? <div className="error-text">{error}</div> : null}

          <button className={`btn btn-primary`} disabled={loading} style={{ marginTop: 6 }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <div style={{ color: 'var(--muted)', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
            <span>New here? <Link to="/register">Create an account</Link></span>
            <Link to="/forgot-password" style={{ color: '#1a73e8' }}>Forgot password?</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

