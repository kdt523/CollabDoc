import { useEffect, useRef, useCallback, useState } from 'react'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

/**
 * Core WebRTC hook. Manages peer connections for a full-mesh call.
 *
 * Signaling flow (critical to get right to avoid glare):
 *   - NEW joiner B receives `call:participants` → B creates offer to each existing peer (OFFERER)
 *   - EXISTING peer A receives `call:peer-joined` → A only updates UI state; waits for B's offer
 *   - A receives `signal:offer` from B → A sets remote desc, adds own tracks, answers (ANSWERER)
 *
 * Why split offerer/answerer?
 *   - `addTransceiver` before setRemoteDescription (offerer path) creates the m-lines in the offer
 *   - On the answerer path, `addTransceiver` after receiving an offer adds EXTRA m-lines → glare/failure
 *   - Instead, answerer uses `addTrack` AFTER `setRemoteDescription` which reuses matched transceivers
 */
export function useWebRTC({ socket, localStream, inCall }) {
  const peerConnections = useRef(new Map())
  const remoteStreams = useRef(new Map())
  const pendingIceCandidates = useRef(new Map())
  const [peers, setPeers] = useState(new Map())

  // Stable refs to avoid stale closures in event handlers
  const localStreamRef = useRef(localStream)
  useEffect(() => { localStreamRef.current = localStream }, [localStream])

  const inCallRef = useRef(inCall)
  useEffect(() => { inCallRef.current = inCall }, [inCall])

  // ─── Helper: close & remove a peer connection ─────────────────────
  const closePeerConnection = useCallback((remoteSocketId) => {
    const pc = peerConnections.current.get(remoteSocketId)
    if (pc) {
      pc.ontrack = null
      pc.onicecandidate = null
      pc.onconnectionstatechange = null
      pc.close()
      peerConnections.current.delete(remoteSocketId)
    }
    remoteStreams.current.delete(remoteSocketId)
    pendingIceCandidates.current.delete(remoteSocketId)
    setPeers(prev => {
      const next = new Map(prev)
      next.delete(remoteSocketId)
      return next
    })
  }, [])

  // ─── Helper: attach ontrack / onicecandidate handlers to a fresh PC ─
  const setupPCHandlers = useCallback((pc, remoteSocketId, peerInfo) => {
    pc.ontrack = (event) => {
      const stream = remoteStreams.current.get(remoteSocketId) || new MediaStream()
      const tracks = event.streams[0]?.getTracks() || [event.track]
      tracks.forEach(t => {
        if (!stream.getTracks().some(x => x.id === t.id)) stream.addTrack(t)
      })
      remoteStreams.current.set(remoteSocketId, stream)
      setPeers(prev => {
        const next = new Map(prev)
        const existing = next.get(remoteSocketId) || {}
        next.set(remoteSocketId, { ...existing, ...peerInfo, stream })
        return next
      })
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal:ice', { to: remoteSocketId, candidate: event.candidate.toJSON() })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        closePeerConnection(remoteSocketId)
      }
    }
  }, [socket, closePeerConnection])

  // ─── OFFERER path: create PC with explicit transceivers BEFORE offer ─
  //     Called by the NEW JOINER when they receive the existing participants list.
  const createOfferPC = useCallback((remoteSocketId, peerInfo) => {
    if (peerConnections.current.has(remoteSocketId)) {
      return peerConnections.current.get(remoteSocketId)
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    setupPCHandlers(pc, remoteSocketId, peerInfo)

    const stream = localStreamRef.current
    const audioTrack = stream?.getAudioTracks()[0] || null
    const videoTrack = stream?.getVideoTracks()[0] || null

    // Add transceivers upfront — this defines the m-lines in the offer SDP.
    // recvonly = "I have no track to send, but please send me yours"
    const audioTx = pc.addTransceiver('audio', {
      direction: audioTrack ? 'sendrecv' : 'recvonly'
    })
    const videoTx = pc.addTransceiver('video', {
      direction: videoTrack ? 'sendrecv' : 'recvonly'
    })

    if (audioTrack) audioTx.sender.replaceTrack(audioTrack)
    if (videoTrack) videoTx.sender.replaceTrack(videoTrack)

    peerConnections.current.set(remoteSocketId, pc)
    setPeers(prev => {
      const next = new Map(prev)
      if (!next.has(remoteSocketId)) next.set(remoteSocketId, { ...peerInfo, stream: null })
      return next
    })

    return pc
  }, [setupPCHandlers])

  // ─── ANSWERER path: create bare PC, NO transceivers ──────────────────
  //     Transceivers come from the offerer's SDP via setRemoteDescription.
  //     Tracks are added with addTrack() AFTER setRemoteDescription,
  //     which reuses the matched transceivers instead of creating new m-lines.
  const createAnswerPC = useCallback((remoteSocketId, peerInfo) => {
    if (peerConnections.current.has(remoteSocketId)) {
      return peerConnections.current.get(remoteSocketId)
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    setupPCHandlers(pc, remoteSocketId, peerInfo)

    peerConnections.current.set(remoteSocketId, pc)
    setPeers(prev => {
      const next = new Map(prev)
      if (!next.has(remoteSocketId)) next.set(remoteSocketId, { ...peerInfo, stream: null })
      return next
    })

    return pc
  }, [setupPCHandlers])

  // ─── Flush queued ICE candidates once remote description is set ───────
  const flushPendingIceCandidates = useCallback(async (remoteSocketId) => {
    const pc = peerConnections.current.get(remoteSocketId)
    const queued = pendingIceCandidates.current.get(remoteSocketId) || []
    if (!pc || !pc.remoteDescription || queued.length === 0) return
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch (_) {}
    }
    pendingIceCandidates.current.delete(remoteSocketId)
  }, [])

  // ─── Signaling event handlers (registered once on mount) ─────────────
  useEffect(() => {
    if (!socket) return

    // B (new joiner) receives existing participants → B is the OFFERER to each
    const handleParticipants = async (participants) => {
      if (!inCallRef.current) return
      for (const peer of participants) {
        try {
          const pc = createOfferPC(peer.socketId, peer)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socket.emit('signal:offer', { to: peer.socketId, offer })
        } catch (err) {
          console.error('[WebRTC] handleParticipants offer failed:', err)
        }
      }
    }

    // A (existing peer) receives notification that B joined.
    // IMPORTANT: Do NOT create an offer here — that causes glare.
    // B will send us an offer via handleParticipants; we will answer in handleOffer.
    const handlePeerJoined = (peer) => {
      setPeers(prev => {
        const next = new Map(prev)
        next.set(peer.socketId, { ...peer, stream: null })
        return next
      })
    }

    // A (existing) receives offer from B → A is the ANSWERER
    const handleOffer = async ({ from, offer }) => {
      if (!inCallRef.current) return
      try {
        const pc = createAnswerPC(from, {})
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        await flushPendingIceCandidates(from)

        // Add our tracks AFTER setRemoteDescription.
        // addTrack() reuses the transceivers that were created by setRemoteDescription
        // from the offer's m-lines — no extra m-lines are added. This is key.
        const stream = localStreamRef.current
        const audioTrack = stream?.getAudioTracks()[0] || null
        const videoTrack = stream?.getVideoTracks()[0] || null
        if (audioTrack) pc.addTrack(audioTrack, stream)
        if (videoTrack) pc.addTrack(videoTrack, stream)

        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('signal:answer', { to: from, answer })
      } catch (err) {
        console.error('[WebRTC] handleOffer (answerer) failed:', err)
      }
    }

    const handleAnswer = async ({ from, answer }) => {
      const pc = peerConnections.current.get(from)
      if (!pc) return
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer))
        await flushPendingIceCandidates(from)
      } catch (err) {
        console.error('[WebRTC] handleAnswer failed:', err)
      }
    }

    const handleIce = async ({ from, candidate }) => {
      const pc = peerConnections.current.get(from)
      if (!pc || !pc.remoteDescription) {
        const queued = pendingIceCandidates.current.get(from) || []
        queued.push(candidate)
        pendingIceCandidates.current.set(from, queued)
        return
      }
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch (_) {}
    }

    const handlePeerLeft = ({ socketId }) => closePeerConnection(socketId)

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
  }, [socket, createOfferPC, createAnswerPC, closePeerConnection, flushPendingIceCandidates])

  // ─── Cleanup all connections when leaving the call ────────────────────
  useEffect(() => {
    if (!inCall) {
      for (const [socketId] of peerConnections.current) {
        closePeerConnection(socketId)
      }
      setPeers(new Map())
    }
  }, [inCall, closePeerConnection])

  // ─── Live track swap when localStream changes (e.g., camera toggled) ─
  useEffect(() => {
    if (!inCall) return
    peerConnections.current.forEach((pc) => {
      const stream = localStreamRef.current
      const audioTrack = stream?.getAudioTracks()[0] || null
      const videoTrack = stream?.getVideoTracks()[0] || null

      pc.getTransceivers().forEach((transceiver) => {
        const kind = transceiver.receiver.track?.kind
        if (kind === 'video') {
          transceiver.direction = videoTrack ? 'sendrecv' : 'recvonly'
          transceiver.sender.replaceTrack(videoTrack)
        }
        if (kind === 'audio') {
          transceiver.direction = audioTrack ? 'sendrecv' : 'recvonly'
          transceiver.sender.replaceTrack(audioTrack)
        }
      })
    })
  }, [localStream, inCall])

  return { peers }
}
