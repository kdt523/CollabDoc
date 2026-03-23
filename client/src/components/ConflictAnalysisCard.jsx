import { useConflictAnalysis } from '../hooks/useConflictAnalysis'

/**
 * Props:
 *   docId     - document id
 *   threadId  - conflict thread id
 *   users     - [{ name, color }, { name, color }]  — the two conflicting users
 */
export default function ConflictAnalysisCard({ docId, threadId, users, token }) {
  const { analysis, status } = useConflictAnalysis(docId, threadId, token)

  if (status === 'analyzing' || status === 'idle') {
    return (
      <div className="conflict-analysis conflict-analysis--loading">
        <div className="conflict-analysis__spinner" />
        <span>Analyzing intent<span className="loading-dots">...</span></span>
      </div>
    )
  }

  if (status === 'error' || !analysis) {
    return (
      <div className="conflict-analysis conflict-analysis--error">
        Could not analyze this conflict automatically.
      </div>
    )
  }

  const severityClass = {
    high: 'conflict-analysis--high',
    medium: 'conflict-analysis--medium',
    low: 'conflict-analysis--low'
  }[analysis.severity] || 'conflict-analysis--low'

  return (
    <div className={`conflict-analysis ${severityClass}`}>

      <div className="conflict-analysis__header">
        <span className="conflict-analysis__severity-badge">
          {analysis.severity === 'high' ? '🔴' : analysis.severity === 'medium' ? '🟡' : '🟢'}
          {analysis.severity} severity
        </span>
        {analysis.semanticConflict && (
          <span className="conflict-analysis__semantic-flag">
            Semantic conflict
          </span>
        )}
      </div>

      <div className="conflict-analysis__intents">
        {users[0] && (
          <div className="conflict-analysis__intent">
            <span
              className="conflict-analysis__intent-author"
              style={{ color: users[0].color }}
            >
              {users[0].name}
            </span>
            <span className="conflict-analysis__intent-text">
              {analysis.aliceIntent}
            </span>
          </div>
        )}
        {users[1] && (
          <div className="conflict-analysis__intent">
            <span
              className="conflict-analysis__intent-author"
              style={{ color: users[1].color }}
            >
              {users[1].name}
            </span>
            <span className="conflict-analysis__intent-text">
              {analysis.bobIntent}
            </span>
          </div>
        )}
      </div>

      {analysis.suggestion && (
        <div className="conflict-analysis__suggestion">
          <span className="conflict-analysis__suggestion-label">Suggestion</span>
          <span className="conflict-analysis__suggestion-text">
            {analysis.suggestion}
          </span>
        </div>
      )}

      <div className="conflict-analysis__compatible">
        {analysis.compatible
          ? '✓ These changes are compatible — the merge is likely correct'
          : '⚠ These changes may conflict in meaning — review recommended'
        }
      </div>
    </div>
  )
}
