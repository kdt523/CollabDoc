import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

let socketSingleton = null;
let lastToken = null;

export function getSocket(token) {
  if (!token) return null;

  if (socketSingleton && lastToken === token) {
    return socketSingleton;
  }

  if (socketSingleton) {
    socketSingleton.disconnect();
    socketSingleton = null;
  }

  lastToken = token;
  socketSingleton = io(SERVER_URL, {
    auth: { token },
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
  });

  return socketSingleton;
}

export function disconnectSocket() {
  if (socketSingleton) {
    socketSingleton.disconnect();
  }
  socketSingleton = null;
  lastToken = null;
}

