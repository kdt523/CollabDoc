import { useEffect, useRef, useCallback, useState } from 'react'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
  // PRODUCTION NOTE: Add TURN server here for symmetric NAT traversal
  // { urls: 'turn:your-turn-server.com', username: '...', credential: '...' }
]

/**
 * Core WebRTC hook. Manages peer connections for a full-mesh call.
 * 
 * Props:
 *   socket      - existing Socket.io socket instance
 *   localStream - MediaStream from getUserMedia
 *   inCall      - boolean — whether we are currently in the call
 * 
 * Returns:
 *   peers       - Map<socketId, { stream: MediaStream, name, color, muted, cameraOff }>
 */
export function useWebRTC({ socket, localStream, inCall }) {
  // Map<socketId, RTCPeerConnection>
  const peerConnections = useRef(new Map())
  const [peers, setPeers] = useState(new Map())

  // Helper: create a new RTCPeerConnection to a specific peer
  const createPeerConnection = useCallback((remoteSocketId, peerInfo) => {
    if (peerConnections.current.has(remoteSocketId)) {
      return peerConnections.current.get(remoteSocketId)
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    // CRITICAL: Always add transceivers so the SDP offer has media slots 
    // for both directions, even if localStream is null right now.
    pc.addTransceiver('audio', { direction: 'sendrecv' })
    pc.addTransceiver('video', { direction: 'sendrecv' })

    // Add our local tracks if they are ALREADY available
    if (localStream) {
      localStream.getTracks().forEach(track => {
        const sender = pc.getSenders().find(s => s.track?.kind === track.kind || (!s.track && s.dtlsTransport))
        if (sender) sender.replaceTrack(track)
        else pc.addTrack(track, localStream)
      })
    }

    // When we receive the remote peer's tracks, store them
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      setPeers(prev => {
        const next = new Map(prev)
        const existing = next.get(remoteSocketId) || {}
        next.set(remoteSocketId, { ...existing, ...peerInfo, stream: remoteStream })
        return next
      })
    }

    // When ICE generates a candidate, send it to the peer via signaling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal:ice', {
          to: remoteSocketId,
          candidate: event.candidate.toJSON()
        })
      }
    }

    // Monitor connection state for UI feedback
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        closePeerConnection(remoteSocketId)
      }
    }

    peerConnections.current.set(remoteSocketId, pc)

    // Add peer to state immediately (stream arrives via ontrack shortly after)
    setPeers(prev => {
      const next = new Map(prev)
      if (!next.has(remoteSocketId)) {
        next.set(remoteSocketId, { ...peerInfo, stream: null })
      }
      return next
    })

    return pc
  }, [localStream, socket])

  const closePeerConnection = useCallback((remoteSocketId) => {
    const pc = peerConnections.current.get(remoteSocketId)
    if (pc) {
      pc.ontrack = null
      pc.onicecandidate = null
      pc.onconnectionstatechange = null
      pc.close()
      peerConnections.current.delete(remoteSocketId)
    }
    setPeers(prev => {
      const next = new Map(prev)
      next.delete(remoteSocketId)
      return next
    })
  }, [])

  // Persistent refs to avoid stale closures in listeners
  const inCallRef = useRef(inCall)
  useEffect(() => { inCallRef.current = inCall }, [inCall])

  useEffect(() => {
    if (!socket) return

    // ── SIGNALING EVENT HANDLERS ──────────────────────────────
    // Permanent listeners registered ONCE on mount

    const handleParticipants = async (participants) => {
      if (!inCallRef.current) return
      for (const peer of participants) {
        const pc = createPeerConnection(peer.socketId, peer)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socket.emit('signal:offer', { to: peer.socketId, offer })
      }
    }

    const handlePeerJoined = (peer) => {
      setPeers(prev => {
        const next = new Map(prev)
        next.set(peer.socketId, { ...peer, stream: null })
        return next
      })
    }

    const handleOffer = async ({ from, offer }) => {
      if (!inCallRef.current) return 
      const pc = createPeerConnection(from, {})
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('signal:answer', { to: from, answer })
    }

    const handleAnswer = async ({ from, answer }) => {
      const pc = peerConnections.current.get(from)
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer))
    }

    const handleIce = async ({ from, candidate }) => {
      const pc = peerConnections.current.get(from)
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (e) { /* ignore late candidates */ }
      }
    }

    const handlePeerLeft = ({ socketId }) => {
      closePeerConnection(socketId)
    }

    const handlePeerStateChange = ({ socketId, muted, cameraOff }) => {
      setPeers(prev => {
        const next = new Map(prev)
        const existing = next.get(socketId)
        if (existing) next.set(socketId, { ...existing, muted, cameraOff })
        return next
      })
    }

    socket.on('call:participants', handleParticipants)
    socket.on('call:peer-joined', handlePeerJoined)
    socket.on('signal:offer', handleOffer)
    socket.on('signal:answer', handleAnswer)
    socket.on('signal:ice', handleIce)
    socket.on('call:peer-left', handlePeerLeft)
    socket.on('call:peer-state-change', handlePeerStateChange)

    return () => {
      socket.off('call:participants', handleParticipants)
      socket.off('call:peer-joined', handlePeerJoined)
      socket.off('signal:offer', handleOffer)
      socket.off('signal:answer', handleAnswer)
      socket.off('signal:ice', handleIce)
      socket.off('call:peer-left', handlePeerLeft)
      socket.off('call:peer-state-change', handlePeerStateChange)
    }
  }, [socket, createPeerConnection, closePeerConnection]) 

  // Cleanup all connections when leaving call
  useEffect(() => {
    if (!inCall) {
      for (const [socketId] of peerConnections.current) {
        closePeerConnection(socketId)
      }
      setPeers(new Map())
    }
  }, [inCall, closePeerConnection])

  // Track update effect: ensure localStream tracks are swapped on existing connections 
  // if the stream becomes available after negotiation
  useEffect(() => {
    if (!localStream || !inCall) return
    peerConnections.current.forEach((pc) => {
      const videoTrack = localStream.getVideoTracks()[0]
      const audioTrack = localStream.getAudioTracks()[0]
      
      pc.getSenders().forEach(sender => {
        if (sender.track?.kind === 'video' && videoTrack) sender.replaceTrack(videoTrack)
        if (sender.track?.kind === 'audio' && audioTrack) sender.replaceTrack(audioTrack)
      })
    })
  }, [localStream, inCall])

  return { peers }
}
