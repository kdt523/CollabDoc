const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../db');
const { sendPasswordResetOtp } = require('../mailer');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

// ─── Simple in-memory rate limiter for OTP requests ──────────────────────────
const otpRequestMap = new Map(); // email -> { count, resetAt }
const OTP_RATE_LIMIT = 3;        // max 3 OTP requests per window
const OTP_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const OTP_EXPIRY_MS = 15 * 60 * 1000;      // OTP valid for 15 minutes
const MAX_OTP_ATTEMPTS = 5;                 // max 5 wrong guesses before OTP is burned

function checkOtpRateLimit(email) {
  const now = Date.now();
  const entry = otpRequestMap.get(email);
  if (!entry || now > entry.resetAt) {
    otpRequestMap.set(email, { count: 1, resetAt: now + OTP_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= OTP_RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

function signToken({ userId, email, name }) {
  return jwt.sign(
    { userId, email, name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// ─── Register ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);

    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Name is required' });
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Valid email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Password must be at least 6 characters' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const {
      rows,
    } = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [cleanEmail, passwordHash, name.trim()]
    );

    const user = rows[0];
    const token = signToken({ userId: user.id, email: user.email, name: user.name });
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ code: 'EMAIL_TAKEN', message: 'Email already registered' });
    }
    console.error('[auth] register failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Registration failed' });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Valid email is required' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Password is required' });
    }

    const { rows } = await pool.query(
      `SELECT id, email, name, password_hash FROM users WHERE email = $1`,
      [cleanEmail]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    const token = signToken({ userId: user.id, email: user.email, name: user.name });
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[auth] login failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Login failed' });
  }
});

// ─── Forgot Password — Step 1: Request OTP ────────────────────────────────────
// POST /api/auth/forgot-password  { email }
// Always responds with 200 to prevent user enumeration attacks.
router.post('/forgot-password', async (req, res) => {
  try {
    const cleanEmail = normalizeEmail(req.body?.email);
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Valid email is required' });
    }

    // Rate limit: max OTP_RATE_LIMIT requests per OTP_RATE_WINDOW_MS
    if (!checkOtpRateLimit(cleanEmail)) {
      return res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many OTP requests. Please wait 15 minutes.' });
    }

    const { rows } = await pool.query(
      `SELECT id, email, name FROM users WHERE email = $1`,
      [cleanEmail]
    );
    const user = rows[0];

    // Silently succeed if user not found (prevent email enumeration)
    if (user) {
      // Invalidate any existing unused OTPs for this user
      await pool.query(
        `UPDATE password_reset_otps SET used = TRUE WHERE user_id = $1 AND used = FALSE`,
        [user.id]
      );

      // Generate 6-digit OTP using cryptographically secure random
      const otp = String(crypto.randomInt(100000, 999999));
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

      await pool.query(
        `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, otpHash, expiresAt]
      );

      // Send OTP email (fire-and-forget — don't block response)
      sendPasswordResetOtp({ toEmail: user.email, toName: user.name, otp }).catch((err) => {
        console.error('[auth] failed to send OTP email:', err);
      });
    }

    // Always return 200 regardless of whether the user exists
    return res.json({ message: 'If that email is registered, an OTP has been sent.' });
  } catch (err) {
    console.error('[auth] forgot-password failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Server error' });
  }
});

// ─── Verify OTP — Step 2: Confirm OTP is valid before showing reset form ──────
// POST /api/auth/verify-otp  { email, otp }
router.post('/verify-otp', async (req, res) => {
  try {
    const cleanEmail = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || '').trim();

    if (!cleanEmail || !otp) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Email and OTP are required' });
    }

    const { rows: userRows } = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [cleanEmail]
    );
    const user = userRows[0];
    if (!user) {
      return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid or expired OTP' });
    }

    const { rows: otpRows } = await pool.query(
      `SELECT id, otp_hash, expires_at, attempts
       FROM password_reset_otps
       WHERE user_id = $1 AND used = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const record = otpRows[0];

    if (!record) {
      return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid or expired OTP' });
    }

    // Check expiry
    if (new Date() > new Date(record.expires_at)) {
      await pool.query(`UPDATE password_reset_otps SET used = TRUE WHERE id = $1`, [record.id]);
      return res.status(400).json({ code: 'OTP_EXPIRED', message: 'OTP has expired. Please request a new one.' });
    }

    // Check brute force attempts
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await pool.query(`UPDATE password_reset_otps SET used = TRUE WHERE id = $1`, [record.id]);
      return res.status(400).json({ code: 'OTP_LOCKED', message: 'Too many incorrect attempts. Please request a new OTP.' });
    }

    // Verify OTP hash (constant-time comparison via bcrypt)
    const isMatch = await bcrypt.compare(otp, record.otp_hash);
    if (!isMatch) {
      await pool.query(
        `UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = $1`,
        [record.id]
      );
      const remaining = MAX_OTP_ATTEMPTS - (record.attempts + 1);
      return res.status(400).json({
        code: 'INVALID_OTP',
        message: `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      });
    }

    return res.json({ valid: true, message: 'OTP verified' });
  } catch (err) {
    console.error('[auth] verify-otp failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Server error' });
  }
});

// ─── Reset Password — Step 3: Set new password ────────────────────────────────
// POST /api/auth/reset-password  { email, otp, newPassword }
router.post('/reset-password', async (req, res) => {
  try {
    const cleanEmail = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!cleanEmail || !otp || !newPassword) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Email, OTP, and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Password must be at least 6 characters' });
    }

    const { rows: userRows } = await pool.query(
      `SELECT id, email, name FROM users WHERE email = $1`,
      [cleanEmail]
    );
    const user = userRows[0];
    if (!user) {
      return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid or expired OTP' });
    }

    const { rows: otpRows } = await pool.query(
      `SELECT id, otp_hash, expires_at, attempts
       FROM password_reset_otps
       WHERE user_id = $1 AND used = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const record = otpRows[0];

    if (!record) {
      return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid or expired OTP' });
    }

    if (new Date() > new Date(record.expires_at)) {
      await pool.query(`UPDATE password_reset_otps SET used = TRUE WHERE id = $1`, [record.id]);
      return res.status(400).json({ code: 'OTP_EXPIRED', message: 'OTP has expired. Please request a new one.' });
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await pool.query(`UPDATE password_reset_otps SET used = TRUE WHERE id = $1`, [record.id]);
      return res.status(400).json({ code: 'OTP_LOCKED', message: 'Too many incorrect attempts. Please request a new OTP.' });
    }

    const isMatch = await bcrypt.compare(otp, record.otp_hash);
    if (!isMatch) {
      await pool.query(
        `UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = $1`,
        [record.id]
      );
      return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid OTP' });
    }

    // Mark OTP as used FIRST to prevent replay attacks
    await pool.query(`UPDATE password_reset_otps SET used = TRUE WHERE id = $1`, [record.id]);

    // Hash and update password
    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [newHash, user.id]
    );

    // Optionally return a login token so the user is immediately logged in
    const token = signToken({ userId: user.id, email: user.email, name: user.name });
    return res.json({
      message: 'Password reset successfully.',
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error('[auth] reset-password failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Server error' });
  }
});

// ─── Guest Login — Create a unique random user for demo ──────────────────────
router.post('/guest', async (req, res) => {
  try {
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    const guestName = `Guest_${randomSuffix}`;
    const guestEmail = `guest_${randomSuffix}@collabdoc.demo`;
    const guestPassword = crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(guestPassword, 12);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [guestEmail, passwordHash, guestName]
    );

    const user = rows[0];
    const token = signToken({ userId: user.id, email: user.email, name: user.name });
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[auth] guest login failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Guest login failed' });
  }
});

module.exports = router;

