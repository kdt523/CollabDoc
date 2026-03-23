import React, { useEffect, useRef } from 'react'

/**
 * Single participant video tile.
 */
export default function VideoTile({ stream, name, color, muted, cameraOff, isLocal, size = 'small' }) {
  const videoRef = useRef()

  useEffect(() => {
    if (!videoRef.current) return
    if (stream) {
      videoRef.current.srcObject = stream
      // Explicit play is more robust than autoPlay attribute alone
      videoRef.current.play().catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('Video auto-play delayed until interaction', error)
        }
      })
    } else {
      videoRef.current.srcObject = null
    }
  }, [stream])

  return (
    <div className={`video-tile video-tile--${size} ${cameraOff ? 'video-tile--camera-off' : ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}  // Prevents echo loop
        className="video-tile__video"
      />

      {(cameraOff || !stream) && (
        <div
          className="video-tile__avatar"
          style={{ background: color || '#555' }}
        >
          {name?.[0]?.toUpperCase() || '?'}
        </div>
      )}

      <div className="video-tile__label">
        <span className="video-tile__name">{isLocal ? `${name} (you)` : name}</span>
        {muted && <span className="video-tile__muted-icon">🔇</span>}
      </div>
    </div>
  )
}
