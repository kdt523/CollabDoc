const Y = require('yjs');

const CONFLICT_WINDOW_MS = 2000;
const editHistory = new Map(); // docId -> Array<{ socketId, userId, userName, ranges, timestamp }>

function rangesOverlap(a, b) {
  return a.from < b.to && b.from < a.to;
}

function extractAffectedRanges(update, ydoc) {
  // We apply the update to a temporary Y.Doc clone to see what changed
  const tempDoc = new Y.Doc();
  const tempText = tempDoc.getText('codemirror');
  
  // Note: this only works if the tempDoc is at the same starting state as ydoc
  // For a robust implementation, you would apply the current yjs state vector first
  // but for detection within a short window, a delta check can suffice.
  
  let affectedRanges = [];
  tempDoc.on('afterTransaction', (tr) => {
    // tr.delta() can give us information on what changed in the transaction
    // For simplicity, we track the final text state changes if possible
  });

  try {
    Y.applyUpdate(tempDoc, update);
    // In a real implementation, we would use the transaction delta to find (from, to)
    // Here we'll return a placeholder for the concept if precise calculation is complex
  } catch (err) {
    // console.error('[conflictDetector] update extraction failed:', err);
  }

  return affectedRanges;
}

function recordEdit(docId, socketId, userId, userName, ranges) {
  if (!editHistory.has(docId)) {
    editHistory.set(docId, []);
  }
  
  const history = editHistory.get(docId);
  const now = Date.now();
  history.push({ socketId, userId, userName, ranges, timestamp: now });
  
  // Prune old entries
  const pruned = history.filter(h => now - h.timestamp < CONFLICT_WINDOW_MS);
  editHistory.set(docId, pruned);
}

function detectConflict(docId, incomingSocketId, incomingRanges) {
  const history = editHistory.get(docId);
  if (!history || !incomingRanges || incomingRanges.length === 0) return { detected: false };

  for (const range of incomingRanges) {
    for (const edit of history) {
      if (edit.socketId === incomingSocketId) continue;
      
      for (const editRange of edit.ranges) {
        if (rangesOverlap(range, editRange)) {
          return { 
            detected: true, 
            conflictingEdit: { 
              userId: edit.userId, 
              userName: edit.userName, 
              ranges: edit.ranges 
            } 
          };
        }
      }
    }
  }

  return { detected: false };
}

module.exports = {
  extractAffectedRanges,
  recordEdit,
  detectConflict
};
