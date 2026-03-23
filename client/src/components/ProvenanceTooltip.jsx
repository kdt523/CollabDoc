import { useEffect, useRef } from 'react'
import { useProvenance } from '../hooks/useProvenance'
import CausalChainView from './CausalChainView'

/**
 * Props:
 *   docId       - current document id
 *   selection   - { from, to, fromCoords: { top, left } } | null
 *   onClose     - callback
 */
export default function ProvenanceTooltip({ docId, selection, onClose, token }) {
  const { provenance, loading, fetchProvenance } = useProvenance(docId, token)
  const ref = useRef()

  useEffect(() => {
    if (selection && selection.to > selection.from && token) {
      fetchProvenance(selection.from, selection.to)
    }
  }, [selection, fetchProvenance, token])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (!selection) return null

  const style = {
    position: 'fixed',
    top: Math.max(10, (selection.fromCoords?.top || 100) - 320),
    left: Math.max(10, (selection.fromCoords?.left || 100)),
    zIndex: 1000
  }

  return (
    <div ref={ref} className="provenance-tooltip" style={style}>
      <div className="provenance-tooltip__header">
        <span className="provenance-tooltip__title">Why does this text exist?</span>
        <button className="provenance-tooltip__close" onClick={onClose}>✕</button>
      </div>

      {loading && (
        <div className="provenance-tooltip__loading">
          Walking causal graph<span className="loading-dots">...</span>
        </div>
      )}

      {provenance && !loading && (
        <CausalChainView provenance={provenance} />
      )}
    </div>
  )
}
