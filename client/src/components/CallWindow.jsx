import React, { useState, useRef, useCallback, useEffect } from 'react'
import VideoTile from './VideoTile'
import CallControls from './CallControls'
import CallJoinPrompt from './CallJoinPrompt'
import { useCallState } from '../hooks/useCallState'

/**
 * Main draggable Call window anchored to the bottom right.
 */
export default function CallWindow({ socket, docId, currentUser }) {
  const {
    inCall, localStream, peers,
    muted, cameraOff,
    joinCall, leaveCall,
    toggleMute, toggleCamera,
    callError
  } = useCallState({ socket, docId })

  const [callPrompt, setCallPrompt] = useState(null)  
  const [minimized, setMinimized] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })  
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPos: { x: 0, y: 0 } })
  const windowRef = useRef()

  useEffect(() => {
    const handlePeerJoined = ({ name }) => {
      if (!inCall) {
        setCallPrompt({ callerName: name })
      }
    }
    
    // Catch existing calls when joining document
    const handleInitialSync = (payload) => {
      if (payload.activeCallers?.length > 0 && !inCall) {
        setCallPrompt({ callerName: payload.activeCallers[0].name })
      }
    }

    socket.on('call:peer-joined', handlePeerJoined)
    socket.on('doc:init', handleInitialSync)
    socket.on('doc:sync:response', handleInitialSync)

    return () => {
      socket.off('call:peer-joined', handlePeerJoined)
      socket.off('doc:init', handleInitialSync)
      socket.off('doc:sync:response', handleInitialSync)
    }
  }, [socket, inCall])

  const onMouseDown = useCallback((e) => {
    // Prevent dragging if interacting with UI controls or video element
    if (e.target.closest('.call-controls') || e.target.closest('.video-tile')) return
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPos: { ...position }
    }
    e.preventDefault()
  }, [position])

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragRef.current.dragging) return
      setPosition({
        x: dragRef.current.startPos.x + (e.clientX - dragRef.current.startX),
        y: dragRef.current.startPos.y + (e.clientY - dragRef.current.startY)
      })
    }
    const onMouseUp = () => { dragRef.current.dragging = false }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const peersArray = [...peers.entries()]
  const totalParticipants = (inCall ? 1 : 0) + peersArray.length

  if (!inCall && !callPrompt) {
    return (
      <button
        className="call-start-btn"
        onClick={joinCall}
        title="Start video call"
      >
        📹
      </button>
    )
  }

  if (!inCall && callPrompt) {
    return (
      <CallJoinPrompt
        callerName={callPrompt.callerName}
        onJoin={() => { setCallPrompt(null); joinCall() }}
        onDismiss={() => setCallPrompt(null)}
      />
    )
  }

  return (
    <div
      ref={windowRef}
      className={`call-window ${minimized ? 'call-window--minimized' : ''} ${callError ? 'call-window--has-error' : ''}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onMouseDown={onMouseDown}
    >
      <div className="call-window__header">
        <span className="call-window__title">
          📹 {totalParticipants} participant{totalParticipants !== 1 ? 's' : ''}
        </span>
        <div className="call-window__header-actions">
          <button
            className="call-window__minimize"
            onClick={() => setMinimized(v => !v)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {callError && <div className="call-window__error">{callError}</div>}
      
      {!minimized && (
        <>
          <div className={`call-window__grid call-window__grid--${Math.min(totalParticipants, 4)}`}>
            {/* Local participant */}
            <VideoTile
              stream={localStream}
              name={currentUser.name}
              color={currentUser.color}
              muted={muted}
              cameraOff={cameraOff}
              isLocal={true}
              size="small"
            />
            {/* Remote participants */}
            {peersArray.map(([socketId, peer]) => (
              <VideoTile
                key={socketId}
                stream={peer.stream}
                name={peer.name}
                color={peer.color}
                muted={peer.muted}
                cameraOff={peer.cameraOff}
                isLocal={false}
                size="small"
              />
            ))}
          </div>

          <CallControls
            muted={muted}
            cameraOff={cameraOff}
            onToggleMute={toggleMute}
            onToggleCamera={toggleCamera}
            onLeave={leaveCall}
            participantCount={totalParticipants}
          />
        </>
      )}
    </div>
  )
}
