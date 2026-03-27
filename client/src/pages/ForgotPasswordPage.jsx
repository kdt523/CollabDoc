import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || 'Request failed');
  return data;
}

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepIndicator({ step }) {
  const steps = ['Email', 'OTP', 'New Password'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = idx < step;
        const active = idx === step;
        return (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                fontSize: 14,
                background: done ? '#1a73e8' : active ? '#1a73e8' : '#e8eaed',
                color: done || active ? '#fff' : '#80868b',
                transition: 'all 0.3s',
              }}>
                {done ? '✓' : idx}
              </div>
              <span style={{ fontSize: 11, color: active ? '#1a73e8' : '#80868b', fontWeight: active ? 600 : 400 }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: '0 8px', marginBottom: 20,
                background: done ? '#1a73e8' : '#e8eaed',
                transition: 'background 0.3s',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── OTP Input — 6 individual boxes ──────────────────────────────────────────
function OtpInput({ value, onChange }) {
  const digits = (value + '      ').slice(0, 6).split('');
  const inputRefs = Array.from({ length: 6 }, () => React.createRef());

  function handleKey(e, idx) {
    if (e.key === 'Backspace') {
      const next = (value || '').slice(0, idx);
      onChange(next);
      if (idx > 0) inputRefs[idx - 1].current?.focus();
    }
  }

  function handleChange(e, idx) {
    const char = e.target.value.replace(/\D/g, '').slice(-1);
    if (!char) return;
    const arr = (value || '').split('');
    arr[idx] = char;
    const next = arr.join('').slice(0, 6);
    onChange(next);
    if (idx < 5) inputRefs[idx + 1].current?.focus();
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length > 0) {
      onChange(pasted);
      inputRefs[Math.min(pasted.length, 5)].current?.focus();
    }
    e.preventDefault();
  }

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '4px 0 8px' }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={inputRefs[i]}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKey(e, i)}
          onPaste={handlePaste}
          autoFocus={i === 0}
          style={{
            width: 44, height: 52, textAlign: 'center', fontSize: 22, fontWeight: 700,
            borderRadius: 8, border: d.trim() ? '2px solid #1a73e8' : '2px solid #dadce0',
            outline: 'none', background: '#fff', color: '#202124',
            transition: 'border-color 0.2s',
          }}
        />
      ))}
    </div>
  );
}

// ─── Password strength bar ────────────────────────────────────────────────────
function StrengthBar({ password }) {
  let strength = 0;
  if (password.length >= 6) strength++;
  if (password.length >= 10) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^A-Za-z0-9]/.test(password)) strength++;

  const labels = ['', 'Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['', '#d93025', '#f29900', '#f0b429', '#34a853', '#1a73e8'];

  if (!password) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} style={{
            flex: 1, height: 4, borderRadius: 4,
            background: n <= strength ? colors[strength] : '#e8eaed',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: colors[strength] }}>{labels[strength]}</div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Resend OTP cooldown timer
  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleSendOtp(e) {
    e?.preventDefault();
    setError('');
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/auth/forgot-password', { email: email.trim() });
      setStep(2);
      setResendCooldown(60);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e) {
    e?.preventDefault();
    setError('');
    if (otp.length !== 6) {
      setError('Please enter the full 6-digit OTP.');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/auth/verify-otp', { email, otp });
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e?.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost('/auth/reset-password', { email, otp, newPassword });
      // Auto-login after successful reset
      if (data.token && loginWithToken) {
        loginWithToken(data.token, data.user);
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const cardStyle = {
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.08)',
    padding: '36px 40px',
    width: '100%',
    maxWidth: 440,
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8f9fa', fontFamily: "'Inter', 'Roboto', sans-serif",
    }}>
      <div style={cardStyle}>
        {/* Logo / Branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{
            width: 36, height: 36, background: '#1a73e8', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 18,
          }}>C</div>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#202124' }}>CollabEdit</span>
        </div>

        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#202124' }}>
          Reset your password
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: '#5f6368' }}>
          {step === 1 && "We'll send a one-time code to your email."}
          {step === 2 && `Enter the 6-digit code sent to ${email}`}
          {step === 3 && 'Choose a strong new password.'}
        </p>

        <StepIndicator step={step} />

        {/* ── Step 1: Email ── */}
        {step === 1 && (
          <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={labelStyle}>Email address</label>
              <input
                id="fp-email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={inputStyle}
              />
            </div>
            {error && <div style={errorStyle}>{error}</div>}
            <button style={btnStyle} disabled={loading}>
              {loading ? 'Sending OTP…' : 'Send OTP'}
            </button>
          </form>
        )}

        {/* ── Step 2: OTP ── */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <OtpInput value={otp} onChange={setOtp} />
            <div style={{ fontSize: 12, color: '#80868b', textAlign: 'center' }}>
              {resendCooldown > 0
                ? `Resend OTP in ${resendCooldown}s`
                : <button type="button" onClick={handleSendOtp} style={{ background: 'none', border: 'none', color: '#1a73e8', cursor: 'pointer', fontSize: 13 }}>Resend OTP</button>
              }
            </div>
            {error && <div style={errorStyle}>{error}</div>}
            <button style={btnStyle} disabled={loading || otp.length < 6}>
              {loading ? 'Verifying…' : 'Verify OTP'}
            </button>
            <button type="button" onClick={() => { setStep(1); setOtp(''); setError(''); }} style={secondaryBtnStyle}>← Change email</button>
          </form>
        )}

        {/* ── Step 3: New password ── */}
        {step === 3 && (
          <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={labelStyle}>New password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="fp-newpassword"
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  style={{ ...inputStyle, paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368', fontSize: 18 }}>
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              <StrengthBar password={newPassword} />
            </div>
            <div>
              <label style={labelStyle}>Confirm password</label>
              <input
                id="fp-confirmpassword"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                style={{
                  ...inputStyle,
                  borderColor: confirmPassword && confirmPassword !== newPassword ? '#d93025' : undefined,
                }}
              />
              {confirmPassword && confirmPassword !== newPassword && (
                <div style={{ fontSize: 12, color: '#d93025', marginTop: 4 }}>Passwords do not match</div>
              )}
            </div>
            {error && <div style={errorStyle}>{error}</div>}
            <button style={btnStyle} disabled={loading || newPassword !== confirmPassword || newPassword.length < 6}>
              {loading ? 'Resetting…' : 'Reset Password'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: '#5f6368' }}>
          Remembered it? <Link to="/login" style={{ color: '#1a73e8', fontWeight: 500 }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────────
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#3c4043', marginBottom: 6 };
const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #dadce0',
  fontSize: 15, color: '#202124', outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.2s', fontFamily: 'inherit',
};
const btnStyle = {
  padding: '12px', borderRadius: 8, border: 'none', background: '#1a73e8', color: '#fff',
  fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'inherit',
  transition: 'background 0.2s', opacity: 1,
};
const secondaryBtnStyle = {
  padding: '10px', borderRadius: 8, border: '1.5px solid #dadce0', background: '#fff',
  color: '#3c4043', fontSize: 14, cursor: 'pointer', width: '100%', fontFamily: 'inherit',
};
const errorStyle = {
  background: '#fce8e6', color: '#c5221f', padding: '10px 14px',
  borderRadius: 8, fontSize: 13, borderLeft: '4px solid #d93025',
};
