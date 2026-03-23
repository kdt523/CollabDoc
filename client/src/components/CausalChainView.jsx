/**
 * Props: provenance — result from useProvenance
 * {
 *   spans: [{ chars, authorName, authorColor, clockStart, clockEnd, absoluteStart }]
 *   concurrentGroups: [{ items, authors }]
 *   range: { from, to }
 * }
 */
export default function CausalChainView({ provenance }) {
  const { spans, concurrentGroups } = provenance

  const uniqueAuthors = spans.reduce((acc, span) => {
    if (!acc.find(s => s.authorName === span.authorName)) {
      acc.push(span)
    }
    return acc;
  }, []);

  return (
    <div className="causal-chain">

      {/* Text with authors color-coded */}
      <div className="causal-chain__text-view">
        {spans.map((span, i) => (
          <span
            key={i}
            className="causal-chain__span"
            style={{ borderBottom: `2px solid ${span.authorColor}` }}
            title={`${span.authorName} · clock ${span.clockStart}`}
          >
            {span.chars}
          </span>
        ))}
      </div>

      {/* Author legend */}
      <div className="causal-chain__authors">
        {uniqueAuthors.map(span => (
          <div key={span.authorName} className="causal-chain__author">
            <span
              className="causal-chain__author-dot"
              style={{ background: span.authorColor }}
            />
            <span className="causal-chain__author-name">{span.authorName}</span>
          </div>
        ))}
      </div>

      {/* Concurrent edit warnings */}
      {concurrentGroups.length > 0 && (
        <div className="causal-chain__concurrent">
          <div className="causal-chain__concurrent-label">
            ⚡ Concurrent insertions detected
          </div>
          {concurrentGroups.map((group, i) => (
            <div key={i} className="causal-chain__concurrent-item">
              {group.authors.map(a => a.name).join(' and ')} inserted text
              at the same position simultaneously. CRDT resolved by client ID ordering.
            </div>
          ))}
        </div>
      )}

      {/* Causal chain explanation */}
      <div className="causal-chain__explanation">
        {spans.length === 1
          ? `Written entirely by ${spans[0].authorName}`
          : `${spans.length} authors contributed to this text`
        }
      </div>
    </div>
  )
}
