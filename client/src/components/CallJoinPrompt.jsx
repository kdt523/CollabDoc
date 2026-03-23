import React from 'react'

/**
 * Join prompt displayed when another user starts a call.
 */
export default function CallJoinPrompt({ callerName, onJoin, onDismiss }) {
  return (
    <div className="call-join-prompt">
      <div className="call-join-prompt__icon">📹</div>
      <div className="call-join-prompt__text">
        <strong>{callerName}</strong> started a video call
      </div>
      <div className="call-join-prompt__actions">
        <button className="call-join-prompt__join" onClick={onJoin}>
          Join
        </button>
        <button className="call-join-prompt__dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
