// Map<docId, Map<socketId, { userId, name, color }>>
const activeCalls = new Map()

/**
 * Join a call for a document.
 * @param {string} docId 
 * @param {string} socketId 
 * @param {object} user { userId, name, color }
 */
function joinCall(docId, socketId, user) {
  if (!activeCalls.has(docId)) activeCalls.set(docId, new Map())
  activeCalls.get(docId).set(socketId, user)
}

/**
 * Leave a call for a document.
 */
function leaveCall(docId, socketId) {
  activeCalls.get(docId)?.delete(socketId)
  if (activeCalls.get(docId)?.size === 0) activeCalls.delete(docId)
}

/**
 * Get all participants in a call for a document.
 */
function getCallParticipants(docId) {
  return [...(activeCalls.get(docId)?.entries() || [])]
    .map(([socketId, user]) => ({ socketId, ...user }))
}

/**
 * Check if a socket is currently in a call for a document.
 */
function isInCall(docId, socketId) {
  return activeCalls.get(docId)?.has(socketId) || false
}

/**
 * Handle unexpected socket disconnects.
 * Returns the docId if the socket was in a call.
 */
function handleDisconnect(socketId) {
  for (const [docId, participants] of activeCalls) {
    if (participants.has(socketId)) {
      participants.delete(socketId)
      if (participants.size === 0) activeCalls.delete(docId)
      return docId
    }
  }
  return null
}

module.exports = { 
  joinCall, 
  leaveCall, 
  getCallParticipants, 
  isInCall, 
  handleDisconnect 
}
