import React from 'react'

/**
 * Call action buttons (mute, camera, leave).
 */
export default function CallControls({
  muted, cameraOff,
  onToggleMute, onToggleCamera, onLeave,
  participantCount
}) {
  return (
    <div className="call-controls">
      <span className="call-controls__count">
        {participantCount} in call
      </span>

      <button
        className={`call-controls__btn ${muted ? 'call-controls__btn--active' : ''}`}
        onClick={onToggleMute}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? '🔇' : '🎙️'}
      </button>

      <button
        className={`call-controls__btn ${cameraOff ? 'call-controls__btn--active' : ''}`}
        onClick={onToggleCamera}
        title={cameraOff ? 'Turn camera on' : 'Turn camera off'}
      >
        {cameraOff ? '📷' : '🎥'}
      </button>

      <button
        className="call-controls__btn call-controls__btn--leave"
        onClick={onLeave}
        title="Leave call"
      >
        📵
      </button>
    </div>
  )
}
