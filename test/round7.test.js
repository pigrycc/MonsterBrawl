/**
 * Headless tests for round 7 debug toggles + round-reset behavior:
 *   #2 staminaRegenMultiplier — scales passive + Neutral-stance regen live.
 *   #3 godModeEnabled         — infinite HP + stamina for a flagged combatant.
 *   #1 resetForRound()        — restores a combatant to a clean round start.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DebugConfig } from '../src/shared/debugConfig.js';
import { MonsterCombatant, STANCES } from '../src/shared/combat.js';
import { TrainerState } from '../src/shared/trainerState.js';

const fresh = () => DebugConfig.reset();

// --- #2 Stamina regen multiplier -------------------------------------------

test('staminaRegenMultiplier defaults to 1.0x and parses to 1', () => {
  fresh();
  assert.equal(DebugConfig.get('staminaRegenMultiplier'), '1.0x');
  assert.equal(DebugConfig.multiplier('staminaRegenMultiplier'), 1.0);
});

test('staminaRegenMultiplier scales Neutral-stance regen live', () => {
  fresh();
  const base = new MonsterCombatant({ playerId: 'b', monsterId: 'pyroroc' });
  const boosted = new MonsterCombatant({ playerId: 'x', monsterId: 'pyroroc' });
  base.spendStamina(50); boosted.spendStamina(50);
  // both start Neutral (rest regen)
  base.update(4);
  const gainBase = base.stamina - 50;

  DebugConfig.set('staminaRegenMultiplier', '3.0x');
  assert.equal(DebugConfig.multiplier('staminaRegenMultiplier'), 3.0);
  boosted.update(4);
  const gainBoost = boosted.stamina - 50;

  assert.ok(Math.abs(gainBoost - gainBase * 3) < 0.05,
    `3x regen (${gainBoost.toFixed(2)}) should be ~3x base (${gainBase.toFixed(2)})`);
});

test('staminaRegenMultiplier also scales combat-stance regen', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'c', monsterId: 'pyroroc' });
  c.commandStance(STANCES.OFFENSIVE); // combat regen (+1/4s)
  c.spendStamina(50);
  DebugConfig.set('staminaRegenMultiplier', '2.0x');
  const before = c.stamina;
  c.update(4);
  const gain = c.stamina - before;
  assert.ok(Math.abs(gain - 2) < 0.1, `2x of +1/4s over 4s ≈ +2 (got ${gain.toFixed(2)})`);
});

// --- #3 God mode ------------------------------------------------------------

test('godModeEnabled defaults to false', () => {
  fresh();
  assert.equal(DebugConfig.get('godModeEnabled'), false);
});

test('god-mode monster ignores all incoming damage and refills HP', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'g', monsterId: 'terrataur' });
  c.godMode = true;
  assert.equal(c.takeDamage(999, { isBasic: false }), 0, 'no damage dealt');
  assert.equal(c.hp, c.maxHp, 'HP stays full');
  assert.equal(c.alive, true);
});

test('god-mode monster never exhausts or stuns on stamina spend', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'g', monsterId: 'galebird' });
  c.godMode = true;
  c.spendStamina(c.maxStamina * 5);
  assert.equal(c.stamina, c.maxStamina, 'stamina refilled');
  assert.equal(c.isStunned, false, 'no 0-stamina stun');
});

test('god-mode monster ignores damage-over-time ticks', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'g', monsterId: 'pyroroc' });
  c.godMode = true;
  c.addDot(20, 3, 'Fire');
  c.update(1.0);
  assert.equal(c.hp, c.maxHp, 'DoT does not chip a god-mode monster');
});

test('a non-god monster still takes damage (toggle is isolated)', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'n', monsterId: 'terrataur' });
  const dealt = c.takeDamage(30, { isBasic: false });
  assert.ok(dealt > 0);
  assert.ok(c.hp < c.maxHp);
});

test('god-mode trainer ignores monster damage', () => {
  fresh();
  const t = new TrainerState('t');
  t.godMode = true;
  assert.equal(t.takeDamage(50, 'monster'), 0);
  assert.equal(t.hp, t.maxHp);
  assert.equal(t.alive, true);
});

// --- #1 Round reset ---------------------------------------------------------

test('resetForRound restores HP/stamina and clears transient combat state', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'terrataur', skillIds: [1, 2] });
  // beat it up: damage, spend stamina, apply effects, cooldowns, stance.
  c.takeDamage(50, { isBasic: false });
  c.spendStamina(40);
  c.commandStance(STANCES.OFFENSIVE);
  c.applyEffect('slow', 5);
  c.addDot(10, 5, 'Fire');
  c.applyShield('immune', 5);
  c.startCooldown(1);
  assert.ok(c.hp < c.maxHp);
  assert.ok(c.cooldowns.size > 0);

  c.resetForRound();

  assert.equal(c.hp, c.maxHp, 'HP restored');
  assert.equal(c.stamina, c.maxStamina, 'stamina restored');
  assert.equal(c.alive, true);
  assert.equal(c.stance, STANCES.NEUTRAL, 'stance reset to Neutral');
  assert.equal(c.stunTimer, 0);
  assert.equal(c.effects.size, 0, 'status effects cleared');
  assert.equal(c.dots.length, 0, 'DoTs cleared');
  assert.equal(c.shield, null, 'shield cleared');
  assert.equal(c.cooldowns.size, 0, 'skill charges replenished');
  assert.equal(c.attackTarget, 'monster');
});

test('resetForRound preserves identity and the godMode flag', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'voltkid', skillIds: [3] });
  c.godMode = true;
  c.resetForRound();
  assert.equal(c.playerId, 'p');
  assert.equal(c.monsterId, 'voltkid');
  assert.deepEqual(c.skillIds, [3]);
  assert.equal(c.godMode, true, 'god mode is not cleared by a round reset');
});

test('a KO\'d monster is revived to full by resetForRound', () => {
  fresh();
  const c = new MonsterCombatant({ playerId: 'p', monsterId: 'galebird' });
  c.takeDamage(c.maxHp + 50, { isBasic: false });
  assert.equal(c.alive, false);
  assert.equal(c.hp, 0);
  c.resetForRound();
  assert.equal(c.alive, true);
  assert.equal(c.hp, c.maxHp);
});
