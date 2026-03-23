import { useState, useEffect, useRef, useCallback } from 'react'
import { useWebRTC } from './useWebRTC'

/**
 * Manages local media stream and call UI state.
 */
export function useCallState({ socket, docId }) {
  const [inCall, setInCall] = useState(false)
  const [localStream, setLocalStream] = useState(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [callError, setCallError] = useState(null)
  const streamRef = useRef(null)

  const { peers } = useWebRTC({ socket, localStream, inCall })

  const joinCall = useCallback(async () => {
    setCallError(null)
    let stream = null
    try {
      // 1) Try full Video + Audio
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      })
    } catch (err) {
      console.warn('Initial camera/mic request failed:', err.name)
      // 2) Fallback to Audio Only if Video is blocked or missing
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        setCallError('Camera is currently in use or not found. Joining with audio only.')
        setCameraOff(true) // Start with camera off UI state
      } catch (audioErr) {
        setCallError('Microphone access denied or not found. Cannot join call.')
        return 
      }
    }

    if (stream) {
      streamRef.current = stream
      setLocalStream(stream)
      setInCall(true)
      socket.emit('call:join')
    }
  }, [socket])

  const leaveCall = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setLocalStream(null)
    setInCall(false)
    setMuted(false)
    setCameraOff(false)

    socket.emit('call:leave')
  }, [socket])

  const toggleMute = useCallback(() => {
    if (!streamRef.current) return
    const audioTrack = streamRef.current.getAudioTracks()[0]
    if (!audioTrack) return

    audioTrack.enabled = !audioTrack.enabled
    const newMuted = !audioTrack.enabled
    setMuted(newMuted)

    socket.emit('call:state-change', { muted: newMuted, cameraOff })
  }, [socket, cameraOff])

  const toggleCamera = useCallback(() => {
    if (!streamRef.current) return
    const videoTrack = streamRef.current.getVideoTracks()[0]
    if (!videoTrack) return

    videoTrack.enabled = !videoTrack.enabled
    const newCameraOff = !videoTrack.enabled
    setCameraOff(newCameraOff)

    socket.emit('call:state-change', { muted, cameraOff: newCameraOff })
  }, [socket, muted])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  return {
    inCall, localStream, peers,
    muted, cameraOff,
    joinCall, leaveCall,
    toggleMute, toggleCamera,
    callError
  }
}
