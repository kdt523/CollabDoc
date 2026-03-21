const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

function decodeAuthHeader(authHeader) {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// HTTP middleware for REST routes.
function authMiddleware(req, res, next) {
  try {
    const token = decodeAuthHeader(req.headers.authorization);
    if (!token) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Missing token' });

    const payload = verifyToken(token);
    req.user = {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication error' });
  }
}

// Socket.IO middleware for all events.
function authSocketMiddleware(socket, next) {
  try {
    const token =
      socket.handshake?.auth?.token ||
      decodeAuthHeader(socket.handshake?.headers?.authorization);

    if (!token) {
      return next(new Error('Authentication error'));
    }

    const payload = verifyToken(token);
    socket.user = {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
    };
    return next();
  } catch (err) {
    return next(new Error('Authentication error'));
  }
}

module.exports = {
  authMiddleware,
  authSocketMiddleware,
};

