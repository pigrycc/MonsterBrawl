/**
 * Network protocol (GDD §2). Host-authoritative client-server: the host runs
 * the authoritative server; clients send INTENT messages and receive STATE
 * snapshots + events. Messages are JSON over WebSocket.
 *
 * Shared by server/ and src/client/net/ so both ends agree on the wire format.
 */

export const PROTOCOL_VERSION = 1;

/** Client → Server */
export const C2S = {
  HELLO: 'hello',               // {name, version}
  SET_APPEARANCE: 'setAppearance', // {skinTone, tunicColor}
  SELECT_MONSTER: 'selectMonster', // {monsterId}
  HOST_CONFIG: 'hostConfig',    // host-only: {roomName?, playerLimit?, gameMode?, botFill?}
  START_MATCH: 'startMatch',    // host-only
  CHAT: 'chat',                 // {text}
  PING: 'ping',                 // {t}
};

/** Server → Client */
export const S2C = {
  WELCOME: 'welcome',           // {playerId, isHost, room}
  ROOM_STATE: 'roomState',      // full room snapshot {players, config, phase}
  PLAYER_JOINED: 'playerJoined',
  PLAYER_LEFT: 'playerLeft',
  PHASE: 'phase',               // {phase, payload}
  ERROR: 'error',               // {reason}
  PONG: 'pong',                 // {t}
  CHAT: 'chat',                 // {from, text}
  // #2 Per-client synchronized combat: the host streams authoritative bout
  // state; non-host clients render these snapshots instead of simulating.
  COMBAT_SNAPSHOT: 'combatSnapshot', // {tick, clock, state, a:{...}, b:{...}, events:[]}
  COMBAT_END: 'combatEnd',           // {result}
};

/** Client → Host: intents the local trainer issues during a synced bout. */
export const C2S_COMBAT = {
  STANCE: 'combatStance',       // {stance}
  CAST: 'combatCast',           // {slot}
  SHOVE: 'combatShove',         // {}
};

/** Lobby/room phases the server advances through. */
export const PHASE = { LOBBY: 'LOBBY', PREP: 'PREP', ARENA: 'ARENA' };

export const DEFAULT_PORT = 7777;

/** Encode/decode helpers (kept trivial but centralized for future binary swap). */
export function encode(type, data = {}) {
  return JSON.stringify({ t: type, d: data });
}
export function decode(raw) {
  try { const m = JSON.parse(raw); return { type: m.t, data: m.d ?? {} }; }
  catch { return null; }
}
