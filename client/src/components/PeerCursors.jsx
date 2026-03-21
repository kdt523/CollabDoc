import React, { useEffect, useMemo, useState } from 'react';

export default function PeerCursors({ peers }) {
  // Rendered peers includes temporary "leaving" entries so we can animate out.
  const [renderedPeers, setRenderedPeers] = useState([]);

  const incomingMap = useMemo(() => {
    const m = new Map();
    for (const p of peers || []) m.set(p.clientId, p);
    return m;
  }, [peers]);

  useEffect(() => {
    const nextIds = new Set(Array.from(incomingMap.keys()));

    setRenderedPeers((prev) => {
      // Mark removed peers as leaving.
      const updated = prev.map((p) => {
        if (!nextIds.has(p.clientId)) {
          return { ...p, status: 'leaving' };
        }
        return p;
      });

      // Add new peers (entering).
      const existingIds = new Set(updated.map((p) => p.clientId));
      for (const peer of incomingMap.values()) {
        if (!existingIds.has(peer.clientId)) {
          updated.push({ ...peer, status: 'entering' });
        }
      }

      return updated;
    });

    // After a short delay, actually remove leaving peers.
    const t = setTimeout(() => {
      setRenderedPeers((prev) => prev.filter((p) => p.status !== 'leaving'));
    }, 240);

    return () => clearTimeout(t);
  }, [incomingMap]);

  const othersCount = peers?.length || 0;

  return (
    <div className="peer-bar">
      <div className="peer-avatars">
        {(renderedPeers || []).map((p) => {
          const initial = (p.name || '?').trim().slice(0, 1).toUpperCase();
          return (
            <div
              key={p.clientId}
              className={`peer-avatar ${p.status === 'entering' ? 'peer-enter' : ''} ${p.status === 'leaving' ? 'peer-leave' : ''}`}
              style={{ background: p.color || '#30bced' }}
              title={p.name}
            >
              {initial}
            </div>
          );
        })}
      </div>

      <div style={{ color: 'var(--muted)', fontWeight: 800, fontSize: 13 }}>{othersCount} other{othersCount === 1 ? '' : 's'} editing</div>
    </div>
  );
}

