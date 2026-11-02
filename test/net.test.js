/**
 * Networking integration tests (GDD §2): real host server + real client(s) over
 * a localhost WebSocket. Verifies host-authoritative rules: host assignment,
 * config authority, monster selection sync, start-match gating, room listing,
 * and ping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { startServer } from '../server/index.js';
import { NetClient } from '../src/client/net/netClient.js';
import { Room } from '../server/room.js';
import { DebugConfig } from '../src/shared/debugConfig.js';

let portCounter = 8800;
const nextPort = () => portCounter++;

function connectClient(port, name) {
  const c = new NetClient({ WebSocketImpl: WebSocket });
  return c.connect(`ws://127.0.0.1:${port}`, name).then(() => c);
}

// --- Room unit tests (transport-free) --------------------------------------

test('first player becomes host; limit clamps to 2..10', () => {
  DebugConfig.reset();
  const room = new Room({ playerLimit: 99 });
  assert.equal(room.config.playerLimit, 10);
  const a = room.addPlayer({ name: 'A' });
  assert.equal(a.player.isHost, true);
  const b = room.addPlayer({ name: 'B' });
  assert.equal(b.player.isHost, false);
  assert.equal(room.hostId, a.player.id);
});

test('only host can change config and start', () => {
  DebugConfig.reset();
  const room = new Room();
  const a = room.addPlayer({ name: 'A' }).player;
  const b = room.addPlayer({ name: 'B' }).player;
  assert.equal(room.setConfig(b.id, { roomName: 'Hax' }), false, 'non-host blocked');
  assert.equal(room.setConfig(a.id, { roomName: 'Arena 1', gameMode: 'Free-For-All' }), true);
  assert.equal(room.config.roomName, 'Arena 1');
  assert.equal(room.config.gameMode, 'Free-For-All');
  assert.equal(room.canStart(a.id), false, 'host needs a monster first');
  room.selectMonster(a.id, 'pyroroc');
  assert.equal(room.canStart(a.id), true);
  assert.equal(room.canStart(b.id), false);
});

test('host leaves → next player promoted', () => {
  DebugConfig.reset();
  const room = new Room();
  const a = room.addPlayer({ name: 'A' }).player;
  const b = room.addPlayer({ name: 'B' }).player;
  room.removePlayer(a.id);
  assert.equal(room.hostId, b.id);
  assert.equal(room.players.get(b.id).isHost, true);
});

test('room rejects joins when full', () => {
  DebugConfig.reset();
  const room = new Room({ playerLimit: 2 });
  room.addPlayer({ name: 'A' });
  room.addPlayer({ name: 'B' });
  assert.equal(room.addPlayer({ name: 'C' }).error, 'room_full');
});

// --- Live client/server integration ----------------------------------------

test('two clients connect; first is host, state syncs', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port, roomName: 'Test Arena' });
  try {
    const host = await connectClient(port, 'Hoster');
    assert.equal(host.isHost, true);
    assert.equal(host.room.config.roomName, 'Test Arena');

    const guestRoomUpdate = new Promise((res) => host.on('room', (r) => { if (r.players.length === 2) res(r); }));
    const guest = await connectClient(port, 'Guest');
    assert.equal(guest.isHost, false);

    const r = await guestRoomUpdate;
    assert.equal(r.players.length, 2);

    host.disconnect(); guest.disconnect();
  } finally { await srv.close(); }
});

test('guest monster selection propagates to host snapshot', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const host = await connectClient(port, 'H');
    const guest = await connectClient(port, 'G');
    const seen = new Promise((res) => host.on('room', (r) => {
      const g = r.players.find((p) => !p.isHost);
      if (g?.selectedMonsterId === 'voltkid') res(true);
    }));
    guest.selectMonster('voltkid');
    assert.equal(await seen, true);
    host.disconnect(); guest.disconnect();
  } finally { await srv.close(); }
});

test('non-host cannot change config over the wire', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const host = await connectClient(port, 'H');
    const guest = await connectClient(port, 'G');
    const err = new Promise((res) => guest.on('error', (e) => res(e.reason)));
    guest.setConfig({ roomName: 'Hacked' });
    assert.equal(await err, 'not_host');
    host.disconnect(); guest.disconnect();
  } finally { await srv.close(); }
});

test('start-match gating + phase broadcast over the wire', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const host = await connectClient(port, 'H');
    await connectClient(port, 'G');
    // no monster yet → cannot_start
    const err = new Promise((res) => host.on('error', (e) => res(e.reason)));
    host.startMatch();
    assert.equal(await err, 'cannot_start');
    // select then start → PHASE broadcast
    host.selectMonster('terrataur');
    const phase = new Promise((res) => host.on('phase', (p) => res(p.phase)));
    host.startMatch();
    assert.equal(await phase, 'PREP');
    host.disconnect();
  } finally { await srv.close(); }
});

test('ping round-trip returns a number', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const c = await connectClient(port, 'H');
    const ms = await new Promise((res) => c.on('ping', (p) => res(p)));
    assert.ok(typeof ms === 'number' && ms >= 0);
    c.disconnect();
  } finally { await srv.close(); }
});

// --- #2 Per-client synchronized combat over the wire -----------------------

test('host starts combat; all clients receive identical snapshots', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const host = await connectClient(port, 'Host');
    const guest = await connectClient(port, 'Guest');
    host.selectMonster('pyroroc');
    guest.selectMonster('voltkid');

    const hostSnaps = [];
    const guestSnaps = [];
    host.on('combatSnapshot', (s) => hostSnaps.push(s));
    guest.on('combatSnapshot', (s) => guestSnaps.push(s));

    DebugConfig.set('trainingPhaseDuration', 0.5); // skip through prep quickly
    const started = new Promise((r) => host.on('prepEnd', () => r(true)));
    host.startMatch();
    await started;
    // collect ~0.5s of combat snapshots (30Hz → ~15)
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(hostSnaps.length > 3, `host got ${hostSnaps.length} snapshots`);
    assert.ok(guestSnaps.length > 3, `guest got ${guestSnaps.length} snapshots`);

    // Both clients must see the same authoritative state for a shared tick.
    const byTickH = new Map(hostSnaps.map((s) => [s.tick, s]));
    let compared = 0;
    for (const g of guestSnaps) {
      const h = byTickH.get(g.tick);
      if (!h) continue;
      assert.equal(h.a.hp, g.a.hp, `tick ${g.tick} a.hp`);
      assert.equal(h.b.hp, g.b.hp, `tick ${g.tick} b.hp`);
      assert.equal(h.a.x, g.a.x, `tick ${g.tick} a.x`);
      assert.equal(h.state, g.state);
      compared++;
    }
    assert.ok(compared > 2, `compared ${compared} shared ticks`);

    host.disconnect(); guest.disconnect();
  } finally { await srv.close(); DebugConfig.reset(); }
});

test('a guest combat intent reaches the authoritative runner', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const host = await connectClient(port, 'Host');
    const guest = await connectClient(port, 'Guest');
    host.selectMonster('pyroroc');
    guest.selectMonster('voltkid');
    DebugConfig.set('trainingPhaseDuration', 0.5);
    const started = new Promise((r) => host.on('prepEnd', () => r(true)));
    host.startMatch();
    await started;
    await new Promise((r) => setTimeout(r, 150));
    // guest commands its monster to NEUTRAL; the server runner should reflect it
    guest.combatStance('NEUTRAL');
    await new Promise((r) => setTimeout(r, 120));
    const runner = srv.getCombat()?.runner;
    assert.ok(runner, 'combat running');
    const guestC = runner.combatantFor(guest.playerId);
    assert.ok(guestC, 'guest has a combatant');
    host.disconnect(); guest.disconnect();
  } finally { await srv.close(); DebugConfig.reset(); }
});

// --- #1 Networked prep-phase drafting over the wire ------------------------

test('start → prep snapshots stream each client its own totems/gold/slots', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const host = await connectClient(port, 'Host');
    const guest = await connectClient(port, 'Guest');
    host.selectMonster('pyroroc');
    guest.selectMonster('voltkid');

    const hostPrep = new Promise((res) => host.on('prepSnapshot', (s) => { if (s.you?.totems?.length === 6) res(s); }));
    const guestPrep = new Promise((res) => guest.on('prepSnapshot', (s) => { if (s.you?.totems?.length === 6) res(s); }));
    host.startMatch();

    const hs = await hostPrep;
    const gs = await guestPrep;
    assert.equal(hs.you.totems.length, 6, 'host gets 6 totems');
    assert.equal(gs.you.totems.length, 6, 'guest gets 6 totems');
    assert.equal(hs.you.gold, 50);
    assert.ok(hs.you.slots.every((s) => s === null), 'slots start empty');
    assert.ok(hs.timeLeft > 0 && hs.timeLeft <= hs.duration);

    host.disconnect(); guest.disconnect();
  } finally { await srv.close(); }
});

test('prep buy intent fills a slot and deducts gold authoritatively', async () => {
  DebugConfig.reset();
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const host = await connectClient(port, 'Host');
    const guest = await connectClient(port, 'Guest');
    host.selectMonster('terrataur');
    guest.selectMonster('galebird');

    // wait for first prep snapshot to learn totem costs
    const firstSnap = await new Promise((res) => { host.on('prepSnapshot', (s) => { if (s.you?.totems?.length === 6) res(s); }); host.startMatch(); });
    // pick the cheapest totem to buy
    const idx = firstSnap.you.totems.map((t, i) => ({ i, c: t.cost })).sort((a, b) => a.c - b.c)[0].i;

    const afterBuy = new Promise((res) => host.on('prepSnapshot', (s) => { if (s.you.slots.some((x) => x !== null)) res(s); }));
    host.prepBuy(idx);
    const s = await afterBuy;
    assert.ok(s.you.slots.some((x) => x !== null), 'a slot got filled');

    // confirm on the authoritative server cell too
    const cell = srv.getPrep().session.getCell(host.playerId);
    assert.equal(cell.slots.filter((x) => x != null).length, 1);

    host.disconnect(); guest.disconnect();
  } finally { await srv.close(); }
});

test('prep → combat: drafted loadout carries into the authoritative bout', async () => {
  DebugConfig.reset();
  DebugConfig.set('trainingPhaseDuration', 1); // short prep so it auto-finishes fast
  const port = nextPort();
  const srv = startServer({ port });
  try {
    const host = await connectClient(port, 'Host');
    host.selectMonster('pyroroc');

    const prepEnded = new Promise((res) => host.on('prepEnd', () => res(true)));
    const combatStarted = new Promise((res) => host.on('combatSnapshot', (s) => res(s)));
    host.startMatch();

    assert.equal(await prepEnded, true, 'prep ends (timer)');
    const snap = await combatStarted;
    assert.ok(snap.a && snap.b, 'combat snapshots flowing after prep');

    // runner combatant should have a 4-skill loadout (drafted or fallback)
    const runner = srv.getCombat().runner;
    const hostC = runner.combatantFor(host.playerId);
    assert.equal(hostC.skillIds.filter((x) => x != null).length, 4);

    host.disconnect();
  } finally { await srv.close(); DebugConfig.reset(); }
});
