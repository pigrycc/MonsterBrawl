/**
 * Proximity voice chat (GDD §2, feedback #3) — WebRTC mesh with positional 3D
 * audio and a voice-activity gate. Signaling (SDP/ICE) is relayed through the
 * authoritative host (VOICE_SIGNAL); each remote peer's audio is played through
 * a Web Audio PannerNode positioned at that trainer's arena location, so voices
 * attenuate with distance (proximity). Push-to-mute on [V].
 *
 * ⚠️ UNVERIFIED IN THIS SANDBOX. There is no microphone, no second peer, and no
 * audio device here, and the headless browser is network-isolated from the
 * server — so this module's runtime behavior could NOT be exercised. The code
 * follows standard WebRTC + Web Audio patterns and is written defensively
 * (feature-detects getUserMedia/RTCPeerConnection and no-ops if unavailable),
 * but it needs real two-machine testing with mics to confirm.
 */
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const VAD_THRESHOLD = 0.02;   // RMS above this = "speaking"
const MAX_DISTANCE = 25;      // metres — beyond this a peer is inaudible

export class VoiceChat {
  /**
   * @param {Object} o
   * @param {import('../net/netClient.js').NetClient} o.net
   * @param {() => string} o.localPlayerId
   */
  constructor({ net, localPlayerId }) {
    this.net = net;
    this.localPlayerId = localPlayerId;
    this.enabled = false;
    this.muted = false;
    this.peers = new Map();   // peerId → { pc, panner, audioEl, gain }
    this.localStream = null;
    this.ctx = null;
    this._positions = new Map(); // peerId → {x,y,z}
    this._offs = [];
  }

  /** Attempt to start voice. Safe no-op if media/RTC APIs are unavailable. */
  async start() {
    const hasMedia = typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia;
    const hasRTC = typeof RTCPeerConnection !== 'undefined';
    if (!hasMedia || !hasRTC) { console.warn('[MCB] voice unavailable (no getUserMedia/RTCPeerConnection)'); return false; }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      console.warn('[MCB] mic permission denied / unavailable:', e?.message);
      return false;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = new AC();
    this.ctx.listener.positionZ && (this.ctx.listener.positionZ.value = 0); // guard for API variance
    this.enabled = true;
    this._installVad();
    this._offs.push(
      this.net.on('voiceSignal', (m) => this._onSignal(m)),
      this.net.on('playerJoined', (p) => this._initiateTo(p.id)),
      this.net.on('playerLeft', (m) => this._dropPeer(m.playerId)),
    );
    // Initiate connections to everyone already in the room.
    for (const p of this.net.room?.players || []) if (p.id !== this.localPlayerId()) this._initiateTo(p.id);
    return true;
  }

  _makePeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    pc.onicecandidate = (e) => { if (e.candidate) this.net.voiceSignal(peerId, { ice: e.candidate }); };
    pc.ontrack = (e) => this._attachRemote(peerId, e.streams[0]);
    const entry = { pc, panner: null, audioEl: null };
    this.peers.set(peerId, entry);
    return entry;
  }

  async _initiateTo(peerId) {
    if (peerId === this.localPlayerId()) return;
    const { pc } = this._makePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.net.voiceSignal(peerId, { sdp: pc.localDescription });
  }

  async _onSignal({ from, signal }) {
    const { pc } = this._makePeer(from);
    if (signal.sdp) {
      await pc.setRemoteDescription(signal.sdp);
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.net.voiceSignal(from, { sdp: pc.localDescription });
      }
    } else if (signal.ice) {
      try { await pc.addIceCandidate(signal.ice); } catch { /* ignore late ICE */ }
    }
  }

  /** Route a peer's incoming audio through a positional PannerNode. */
  _attachRemote(peerId, stream) {
    const entry = this.peers.get(peerId); if (!entry) return;
    // A muted <audio> element is required in some browsers to pump the stream.
    const el = new Audio(); el.srcObject = stream; el.muted = true; el.play?.().catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream);
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
    panner.refDistance = 2; panner.maxDistance = MAX_DISTANCE; panner.rolloffFactor = 1.5;
    src.connect(panner).connect(this.ctx.destination);
    entry.panner = panner; entry.audioEl = el;
    const pos = this._positions.get(peerId);
    if (pos) this._setPanner(panner, pos);
  }

  /** Update a peer's world position (called from the arena each frame). */
  setPeerPosition(peerId, x, y, z) {
    this._positions.set(peerId, { x, y, z });
    const e = this.peers.get(peerId);
    if (e?.panner) this._setPanner(e.panner, { x, y, z });
  }

  /** Update the local listener (camera) position/orientation. */
  setListener(pos, forward) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z; }
    else L.setPosition?.(pos.x, pos.y, pos.z);
    if (forward && L.forwardX) { L.forwardX.value = forward.x; L.forwardY.value = forward.y; L.forwardZ.value = forward.z; }
  }

  _setPanner(panner, p) {
    if (panner.positionX) { panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z; }
    else panner.setPosition?.(p.x, p.y, p.z);
  }

  /** Voice-activity gate: toggles the mic track + broadcasts speaking state. */
  _installVad() {
    const src = this.ctx.createMediaStreamSource(this.localStream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let speaking = false;
    const tick = () => {
      if (!this.enabled) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = !this.muted && rms > VAD_THRESHOLD;
      // gate the outgoing track
      for (const t of this.localStream.getAudioTracks()) t.enabled = now;
      if (now !== speaking) { speaking = now; this.net.voiceSpeaking(now); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  toggleMute() { this.muted = !this.muted; return this.muted; }

  _dropPeer(peerId) {
    const e = this.peers.get(peerId);
    if (!e) return;
    try { e.pc.close(); } catch { /* noop */ }
    e.audioEl && (e.audioEl.srcObject = null);
    this.peers.delete(peerId);
  }

  stop() {
    this.enabled = false;
    this._offs.forEach((off) => off());
    for (const id of [...this.peers.keys()]) this._dropPeer(id);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close?.();
  }
}
