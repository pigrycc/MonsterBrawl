/**
 * Authoritative host server (GDD §2). Runs inside the host client's Electron
 * main process (or standalone via `npm run server`). Owns a Room and drives all
 * state; clients send intents over WebSocket and receive authoritative
 * snapshots. First connection becomes the host.
 *
 * Usage:
 *   node server/index.js [port] [roomName]
 *   import { startServer } from './server/index.js'  // programmatic (tests)
 */
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { C2S, C2S_COMBAT, S2C, PHASE, encode, decode, PROTOCOL_VERSION, DEFAULT_PORT } from '../src/shared/protocol.js';
import { CombatRunner } from '../src/shared/combatRunner.js';
import { freeSkills } from '../src/shared/skills.js';

/**
 * @param {Object} [opts]
 * @param {number} [opts.port]
 * @param {string} [opts.roomName]
 * @param {number} [opts.playerLimit]
 * @returns {{ wss: import('ws').WebSocketServer, room: Room, close: ()=>Promise<void> }}
 */
export function startServer({ port = DEFAULT_PORT, roomName, playerLimit } = {}) {
  const room = new Room({ name: roomName, playerLimit });
  const wss = new WebSocketServer({ port });
  /** @type {Map<string, import('ws').WebSocket>} playerId → socket */
  const sockets = new Map();

  const send = (ws, type, data) => { if (ws.readyState === ws.OPEN) ws.send(encode(type, data)); };
  const broadcast = (type, data) => { const msg = encode(type, data); for (const ws of sockets.values()) if (ws.readyState === ws.OPEN) ws.send(msg); };
  const broadcastRoom = () => broadcast(S2C.ROOM_STATE, room.snapshot());

  // --- #2 Authoritative combat loop -----------------------------------------
  let combat = null; // { runner, interval }
  const TICK_HZ = 30;

  function buildFighters() {
    const players = room.snapshot().players;
    const fallback = freeSkills().slice(0, 4).map((s) => s.id);
    const mk = (p) => ({
      playerId: p.id,
      monsterId: p.selectedMonsterId || 'pyroroc',
      skillIds: fallback, // networked skill drafting is a later refinement
      isBot: false,
    });
    let a, b;
    if (players.length >= 2) { a = mk(players[0]); b = mk(players[1]); }
    else if (players.length === 1) {
      a = mk(players[0]);
      b = { playerId: 'bot-host', monsterId: 'voltkid', skillIds: fallback, isBot: true };
    } else return null;
    return { a, b };
  }

  function startCombat() {
    stopCombat();
    const f = buildFighters();
    if (!f) return;
    const runner = new CombatRunner({
      a: f.a, b: f.b,
      onEnd: (result) => { broadcast(S2C.COMBAT_END, { result }); stopCombat(); room.phase = PHASE.LOBBY; broadcastRoom(); },
    });
    const dt = 1 / TICK_HZ;
    const interval = setInterval(() => {
      runner.update(dt);
      broadcast(S2C.COMBAT_SNAPSHOT, runner.snapshot());
    }, 1000 / TICK_HZ);
    if (interval.unref) interval.unref(); // don't keep the process alive in tests
    combat = { runner, interval };
  }

  function stopCombat() { if (combat) { clearInterval(combat.interval); combat = null; } }

  wss.on('connection', (ws) => {
    let playerId = null;

    ws.on('message', (raw) => {
      const msg = decode(raw.toString());
      if (!msg) return;
      const { type, data } = msg;

      // Must HELLO first.
      if (!playerId && type !== C2S.HELLO) { send(ws, S2C.ERROR, { reason: 'say_hello_first' }); return; }

      switch (type) {
        case C2S.HELLO: {
          if (data.version !== PROTOCOL_VERSION) { send(ws, S2C.ERROR, { reason: 'version_mismatch' }); ws.close(); return; }
          const res = room.addPlayer({ name: data.name });
          if (res.error) { send(ws, S2C.ERROR, { reason: res.error }); ws.close(); return; }
          playerId = res.player.id;
          sockets.set(playerId, ws);
          send(ws, S2C.WELCOME, { playerId, isHost: res.player.isHost, room: room.snapshot() });
          broadcast(S2C.PLAYER_JOINED, { player: { id: res.player.id, name: res.player.name, isHost: res.player.isHost } });
          broadcastRoom();
          break;
        }
        case C2S.SET_APPEARANCE: room.setAppearance(playerId, data) && broadcastRoom(); break;
        case C2S.SELECT_MONSTER: room.selectMonster(playerId, data.monsterId) && broadcastRoom(); break;
        case C2S.HOST_CONFIG:
          if (room.setConfig(playerId, data)) broadcastRoom();
          else send(ws, S2C.ERROR, { reason: 'not_host' });
          break;
        case C2S.START_MATCH: {
          const res = room.startMatch(playerId);
          if (res.error) { send(ws, S2C.ERROR, { reason: res.error }); break; }
          broadcast(S2C.PHASE, { phase: room.phase });
          broadcastRoom();
          startCombat(); // #2 host begins the authoritative bout
          break;
        }
        // #2 Combat intents relayed from clients to the authoritative runner.
        case C2S_COMBAT.STANCE: combat?.runner.cmdStance(playerId, data.stance); break;
        case C2S_COMBAT.CAST: combat?.runner.cmdCast(playerId, data.slot); break;
        case C2S_COMBAT.SHOVE: combat?.runner.cmdShove(playerId); break;
        case C2S.CHAT: broadcast(S2C.CHAT, { from: playerId, text: String(data.text || '').slice(0, 200) }); break;
        case C2S.PING: send(ws, S2C.PONG, { t: data.t }); break;
        default: send(ws, S2C.ERROR, { reason: 'unknown_message' });
      }
    });

    ws.on('close', () => {
      if (!playerId) return;
      sockets.delete(playerId);
      room.removePlayer(playerId);
      broadcast(S2C.PLAYER_LEFT, { playerId });
      broadcastRoom();
    });
  });

  const close = () => new Promise((resolve) => { stopCombat(); for (const ws of sockets.values()) ws.terminate(); wss.close(() => resolve()); });
  return { wss, room, close, getCombat: () => combat };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || DEFAULT_PORT;
  const roomName = process.argv[3];
  const { room } = startServer({ port, roomName });
  console.log(`[MCB] host server listening on ws://0.0.0.0:${port} — room "${room.config.roomName}"`);
}
