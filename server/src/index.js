const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { initSchema, pool } = require('./db');
const { publisher, subscriber } = require('./redis');
const persistence = require('./persistence');
const { registerSocketHandlers } = require('./socketHandlers');
const { authSocketMiddleware } = require('./authMiddleware');

const authRoutes = require('./routes/auth');
const docsRoutes = require('./routes/docs');
const eventsRoutes = require('./routes/events');
const annotationsRoutes = require('./routes/annotations');

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

function parseAllowedOrigins() {
  const configuredOrigins = [
    CLIENT_URL,
    process.env.CORS_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set(['http://localhost:5173', ...configuredOrigins]));
}

function createCorsOptions(allowedOrigins) {
  return {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: ${origin} not in allowed list`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

async function main() {
  await initSchema();

  const ALLOWED_ORIGINS = parseAllowedOrigins();
  const corsOptions = createCorsOptions(ALLOWED_ORIGINS);

  const app = express();
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/docs', docsRoutes);
  app.use('/api/docs', eventsRoutes);
  app.use('/api/docs', annotationsRoutes);

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling']
  });

  // Socket auth must run before any event handler.
  io.use(authSocketMiddleware);

  registerSocketHandlers({
    io,
    publisher,
    subscriber,
  });

  const server = httpServer.listen(PORT, () => {
    console.log(`[server] listening on port ${PORT}`);
    console.log(`[server] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  });

  const shutdown = async (signal) => {
    console.log(`[server] shutting down (${signal})...`);
    try {
      await persistence.flushAllDocs();
    } catch (err) {
      console.error('[server] flushAllDocs failed:', err);
    }

    try {
      io.close();
    } catch (_) {}

    try {
      publisher.disconnect();
      subscriber.disconnect();
    } catch (_) {}

    try {
      await pool.end();
    } catch (_) {}

    server.close(() => {
      console.log('[server] shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
