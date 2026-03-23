import { useState, useCallback, useRef } from 'react'
import { api } from '../api'

/**
 * Fetches causal provenance for a text range.
 * 
 * Usage:
 *   const { provenance, loading, fetchProvenance } = useProvenance(docId)
 *   // On text selection: fetchProvenance(from, to)
 */
export function useProvenance(docId, token) {
  const [provenance, setProvenance] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const cache = useRef(new Map())  // client-side cache: rangeKey → result

  const fetchProvenance = useCallback(async (from, to) => {
    if (to - from > 5000) {
      setError('Select a smaller range (max 5000 characters)')
      return
    }

    const key = `${from}:${to}`
    if (cache.current.has(key)) {
      setProvenance(cache.current.get(key))
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data } = await api.get(`/docs/${docId}/provenance?from=${from}&to=${to}`, { token })
      cache.current.set(key, data)
      // Invalidate cache after 30 seconds (document may have changed)
      setTimeout(() => cache.current.delete(key), 30000)
      setProvenance(data)
    } catch (err) {
      setError('Failed to load provenance')
    } finally {
      setLoading(false)
    }
  }, [docId, token])

  const clear = useCallback(() => {
    setProvenance(null)
    setError(null)
  }, [])

  return { provenance, loading, error, fetchProvenance, clear }
}
