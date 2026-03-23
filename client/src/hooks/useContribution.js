import { useState, useEffect } from 'react'
import { api } from '../api'

/**
 * Fetches per-author contribution percentages for the full document
 * or a specific range.
 */
export function useContribution(docId, token, from = 0, to = 99999999) {
  const [contributions, setContributions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    api.get(`/docs/${docId}/contribution?from=${from}&to=${to}`, { token })
      .then(({ data }) => {
        if (!cancelled) setContributions(data.contributions)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [docId, token, from, to])

  return { contributions, loading }
}
