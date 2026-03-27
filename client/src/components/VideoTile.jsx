import React, { useEffect, useRef, useState } from 'react'

/**
 * Single participant video tile.
 */
export default function VideoTile({ stream, name, color, muted, cameraOff, isLocal, size = 'small' }) {
  const videoRef = useRef()
  const [hasVideo, setHasVideo] = useState(false)

  useEffect(() => {
    if (!videoRef.current) return
    if (stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('Video auto-play delayed until interaction', error)
        }
      })

      // Check if there is a live video track in this stream.
      // This is the source of truth — not just the cameraOff flag.
      // For remote peers: cameraOff=true on an audio-only user shouldn't
      // hide video that IS arriving from another peer's camera.
      const checkVideo = () => {
        const videoTracks = stream.getVideoTracks()
        setHasVideo(videoTracks.some(t => t.readyState === 'live' && t.enabled))
      }
      checkVideo()

      // Re-check when tracks change
      stream.addEventListener('addtrack', checkVideo)
      stream.addEventListener('removetrack', checkVideo)
      return () => {
        stream.removeEventListener('addtrack', checkVideo)
        stream.removeEventListener('removetrack', checkVideo)
      }
    } else {
      videoRef.current.srcObject = null
      setHasVideo(false)
    }
  }, [stream])

  // Show avatar if:
  // - No stream at all
  // - Local user explicitly turned camera off (cameraOff flag)
  // - Remote stream has no active video tracks
  const showAvatar = !stream || (isLocal ? cameraOff : !hasVideo)

  return (
    <div className={`video-tile video-tile--${size} ${showAvatar ? 'video-tile--camera-off' : ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="video-tile__video"
        style={{ display: showAvatar ? 'none' : 'block' }}
      />

      {showAvatar && (
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
