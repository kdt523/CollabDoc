const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error('REDIS_URL is required');

// publisher is used to broadcast updates to other Node.js instances
const publisher = new Redis(REDIS_URL);
// subscriber listens for updates and re-emits them to connected WebSocket clients
const subscriber = new Redis(REDIS_URL);

publisher.on('error', (err) => {
  console.error('[redis] publisher error:', err);
});
subscriber.on('error', (err) => {
  console.error('[redis] subscriber error:', err);
});

module.exports = {
  publisher,
  subscriber,
};

