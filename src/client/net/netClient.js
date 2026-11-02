/**
 * Client networking layer (GDD §2). Connects to the authoritative host over
 * WebSocket, sends INTENT messages, and tracks the authoritative room snapshot.
 * Emits events the UI/phases subscribe to. Measures round-trip ping.
 *
 * Works in the browser (global WebSocket) and in Node (pass a WebSocket impl),
 * so it's testable headlessly against the real server.
 */
import { C2S, C2S_COMBAT, S2C, encode, decode, PROTOCOL_VERSION } from '../../shared/protocol.js';

export class NetClient {
  /**
   * @param {Object} [opts]
   * @param {typeof WebSocket} [opts.WebSocketImpl]  defaults to global WebSocket
   */
  constructor({ WebSocketImpl } = {}) {
    this.WS = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.ws = null;
    this.playerId = null;
    this.isHost = false;
    this.room = null;           // latest authoritative snapshot
    this.ping = null;           // ms
    this._listeners = new Map(); // event → Set<fn>
    this._pingTimer = null;
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }
  _emit(event, payload) { this._listeners.get(event)?.forEach((fn) => fn(payload)); }

  /**
   * @param {string} url   e.g. ws://127.0.0.1:7777
   * @param {string} name  display name
   * @returns {Promise<{playerId:string,isHost:boolean}>}
   */
  connect(url, name) {
    return new Promise((resolve, reject) => {
      if (!this.WS) return reject(new Error('no_websocket_impl'));
      const ws = new this.WS(url);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => { this._send(C2S.HELLO, { name, version: PROTOCOL_VERSION }); };
      ws.onerror = (e) => { if (!settled) { settled = true; reject(new Error('connect_failed')); } };
      ws.onclose = () => { this._stopPing(); this._emit('disconnect'); };
      ws.onmessage = (ev) => {
        const msg = decode(typeof ev.data === 'string' ? ev.data : ev.data.toString());
        if (!msg) return;
        this._handle(msg);
        if (!settled && msg.type === S2C.WELCOME) {
          settled = true;
          resolve({ playerId: this.playerId, isHost: this.isHost });
        } else if (!settled && msg.type === S2C.ERROR) {
          settled = true; reject(new Error(msg.data.reason || 'error'));
        }
      };
    });
  }

  _handle({ type, data }) {
    switch (type) {
      case S2C.WELCOME:
        this.playerId = data.playerId; this.isHost = data.isHost; this.room = data.room;
        this._startPing();
        this._emit('welcome', data); this._emit('room', this.room);
        break;
      case S2C.ROOM_STATE:
        this.room = data;
        this.isHost = data.hostId === this.playerId;
        this._emit('room', this.room);
        break;
      case S2C.PLAYER_JOINED: this._emit('playerJoined', data.player); break;
      case S2C.PLAYER_LEFT: this._emit('playerLeft', data); break;
      case S2C.PHASE: this._emit('phase', data); break;
      case S2C.CHAT: this._emit('chat', data); break;
      case S2C.PONG: this.ping = Math.round(performance.now() - data.t); this._emit('ping', this.ping); break;
      case S2C.COMBAT_SNAPSHOT: this._emit('combatSnapshot', data); break;
      case S2C.COMBAT_END: this._emit('combatEnd', data); break;
      case S2C.ERROR: this._emit('error', data); break;
    }
  }

  _send(type, data) { if (this.ws && this.ws.readyState === 1) this.ws.send(encode(type, data)); }

  // Intents
  setAppearance(patch) { this._send(C2S.SET_APPEARANCE, patch); }
  selectMonster(monsterId) { this._send(C2S.SELECT_MONSTER, { monsterId }); }
  setConfig(patch) { this._send(C2S.HOST_CONFIG, patch); }
  startMatch() { this._send(C2S.START_MATCH, {}); }
  chat(text) { this._send(C2S.CHAT, { text }); }
  // #2 combat intents
  combatStance(stance) { this._send(C2S_COMBAT.STANCE, { stance }); }
  combatCast(slot) { this._send(C2S_COMBAT.CAST, { slot }); }
  combatShove() { this._send(C2S_COMBAT.SHOVE, {}); }

  _startPing() {
    this._stopPing();
    const ping = () => this._send(C2S.PING, { t: performance.now() });
    ping();
    this._pingTimer = setInterval(ping, 2000);
  }
  _stopPing() { if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; } }

  disconnect() { this._stopPing(); try { this.ws?.close(); } catch { /* noop */ } }
}
