import { useContribution } from '../hooks/useContribution'

/**
 * Props:
 *   docId       - document id
 *   from, to    - range (default: full document)
 *   compact     - boolean, show condensed version for header
 */
export default function ContributionBar({ docId, token, from, to, compact = false }) {
  const { contributions, loading } = useContribution(docId, token, from, to)

  if (loading || contributions.length === 0) return null

  if (compact) {
    // Header version: colored segments bar
    return (
      <div className="contribution-bar contribution-bar--compact" title="Document contributions">
        {contributions.map((c, i) => (
          <div
            key={i}
            className="contribution-bar__segment"
            style={{ width: `${c.percentage}%`, background: c.author.color || '#888' }}
            title={`${c.author.name}: ${c.percentage}%`}
          />
        ))}
      </div>
    )
  }

  // Full version: list with percentages
  return (
    <div className="contribution-bar">
      <div className="contribution-bar__title">Causal Contribution</div>
      {contributions.map((c, i) => (
        <div key={i} className="contribution-bar__row">
          <div
            className="contribution-bar__dot"
            style={{ background: c.author.color || '#888' }}
          />
          <span className="contribution-bar__name">{c.author.name}</span>
          <div className="contribution-bar__track">
            <div
              className="contribution-bar__fill"
              style={{
                width: `${c.percentage}%`,
                background: c.author.color || '#888'
              }}
            />
          </div>
          <span className="contribution-bar__pct">{c.percentage}%</span>
        </div>
      ))}
      <div className="contribution-bar__note">
        Based on causal character attribution from CRDT linked list
      </div>
    </div>
  )
}
