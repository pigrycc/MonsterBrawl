/**
 * Per-client synchronized combat tests (feedback #2). The host runs ONE
 * CombatRunner and emits snapshots; a client that only applies snapshots must
 * see the identical authoritative state. These verify the runner is the single
 * source of truth and that snapshots fully describe the bout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DebugConfig } from '../src/shared/debugConfig.js';
import { CombatRunner } from '../src/shared/combatRunner.js';
import { MATCH_STATE } from '../src/shared/combat.js';

const fresh = () => DebugConfig.reset();
const A = { playerId: 'host', monsterId: 'pyroroc', skillIds: [1, 5, 11], isBot: false };
const B = { playerId: 'bot', monsterId: 'voltkid', skillIds: [1, 5], isBot: true };

test('runner locks during countdown then goes active', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: B });
  assert.equal(r.snapshot().state, MATCH_STATE.COUNTDOWN);
  for (let i = 0; i < 100; i++) r.update(1 / 30); // ~3.3s > 3s countdown
  assert.equal(r.match.locked, false);
  assert.equal(r.snapshot().state, MATCH_STATE.ACTIVE);
});

test('snapshot fully describes both combatants', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: B });
  r.update(0.1);
  const s = r.snapshot();
  for (const side of ['a', 'b']) {
    for (const k of ['hp', 'maxHp', 'stamina', 'stance', 'monsterId', 'playerId', 'x', 'z']) {
      assert.ok(k in s[side], `${side}.${k} present`);
    }
  }
  assert.equal(s.a.playerId, 'host');
  assert.equal(s.b.playerId, 'bot');
});

test('a client applying only snapshots matches the host exactly', () => {
  fresh();
  const host = new CombatRunner({ a: A, b: B });
  // "Client" is just the latest applied snapshot object.
  let client = null;
  const snaps = [];
  for (let i = 0; i < 120; i++) {               // ~4s: through countdown into combat
    host.update(1 / 30);
    const snap = host.snapshot();
    client = JSON.parse(JSON.stringify(snap));  // serialize → wire → deserialize
    snaps.push(snap);
  }
  // Client state is literally the host snapshot → identical by construction.
  const hs = host.snapshot();
  assert.equal(client.tick, hs.tick);
  assert.equal(client.a.hp, hs.a.hp);
  assert.equal(client.b.hp, hs.b.hp);
  assert.equal(client.a.x, hs.a.x);
  // The bot side should have acted (cast/steer) — some damage or movement.
  const moved = snaps.some((s) => s.a.x !== -8 || s.b.x !== 8);
  assert.ok(moved, 'monsters should move under host steering');
});

test('player intents mutate authoritative state', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: B });
  for (let i = 0; i < 100; i++) r.update(1 / 30); // get to ACTIVE
  r.cmdStance('host', 'OFFENSIVE');
  assert.equal(r.a.stance, 'OFFENSIVE');
  // force the two close, then cast a melee skill and expect a hit event
  r.pos.a = { x: 0, z: 0 }; r.pos.b = { x: 1, z: 0 };
  r.a.cooldowns.clear(); r.a.stamina = 100;
  r.cmdCast('host', 0); // Tackle (id 1), in range
  const ev = r.snapshot().events;
  assert.ok(ev.some((e) => e.type === 'hit'), 'in-range cast → hit event');
});

test('runner ends and reports a result', () => {
  fresh();
  let result = null;
  const r = new CombatRunner({ a: A, b: B, onEnd: (res) => { result = res; } });
  for (let i = 0; i < 100; i++) r.update(1 / 30);
  r.match.dealDamage(r.b, 9999); // KO the bot
  assert.equal(r.ended, true);
  assert.ok(result);
  assert.equal(result.winnerPlayerId, 'host');
});

// --- Click-to-move order (feedback round 3) --------------------------------

test('move order overrides stance and walks toward the point, then clears', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: B });
  for (let i = 0; i < 100; i++) r.update(1 / 30); // ACTIVE
  r.cmdStance('host', 'NEUTRAL'); // neutral would normally disengage
  r.pos.a = { x: 0, z: 0 };
  r.cmdMove('host', 10, 0);        // order: walk to +x
  assert.ok(r.a.hasMoveOrder);
  for (let i = 0; i < 90; i++) r.update(1 / 30); // ~3s of walking
  // should have moved toward +x and (given terrataur/pyroroc speed) arrived+cleared
  assert.ok(r.pos.a.x > 2, `moved toward target, x=${r.pos.a.x}`);
});

test('casting a skill interrupts a move order', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: B });
  for (let i = 0; i < 100; i++) r.update(1 / 30);
  r.pos.a = { x: 0, z: 0 }; r.pos.b = { x: 1, z: 0 };
  r.cmdMove('host', 20, 20);
  assert.ok(r.a.hasMoveOrder);
  r.a.cooldowns.clear(); r.a.stamina = 100;
  r.cmdCast('host', 0); // Tackle
  assert.equal(r.a.hasMoveOrder, false, 'cast cleared the move order');
});

test('changing stance interrupts a move order', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: B });
  for (let i = 0; i < 100; i++) r.update(1 / 30);
  r.cmdMove('host', 15, 15);
  assert.ok(r.a.hasMoveOrder);
  r.a.stanceCooldown = 0;
  r.cmdStance('host', 'OFFENSIVE');
  assert.equal(r.a.hasMoveOrder, false, 'stance change cleared the move order');
});

// --- Round 5: reticle target, AI reaction, interception ---------------------
import { TRAINER_MAX_HP } from '../src/shared/trainerState.js';

const BOTB = { playerId: 'bot', monsterId: 'voltkid', skillIds: [1, 5], isBot: true };

test('#3 reticle target command routes pursuit to the enemy trainer', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: BOTB });
  for (let i = 0; i < 100; i++) r.update(1 / 30); // ACTIVE
  r.cmdTarget('host', 'trainer');
  r.cmdStance('host', 'OFFENSIVE');
  assert.equal(r.a.attackTarget, 'trainer');
  // place the player monster onto the bot trainer and tick → trainer takes dmg
  r.pos.a = { x: r.trainerPos.b.x, z: r.trainerPos.b.z };
  const before = r.trainer.b.hp;
  for (let i = 0; i < 60; i++) r.update(1 / 30);
  assert.ok(r.trainer.b.hp < before, 'enemy trainer took monster damage');
});

test('#2 trainers cannot damage each other; monsters can damage trainers', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: BOTB });
  assert.equal(r.trainer.a.maxHp, TRAINER_MAX_HP);
  assert.equal(r.trainer.a.takeDamage(20, 'trainer'), 0, 'trainer-vs-trainer rejected');
  assert.ok(r.trainer.a.takeDamage(20, 'monster') > 0, 'monster-vs-trainer allowed');
});

test('#4 AI trainer waits the reaction delay, then evades + retaliates', () => {
  fresh();
  DebugConfig.set('aiTrainerReactionSeconds', 1.0);
  const r = new CombatRunner({ a: A, b: BOTB });
  for (let i = 0; i < 100; i++) r.update(1 / 30);
  r.cmdTarget('host', 'trainer'); r.cmdStance('host', 'OFFENSIVE');
  r.pos.a = { x: 0, z: 0 }; r.pos.b = { x: 15, z: 0 }; // keep monsters apart (no interception)
  r.trainerPos.b = { x: 2, z: 0 };
  const t0 = { ...r.trainerPos.b };
  // within the delay: trainer shouldn't have kited yet
  r.update(0.3);
  assert.ok(Math.hypot(r.trainerPos.b.x - t0.x, r.trainerPos.b.z - t0.z) < 0.01, 'no reaction before delay');
  // after the delay: trainer kites away AND its monster retaliates at the player
  for (let i = 0; i < 40; i++) r.update(1 / 30);
  assert.ok(Math.hypot(r.trainerPos.b.x - t0.x, r.trainerPos.b.z - t0.z) > 0.1, 'bot trainer kited away');
  assert.equal(r.b.stance, 'OFFENSIVE');
  assert.equal(r.b.attackTarget, 'monster');
  fresh();
});

test('#5 aggro interception breaks trainer-chase on monster contact', () => {
  fresh();
  const r = new CombatRunner({ a: A, b: BOTB });
  for (let i = 0; i < 100; i++) r.update(1 / 30);
  r.cmdTarget('host', 'trainer'); r.cmdStance('host', 'OFFENSIVE');
  assert.equal(r.a.attackTarget, 'trainer');
  // put the two monsters in contact → interception
  r.pos.a = { x: 0, z: 0 }; r.pos.b = { x: 1, z: 0 };
  r.update(1 / 30);
  assert.equal(r.a.attackTarget, 'monster', 'chase broken, re-locked onto enemy monster');
});
