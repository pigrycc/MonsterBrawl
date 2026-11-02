/**
 * Spectator throwables effect tests (GDD §6).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DebugConfig } from '../src/shared/debugConfig.js';
import { MonsterCombatant } from '../src/shared/combat.js';
import { THROWABLES, applyThrowable, STONE_STUN, TOMATO_CONFUSE, randomThrowable } from '../src/shared/throwables.js';

const fresh = () => DebugConfig.reset();

test('stone stuns a monster for 1.5s and counts as a stun', () => {
  fresh();
  const m = new MonsterCombatant({ playerId: 'p', monsterId: 'pyroroc' });
  const r = applyThrowable(THROWABLES.STONE, m, { isMonster: true });
  assert.equal(r.effect, 'stun');
  assert.equal(r.durationSec, STONE_STUN);
  assert.equal(m.isStunned, true);
  assert.equal(m.stunCount, 1);
  m.update(STONE_STUN + 0.01);
  assert.equal(m.isStunned, false);
});

test('rotten tomato confuses a monster for 5s', () => {
  fresh();
  const m = new MonsterCombatant({ playerId: 'p', monsterId: 'voltkid' });
  const r = applyThrowable(THROWABLES.ROTTEN_TOMATO, m, { isMonster: true });
  assert.equal(r.effect, 'confuse');
  assert.equal(r.durationSec, TOMATO_CONFUSE);
  assert.equal(m.isConfused, true);
  m.update(TOMATO_CONFUSE + 0.01);
  assert.equal(m.isConfused, false);
});

test('rotten tomato on a trainer blinds (via sink callback)', () => {
  fresh();
  let blinded = 0;
  const trainer = { applyBlind: (s) => { blinded = s; } };
  const r = applyThrowable(THROWABLES.ROTTEN_TOMATO, trainer, { isMonster: false });
  assert.equal(r.effect, 'blind');
  assert.equal(blinded, 5);
});

test('speed draft boosts a monster’s stamina', () => {
  fresh();
  const m = new MonsterCombatant({ playerId: 'p', monsterId: 'galebird' });
  m.spendStamina(60);
  const before = m.stamina;
  applyThrowable(THROWABLES.SPEED_DRAFT, m, { isMonster: true });
  assert.ok(m.stamina > before);
});

test('randomThrowable only returns known kinds', () => {
  fresh();
  const seq = [0.1, 0.5, 0.9, 0.0, 0.99];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  for (let n = 0; n < 20; n++) {
    assert.ok(Object.values(THROWABLES).includes(randomThrowable(rng)));
  }
});

test('confused monster still updates/clears while stunned independently', () => {
  fresh();
  const m = new MonsterCombatant({ playerId: 'p', monsterId: 'terrataur' });
  applyThrowable(THROWABLES.ROTTEN_TOMATO, m, { isMonster: true });
  applyThrowable(THROWABLES.STONE, m, { isMonster: true });
  assert.equal(m.isConfused, true);
  assert.equal(m.isStunned, true);
  m.update(1.5);
  assert.equal(m.isStunned, false);
  assert.equal(m.isConfused, true); // confuse (5s) outlasts stun (1.5s)
});
