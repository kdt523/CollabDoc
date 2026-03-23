const Y = require('yjs')
const crypto = require('crypto')

/**
 * Walk the Y.Text linked list to extract causal provenance for a text range.
 * 
 * WHY WE ACCESS INTERNAL YJS STRUCTURE:
 * The public Yjs API only exposes the document's current text content.
 * The causal metadata (who inserted what, when, with what causal neighbors)
 * lives in the internal linked list of Y.Item nodes. This is the only way
 * to answer "why does this text exist" — which is the core value of this feature.
 * We use Yjs v13 internals which are stable. If upgrading Yjs, re-verify these fields.
 */

function extractCausalChain(ydoc, fromIndex, toIndex) {
  // Input validation
  if (fromIndex < 0 || toIndex <= fromIndex) {
    throw new Error(`Invalid range: [${fromIndex}, ${toIndex}]`)
  }

  const ytext = ydoc.getText('content')
  const totalLength = ytext.length

  if (fromIndex >= totalLength) {
    return { items: [], range: { from: fromIndex, to: toIndex } }
  }

  const clampedTo = Math.min(toIndex, totalLength)
  const items = []

  // Walk the internal linked list
  // _start is the sentinel node; actual content starts at _start.right
  let current = ytext._start
  let currentIndex = 0

  while (current !== null) {
    // Skip deleted items (tombstones) — they don't contribute to visible text
    // BUT we still want to know they existed for conflict archaeology
    if (!current.deleted) {
      const itemEnd = currentIndex + current.length

      // Check if this item overlaps with our requested range
      if (currentIndex < clampedTo && itemEnd > fromIndex) {
        const overlapFrom = Math.max(0, fromIndex - currentIndex)
        const overlapTo = Math.min(current.length, clampedTo - currentIndex)
        const chars = current.content.str
          ? current.content.str.slice(overlapFrom, overlapTo)
          : ''

        items.push({
          chars,
          authorClientId: current.id.client,
          clock: current.id.clock,
          // origin = the item that was to the LEFT when this was inserted
          // This encodes the causal dependency: "I was inserted after X"
          originClientId: current.origin ? current.origin.id.client : null,
          originClock:    current.origin ? current.origin.id.clock  : null,
          // rightOrigin = item to the RIGHT at insertion time
          rightOriginClientId: current.rightOrigin ? current.rightOrigin.id.client : null,
          rightOriginClock:    current.rightOrigin ? current.rightOrigin.id.clock  : null,
          absoluteIndex: currentIndex + overlapFrom,
          length: overlapTo - overlapFrom
        })
      }

      currentIndex += current.length
      if (currentIndex >= clampedTo) break
    } else {
      // Deleted item — record it for conflict archaeology but don't count index
      // We record if it falls within our range by checking its origin pointers
      if (current.id.clock >= 0) {
        items.push({
          chars: '[deleted]',
          authorClientId: current.id.client,
          clock: current.id.clock,
          deleted: true,
          originClientId: current.origin ? current.origin.id.client : null,
          originClock:    current.origin ? current.origin.id.clock  : null,
          absoluteIndex: currentIndex,
          length: 0
        })
      }
    }

    current = current.right
  }

  return {
    items,
    range: { from: fromIndex, to: clampedTo },
    stateVector: Array.from(Y.encodeStateVector(ydoc))
  }
}

/**
 * Convert raw causal chain items into a structured provenance result.
 * Groups consecutive items by the same author into spans.
 * Detects concurrent insertions (items with the same origin pointer = concurrent).
 */
function buildProvenanceResult(chain, clientIdToUser) {
  const { items, range } = chain

  if (items.length === 0) {
    return { spans: [], concurrentGroups: [], range }
  }

  // Group consecutive non-deleted items by author
  const spans = []
  let currentSpan = null

  for (const item of items.filter(i => !i.deleted)) {
    const author = clientIdToUser(item.authorClientId) || {
      clientId: item.authorClientId,
      name: `User ${item.authorClientId}`,
      color: '#888'
    }

    if (currentSpan && currentSpan.authorClientId === item.authorClientId) {
      currentSpan.chars += item.chars
      currentSpan.clockEnd = item.clock
    } else {
      currentSpan = {
        chars: item.chars,
        authorClientId: item.authorClientId,
        authorName: author.name,
        authorColor: author.color,
        clockStart: item.clock,
        clockEnd: item.clock,
        absoluteStart: item.absoluteIndex
      }
      spans.push(currentSpan)
    }
  }

  // Detect concurrent insertions:
  // Two items are concurrent if they share the same origin (both inserted "after" the same item)
  // This is exactly what causes CRDT merge decisions
  const concurrentGroups = []
  const originMap = new Map() // originKey → [items]

  for (const item of items.filter(i => !i.deleted)) {
    const key = `${item.originClientId}:${item.originClock}`
    if (!originMap.has(key)) originMap.set(key, [])
    originMap.get(key).push(item)
  }

  for (const [originKey, group] of originMap) {
    if (group.length > 1) {
      // Multiple items share the same causal left-neighbor = they were inserted concurrently
      const uniqueAuthors = [...new Set(group.map(i => i.authorClientId))]
      if (uniqueAuthors.length > 1) {
        concurrentGroups.push({
          originKey,
          items: group,
          authors: uniqueAuthors.map(id => clientIdToUser(id) || { clientId: id, name: `User ${id}` })
        })
      }
    }
  }

  return { spans, concurrentGroups, range }
}

/**
 * Compute per-author contribution for a text range.
 * Contribution = (characters currently visible that this author inserted) / total visible chars
 */
function computeContribution(ydoc, fromIndex, toIndex, clientIdToUser) {
  const chain = extractCausalChain(ydoc, fromIndex, toIndex)
  const visibleItems = chain.items.filter(i => !i.deleted)

  if (visibleItems.length === 0) return []

  const totalChars = visibleItems.reduce((sum, item) => sum + item.length, 0)
  const authorChars = new Map()

  for (const item of visibleItems) {
    const current = authorChars.get(item.authorClientId) || 0
    authorChars.set(item.authorClientId, current + item.length)
  }

  return [...authorChars.entries()]
    .map(([clientId, chars]) => ({
      author: clientIdToUser(clientId) || { clientId, name: `User ${clientId}` },
      chars,
      percentage: Math.round((chars / totalChars) * 100),
      // Most significant single contribution by this author
      mostSignificantClock: visibleItems
        .filter(i => i.authorClientId === clientId)
        .reduce((max, i) => i.length > max.length ? i : max, { length: 0 }).clock
    }))
    .sort((a, b) => b.percentage - a.percentage)
}

/**
 * Generate a cache key for a provenance request.
 * Invalidated when the document state changes (stateVector changes).
 */
function provenanceCacheKey(docId, fromIndex, toIndex, stateVector) {
  const input = `${docId}:${fromIndex}:${toIndex}:${stateVector.join(',')}`
  return crypto.createHash('sha256').update(input).digest('hex')
}

module.exports = {
  extractCausalChain,
  buildProvenanceResult,
  computeContribution,
  provenanceCacheKey
}
