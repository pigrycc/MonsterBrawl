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
import { C2S, C2S_COMBAT, C2S_PREP, C2S_VOICE, S2C, PHASE, encode, decode, PROTOCOL_VERSION, DEFAULT_PORT } from '../src/shared/protocol.js';
import { CombatRunner } from '../src/shared/combatRunner.js';
import { PrepSession } from '../src/shared/prepSession.js';
import { botDraft } from '../src/shared/bot.js';
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

  // --- Authoritative prep + combat loops ------------------------------------
  let combat = null; // { runner, interval }
  let prep = null;   // { session, interval, meta, loadouts }
  const TICK_HZ = 30;
  const fallbackSkills = () => freeSkills().slice(0, 4).map((s) => s.id);

  /** Who's in the bout (first two players; bot fills a 1-player room). */
  function fighterMeta() {
    const players = room.snapshot().players;
    const mk = (p) => ({ playerId: p.id, monsterId: p.selectedMonsterId || 'pyroroc', isBot: false });
    if (players.length >= 2) return [mk(players[0]), mk(players[1])];
    if (players.length === 1) return [mk(players[0]), { playerId: 'bot-host', monsterId: 'voltkid', isBot: true }];
    return null;
  }

  // --- #1 Networked prep-phase drafting -------------------------------------
  function startPrep() {
    stopPrep();
    const meta = fighterMeta();
    if (!meta) return;
    room.phase = PHASE.PREP;
    const session = new PrepSession({
      fighters: meta.map((m, i) => ({ playerId: m.playerId, monsterId: m.monsterId, seed: (Date.now() + i) & 0xffff })),
      onComplete: () => finishPrep(),
    });
    // Bots auto-draft immediately (GDD §8).
    for (const m of meta) if (m.isBot) botDraft(session.getCell(m.playerId));

    prep = { session, meta, interval: null };
    const dt = 1 / TICK_HZ;
    prep.interval = setInterval(() => {
      session.update(dt);
      broadcastPrep();
    }, 1000 / TICK_HZ);
    if (prep.interval.unref) prep.interval.unref();
    broadcast(S2C.PHASE, { phase: PHASE.PREP });
    broadcastPrep();
  }

  /** Per-player prep snapshot: a client only sees its OWN totems/gold/slots. */
  function broadcastPrep() {
    if (!prep) return;
    const { session } = prep;
    const ready = {};
    for (const [pid, cell] of session.cells) ready[pid] = cell.isReady;
    for (const [pid, ws] of sockets) {
      const cell = session.getCell(pid);
      if (!cell) continue; // spectators / non-fighters
      send(ws, S2C.PREP_SNAPSHOT, {
        timeLeft: +session.timeLeft.toFixed(2),
        duration: session.duration,
        ready,
        you: {
          gold: cell.gold,
          slots: cell.slots.slice(),
          totems: cell.totems.map((t) => ({ id: t.skill.id, name: t.skill.name, cost: cell.costOf(t.skill), element: t.skill.element, purchased: t.purchased })),
        },
      });
    }
  }

  function finishPrep() {
    if (!prep) return;
    // Resolve each fighter's loadout (drafted, or free basics if they idled).
    const loadouts = {};
    for (const m of prep.meta) {
      const cell = prep.session.getCell(m.playerId);
      const drafted = cell ? cell.slots.filter((s) => s != null) : [];
      loadouts[m.playerId] = drafted.length ? drafted : fallbackSkills();
    }
    const meta = prep.meta;
    stopPrep();
    broadcast(S2C.PREP_END, {});
    startCombat(meta, loadouts);
  }

  function stopPrep() { if (prep) { clearInterval(prep.interval); prep = null; } }

  // --- #2 Authoritative combat loop -----------------------------------------
  function startCombat(meta, loadouts) {
    stopCombat();
    if (!meta) { meta = fighterMeta(); loadouts = null; }
    if (!meta) return;
    const f = {
      a: { ...meta[0], skillIds: loadouts?.[meta[0].playerId] || fallbackSkills() },
      b: { ...meta[1], skillIds: loadouts?.[meta[1].playerId] || fallbackSkills() },
    };
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
          broadcastRoom();
          startPrep(); // #1 host begins the authoritative prep phase (drafting)
          break;
        }
        // #1 Prep-phase intents.
        case C2S_PREP.BUY: {
          const cell = prep?.session.getCell(playerId);
          if (cell) { cell.purchase(data.totemIndex); broadcastPrep(); }
          break;
        }
        case C2S_PREP.READY: break; // readiness is implied by 4 filled slots
        // #2 Combat intents relayed from clients to the authoritative runner.
        case C2S_COMBAT.STANCE: combat?.runner.cmdStance(playerId, data.stance); break;
        case C2S_COMBAT.CAST: combat?.runner.cmdCast(playerId, data.slot); break;
        case C2S_COMBAT.SHOVE: combat?.runner.cmdShove(playerId); break;
        case C2S_COMBAT.MOVE: combat?.runner.cmdMove(playerId, data.x, data.z); break;
        // #3 Proximity voice signaling relay (host forwards SDP/ICE to the peer).
        case C2S_VOICE.SIGNAL: {
          const target = sockets.get(data.to);
          if (target) send(target, S2C.VOICE_SIGNAL, { from: playerId, to: data.to, signal: data.signal });
          break;
        }
        case C2S_VOICE.SPEAKING: broadcast(S2C.VOICE_SPEAKING, { playerId, speaking: !!data.speaking }); break;
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

  const close = () => new Promise((resolve) => { stopPrep(); stopCombat(); for (const ws of sockets.values()) ws.terminate(); wss.close(() => resolve()); });
  return { wss, room, close, getCombat: () => combat, getPrep: () => prep };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || DEFAULT_PORT;
  const roomName = process.argv[3];
  const { room } = startServer({ port, roomName });
  console.log(`[MCB] host server listening on ws://0.0.0.0:${port} — room "${room.config.roomName}"`);
}
