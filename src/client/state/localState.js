/**
 * Local client/lobby state. For now this is the single source of truth driven
 * entirely by local play; it is deliberately the SEAM where the authoritative
 * host (GDD §2) will plug in. When networking lands, the host owns this state
 * and pushes snapshots; the UI already reads from here, so the swap is small.
 */
import { DebugConfig } from '../../shared/debugConfig.js';
import { MONSTERS } from '../../shared/monsters.js';
import { SKIN_TONES, TUNIC_COLORS } from '../models/trainer.js';

let listeners = new Set();
function emit() { for (const fn of listeners) fn(state); }

export const GAME_MODES = ['Tournament', 'Free-For-All', 'Team Fight'];

export const state = {
  // --- local player ---
  localPlayerId: 'local',
  appearance: { skinTone: SKIN_TONES[0], tunicColor: TUNIC_COLORS[0], name: 'You' },
  selectedMonsterId: null,       // bound via pedestal [E]
  gold: DebugConfig.get('startingGoldAmount'),

  // --- lobby / host setup (host-authoritative later) ---
  isHost: true,                  // local prototype: you host
  roomName: "Gladiator's Ready Room",
  playerLimit: 4,
  gameMode: GAME_MODES[0],
  botFill: true,

  // --- roster of trainers present in the lobby (local + bots/others) ---
  players: [],                   // {id, name, appearance, selectedMonsterId, isBot}
};

export const LocalState = {
  get: () => state,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  setAppearance(patch) { Object.assign(state.appearance, patch); emit(); },
  selectMonster(id) { state.selectedMonsterId = id; emit(); },
  setGold(n) { state.gold = n; emit(); },

  // host-setup mutators (host-only in networked build)
  setRoomName(v) { state.roomName = v; emit(); },
  setPlayerLimit(n) { state.playerLimit = Math.max(2, Math.min(10, n | 0)); emit(); },
  setGameMode(m) { if (GAME_MODES.includes(m)) { state.gameMode = m; emit(); } },
  setBotFill(v) { state.botFill = !!v; emit(); },

  /** Whether the local player can start the match (host + a monster chosen). */
  canStartMatch() { return state.isHost && !!state.selectedMonsterId; },
};

// Convenience: default monster list for pedestals.
export const PEDESTAL_MONSTERS = MONSTERS;
