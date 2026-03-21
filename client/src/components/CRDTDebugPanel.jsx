import React from 'react';
import * as Y from 'yjs';

export default function CRDTDebugPanel({ ydoc, debugLog, messages, threads, ephemeral }) {
  if (!ydoc) return null;

  const stateVector = Y.encodeStateVector(ydoc);
  const stateVectorHexArr = Array.from(stateVector).map(b => b.toString(16).padStart(2, '0'));
  const stateVectorHex = stateVectorHexArr.join('');
  const clock = ydoc.clientID + '-' + (ydoc.store?.clients?.get(ydoc.clientID) || 0);

  return (
    <div className="debug-panel">
      <div className="section">
        <h4>Y.Doc State</h4>
        <dl>
          <dt>State Vector (Hex)</dt>
          <dd className="hex">{stateVectorHex.substring(0, 32)}...</dd>
          
          <dt>Clock (Local)</dt>
          <dd>{clock}</dd>
          
          <dt>Client ID</dt>
          <dd>{ydoc.clientID}</dd>
        </dl>
      </div>

      <div className="section">
        <h4>Sync Log (Last 10)</h4>
        <ul className="sync-log">
          {(debugLog || []).map((log, i) => (
            <li key={i}>
              <span className="time">{new Date(log.receivedAt).toLocaleTimeString()}</span>
              <span className="size">{log.size} bytes</span>
              <span className="from">{log.socketId}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="section">
        <h4>CRDT Data</h4>
        <dl>
          <dt>Persistent Messages</dt>
          <dd>{(messages || []).length}</dd>
          
          <dt>Threads</dt>
          <dd>{(threads || new Map()).size}</dd>
          
          <dt>Ephemeral Msgs</dt>
          <dd>{(ephemeral || []).length}</dd>
        </dl>
      </div>
    </div>
  );
}
