const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

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
    // Best-effort for uniqueness constraint.
    if (err && err.code === '23505') {
      return res.status(409).json({ code: 'EMAIL_TAKEN', message: 'Email already registered' });
    }
    console.error('[auth] register failed:', err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Registration failed' });
  }
});

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

module.exports = router;

