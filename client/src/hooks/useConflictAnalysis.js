import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

/**
 * Fetches LLM semantic analysis for a conflict thread.
 * Handles the 202 polling pattern — server triggers LLM async.
 */
export function useConflictAnalysis(docId, threadId, token) {
  const [analysis, setAnalysis] = useState(null)
  const [status, setStatus] = useState('idle')  // 'idle' | 'analyzing' | 'ready' | 'error'

  const fetch = useCallback(async () => {
    if (!threadId || !token) return
    setStatus('analyzing')

    const poll = async (retries = 0) => {
      if (retries > 10) {  // max 20 seconds polling
        setStatus('error')
        return
      }

      try {
        const { data } = await api.get(`/docs/${docId}/conflicts/${threadId}/analysis`, { token })

        if (data.status === 'ready') {
          setAnalysis(data.analysis)
          setStatus('ready')
        } else if (data.status === 'analyzing') {
          // Server is processing — poll again after retryAfter seconds
          setTimeout(() => poll(retries + 1), (data.retryAfter || 2) * 1000)
        }
      } catch {
        setStatus('error')
      }
    }

    await poll()
  }, [docId, threadId, token])

  // Auto-fetch when threadId is provided
  useEffect(() => {
    if (threadId) fetch()
  }, [threadId, fetch])

  return { analysis, status, refetch: fetch }
}
