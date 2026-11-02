/**
 * Authoritative room/lobby state (GDD §2). Transport-agnostic and unit-testable:
 * it owns the player roster, host config (room name, 2-10 player limit, game
 * mode, bot fill) and the current phase. The server (index.js) wires this to
 * WebSocket transport; tests drive it directly.
 *
 * Host-authoritative: only the host may change config or start the match; the
 * server validates every intent before mutating state.
 */
import { PHASE } from '../src/shared/protocol.js';
import { DebugConfig } from '../src/shared/debugConfig.js';

export const GAME_MODES = ['Tournament', 'Free-For-All', 'Team Fight'];

let nextId = 1;

export class Room {
  /** @param {Object} [opts] @param {string} [opts.name] @param {number} [opts.playerLimit] */
  constructor({ name = "Gladiator's Ready Room", playerLimit = 4 } = {}) {
    this.config = {
      roomName: name,
      playerLimit: clampLimit(playerLimit),
      gameMode: GAME_MODES[0],
      botFill: true,
    };
    this.phase = PHASE.LOBBY;
    this.players = new Map(); // id -> {id, name, isHost, appearance, selectedMonsterId, gold}
    this.hostId = null;
  }

  get playerCount() { return this.players.size; }
  get isFull() { return this.players.size >= this.config.playerLimit; }

  /** Add a player. First to join becomes host. Returns the player or an error. */
  addPlayer({ name }) {
    if (this.isFull) return { error: 'room_full' };
    if (this.phase !== PHASE.LOBBY) return { error: 'match_in_progress' };
    const id = `p${nextId++}`;
    const isHost = this.players.size === 0;
    const player = {
      id, name: String(name || 'Trainer').slice(0, 24), isHost,
      appearance: { skinTone: 0xf1c9a5, tunicColor: 0xc0392b },
      selectedMonsterId: null,
      gold: DebugConfig.get('startingGoldAmount'),
    };
    this.players.set(id, player);
    if (isHost) this.hostId = id;
    return { player };
  }

  removePlayer(id) {
    const wasHost = this.hostId === id;
    this.players.delete(id);
    // Promote the next player to host if the host left.
    if (wasHost) {
      const next = this.players.values().next().value;
      this.hostId = next ? next.id : null;
      if (next) next.isHost = true;
    }
  }

  isHost(id) { return this.hostId === id; }

  setAppearance(id, patch) {
    const p = this.players.get(id);
    if (!p) return false;
    if (patch.skinTone != null) p.appearance.skinTone = patch.skinTone;
    if (patch.tunicColor != null) p.appearance.tunicColor = patch.tunicColor;
    return true;
  }

  selectMonster(id, monsterId) {
    const p = this.players.get(id);
    if (!p) return false;
    p.selectedMonsterId = monsterId;
    return true;
  }

  /** Host-only config change. Returns true if applied. */
  setConfig(id, patch) {
    if (!this.isHost(id)) return false;
    if (patch.roomName != null) this.config.roomName = String(patch.roomName).slice(0, 40);
    if (patch.playerLimit != null) this.config.playerLimit = clampLimit(patch.playerLimit);
    if (patch.gameMode != null && GAME_MODES.includes(patch.gameMode)) this.config.gameMode = patch.gameMode;
    if (patch.botFill != null) this.config.botFill = !!patch.botFill;
    return true;
  }

  /** Host-only. Requires the host to have a monster selected. */
  canStart(id) {
    if (!this.isHost(id)) return false;
    const host = this.players.get(id);
    return !!host?.selectedMonsterId && this.phase === PHASE.LOBBY;
  }

  startMatch(id) {
    if (!this.canStart(id)) return { error: 'cannot_start' };
    this.phase = PHASE.PREP;
    return { ok: true };
  }

  /** Serializable snapshot for broadcasting to clients + the room browser. */
  snapshot() {
    return {
      config: { ...this.config },
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, isHost: p.isHost,
        appearance: p.appearance, selectedMonsterId: p.selectedMonsterId,
      })),
    };
  }

  /** Compact entry for the room browser listing (GDD §2). */
  listing() {
    return {
      roomName: this.config.roomName,
      hostName: this.players.get(this.hostId)?.name ?? '—',
      players: this.playerCount,
      playerLimit: this.config.playerLimit,
      phase: this.phase,
    };
  }
}

function clampLimit(n) { return Math.max(2, Math.min(10, Math.round(Number(n) || 2))); }
