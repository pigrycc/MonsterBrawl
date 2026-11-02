/**
 * Headless tests for the authoritative combat core (GDD §5): stance delay,
 * stamina/stun, defensive mitigation, cooldowns, match clock + Sudden Death,
 * and reward resolution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DebugConfig } from '../src/shared/debugConfig.js';
import {
  MonsterCombatant, CombatMatch, STANCES, MATCH_STATE,
  STANCE_COOLDOWN, STUN_DURATION, LOW_STAMINA_SLOW, DEFENSIVE_SKILL_MULT,
} from '../src/shared/combat.js';
import { getSkillById } from '../src/shared/skills.js';

const fresh = () => DebugConfig.reset();

test('combatant initializes from monster def', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'terrataur' });
  assert.equal(c.hp, 180);
  assert.equal(c.maxStamina, 100);
  assert.equal(c.stance, STANCES.NEUTRAL);
  assert.equal(c.alive, true);
});

test('stance switches INSTANTLY, then locks out for the cooldown (#2)', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'voltkid' });
  assert.equal(c.commandStance(STANCES.OFFENSIVE), true);
  assert.equal(c.stance, STANCES.OFFENSIVE, 'applied immediately');
  assert.ok(Math.abs(c.stanceCooldownRemaining - STANCE_COOLDOWN) < 1e-6);
  // cannot switch again while on cooldown
  assert.equal(c.commandStance(STANCES.DEFENSIVE), false, 'blocked during cooldown');
  assert.equal(c.stance, STANCES.OFFENSIVE);
  c.update(STANCE_COOLDOWN + 0.01);
  assert.equal(c.stanceCooldownRemaining, 0);
  assert.equal(c.commandStance(STANCES.DEFENSIVE), true, 'switchable after cooldown');
  assert.equal(c.stance, STANCES.DEFENSIVE);
});

test('defensive stance grants one basic-attack negation charge', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'pyroroc' });
  c.commandStance(STANCES.DEFENSIVE);
  assert.equal(c.stance, STANCES.DEFENSIVE);
  assert.equal(c.guardBasicCharges, 1);
  // First basic fully negated
  assert.equal(c.takeDamage(20, { isBasic: true }), 0);
  assert.equal(c.hp, c.maxHp);
  // Second basic lands (no charges left)
  const dealt = c.takeDamage(20, { isBasic: true });
  assert.ok(dealt > 0);
});

test('defensive stance halves skill damage (GDD §5B)', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'terrataur' });
  c.commandStance(STANCES.DEFENSIVE); // instant now
  const dealt = c.takeDamage(40, { isBasic: false });
  assert.equal(dealt, Math.round(40 * DEFENSIVE_SKILL_MULT));
  assert.equal(dealt, 20);
});

test('stamina depletion to 0 triggers a 3.0s stun + increments stun count', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'galebird' });
  c.spendStamina(c.maxStamina);
  assert.equal(c.stamina, 0);
  assert.equal(c.isStunned, true);
  assert.equal(c.stunCount, 1);
  assert.ok(Math.abs(c.stunTimer - STUN_DURATION) < 1e-6);
  assert.equal(c.effectiveSpeed, 0, 'no movement while stunned');
  c.update(STUN_DURATION + 0.01);
  assert.equal(c.isStunned, false);
});

test('below 50% stamina slows the monster to 0.7x (GDD §5B)', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'voltkid' });
  assert.equal(c.effectiveSpeed, c.baseSpeed, 'full speed at full stamina');
  c.spendStamina(60); // 40/100 < 50%
  assert.ok(Math.abs(c.effectiveSpeed - c.baseSpeed * LOW_STAMINA_SLOW) < 1e-6);
});

test('rest/neutral regenerates stamina twice as fast as combat stances', () => {
  fresh();
  const neutral = new MonsterCombatant({ playerId: 'n', monsterId: 'pyroroc' });
  const off = new MonsterCombatant({ playerId: 'o', monsterId: 'pyroroc' });
  neutral.spendStamina(50); off.spendStamina(50);
  off.commandStance(STANCES.OFFENSIVE); // instant
  const s0n = neutral.stamina, s0o = off.stamina;
  neutral.update(4); off.update(4);
  const gainN = neutral.stamina - s0n;
  const gainO = off.stamina - s0o;
  assert.ok(gainN > gainO, `neutral regen ${gainN} should exceed combat ${gainO}`);
  assert.ok(Math.abs(gainN - 2) < 0.2, 'neutral ~+2 over 4s (+1/2s)');
  assert.ok(Math.abs(gainO - 1) < 0.2, 'combat ~+1 over 4s (+1/4s)');
});

test('skill cooldown blocks recast until it expires', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'pyroroc', skillIds: [1] });
  assert.equal(c.canCast(1), true);
  c.startCooldown(1);
  assert.equal(c.canCast(1), false);
  const cd = getSkillById(1).cooldown;
  c.update(cd + 0.01);
  assert.equal(c.canCast(1), true);
});

test('cannot cast without enough stamina', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'aquaslug', skillIds: [14] }); // Hydro_Pump stamina 40
  c.spendStamina(c.maxStamina - 10); // 10 left < 40
  assert.equal(c.canCast(14), false);
});

// --- Match orchestration ---------------------------------------------------

test('match is locked during the 3-2-1 countdown (GDD §5A)', () => {
  fresh();
  const a = new MonsterCombatant({ playerId: 'a', monsterId: 'pyroroc' });
  const b = new MonsterCombatant({ playerId: 'b', monsterId: 'voltkid' });
  const m = new CombatMatch({ a, b, countdown: 3, clock: 180 });
  assert.equal(m.state, MATCH_STATE.COUNTDOWN);
  assert.equal(m.locked, true);
  assert.equal(m.dealDamage(b, 50), 0, 'no damage during lock');
  m.update(3.01);
  assert.equal(m.state, MATCH_STATE.ACTIVE);
  assert.equal(m.locked, false);
});

test('KO ends the match with correct winner + rewards (GDD §5D)', () => {
  fresh();
  let result = null;
  const a = new MonsterCombatant({ playerId: 'a', monsterId: 'pyroroc' });
  const b = new MonsterCombatant({ playerId: 'b', monsterId: 'galebird' });
  const m = new CombatMatch({ a, b, countdown: 0, clock: 180, onEnd: (r) => { result = r; } });
  m.update(0.01); // leave countdown
  m.dealDamage(b, b.maxHp + 5);
  assert.equal(m.state, MATCH_STATE.ENDED);
  assert.equal(result.winnerPlayerId, 'a');
  assert.equal(result.loserPlayerId, 'b');
  assert.equal(result.reason, 'ko');
  assert.equal(result.winReward, 30);
  assert.equal(result.loseReward, 20);
});

test('clock expiry enters Sudden Death; next damage ends the match (GDD §5A)', () => {
  fresh();
  let result = null;
  const a = new MonsterCombatant({ playerId: 'a', monsterId: 'terrataur' });
  const b = new MonsterCombatant({ playerId: 'b', monsterId: 'terrataur' });
  const m = new CombatMatch({ a, b, countdown: 0, clock: 5, onEnd: (r) => { result = r; } });
  m.update(0.01);
  m.update(5.5); // clock expires
  assert.equal(m.state, MATCH_STATE.SUDDEN_DEATH);
  assert.equal(result, null, 'not ended yet');
  const dealt = m.dealDamage(a, 1); // a single point ends it
  assert.ok(dealt > 0);
  assert.equal(m.state, MATCH_STATE.ENDED);
  assert.equal(result.reason, 'sudden_death');
  assert.equal(result.winnerPlayerId, 'b', 'the one who took damage loses');
});

test('bout duration + stun counts are reported for betting resolution', () => {
  fresh();
  let result = null;
  const a = new MonsterCombatant({ playerId: 'a', monsterId: 'pyroroc' });
  const b = new MonsterCombatant({ playerId: 'b', monsterId: 'voltkid' });
  const m = new CombatMatch({ a, b, countdown: 0, clock: 180, onEnd: (r) => { result = r; } });
  m.update(0.01);
  b.spendStamina(100); b.update(STUN_DURATION + 0.1); // one stun
  m.update(12.3);
  m.dealDamage(b, b.maxHp);
  assert.ok(result.boutDurationSec >= 12);
  assert.equal(result.stunCountsByMonsterId['voltkid'], 1);
});

// --- Feedback round 1 (#8): debug multipliers --------------------------------

test('Monster HP multiplier scales max + current HP (#8)', () => {
  fresh();
  const base = new MonsterCombatant({ playerId: 'p', monsterId: 'terrataur' });
  assert.equal(base.maxHp, 180);
  DebugConfig.set('monsterHpMultiplier', '3x');
  const buffed = new MonsterCombatant({ playerId: 'p', monsterId: 'terrataur' });
  assert.equal(buffed.maxHp, 540);
  assert.equal(buffed.hp, 540);
  fresh();
});

test('Skill Cooldown multiplier scales cooldown duration (#8)', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'pyroroc', skillIds: [1] });
  const baseCd = getSkillById(1).cooldown; // 4.0
  DebugConfig.set('skillCooldownMultiplier', '5x');
  c.startCooldown(1);
  assert.ok(Math.abs(c.cooldowns.get(1) - baseCd * 5) < 1e-6);
  fresh();
});
