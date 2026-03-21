const Y = require('yjs');

// Keep a server-side Y.Doc per document so we can merge incoming updates deterministically.
// Note: we persist periodically (see persistence.js) so this in-memory state can be restored after restarts.
const docsById = new Map();

function getOrCreateDoc(docId) {
  if (!docsById.has(docId)) {
    docsById.set(docId, new Y.Doc());
  }
  return docsById.get(docId);
}

function applyUpdate(docId, update /* Uint8Array */) {
  const doc = getOrCreateDoc(docId);
  Y.applyUpdate(doc, update);
  return doc;
}

function getStateAsUpdate(docId) {
  const doc = getOrCreateDoc(docId);
  return Y.encodeStateAsUpdate(doc);
}

function getStateVector(docId) {
  const doc = getOrCreateDoc(docId);
  return Y.encodeStateVector(doc);
}

function getMissingUpdates(docId, clientStateVector /* Uint8Array */) {
  const doc = getOrCreateDoc(docId);
  return Y.encodeStateAsUpdate(doc, clientStateVector);
}

function getAllDocs() {
  return docsById;
}

module.exports = {
  getOrCreateDoc,
  applyUpdate,
  getStateAsUpdate,
  getStateVector,
  getMissingUpdates,
  getAllDocs,
};

