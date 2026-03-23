import { useState, useEffect } from 'react'
import { api } from '../api'

/**
 * Displays document health score in the editor header.
 * Polls every 30 seconds.
 * 
 * Props: docId
 */
export default function DocumentHealthBar({ docId, token }) {
  const [health, setHealth] = useState(null)

  useEffect(() => {
    if (!token) return;
    const fetch = () => {
      api.get(`/docs/${docId}/health`, { token })
        .then(({ data }) => setHealth(data))
        .catch(() => {})
    }

    fetch()
    const interval = setInterval(fetch, 30000)
    return () => clearInterval(interval)
  }, [docId, token])

  if (!health) return null
  if (health.total === 0) return null  // don't show when healthy

  const colorMap = {
    'Healthy': '#22c55e',
    'Needs Review': '#f59e0b',
    'Conflicts Present': '#ef4444'
  }

  return (
    <div
      className="doc-health-bar"
      style={{ borderColor: colorMap[health.label] }}
      title={`${health.high} high, ${health.medium} medium, ${health.low} low severity conflicts`}
    >
      <span
        className="doc-health-bar__dot"
        style={{ background: colorMap[health.label] }}
      />
      <span className="doc-health-bar__label">{health.label}</span>
      {health.total > 0 && (
        <span className="doc-health-bar__count">
          {health.total} unresolved
        </span>
      )}
    </div>
  )
}
