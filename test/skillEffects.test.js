/**
 * Skill effect engine tests — one representative per archetype (see
 * docs/SKILL_EFFECTS.md). Verifies the distinct mechanics actually happen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DebugConfig } from '../src/shared/debugConfig.js';
import { MonsterCombatant } from '../src/shared/combat.js';
import { resolveSkill, SKILL_ARCHETYPE } from '../src/shared/skillEffects.js';
import { getSkillByKey, SKILLS } from '../src/shared/skills.js';

const fresh = () => DebugConfig.reset();
const pair = () => [
  new MonsterCombatant({ playerId: 'a', monsterId: 'pyroroc', skillIds: [] }),
  new MonsterCombatant({ playerId: 'b', monsterId: 'terrataur', skillIds: [] }),
];
const cast = (key, caster, foe, distance) => resolveSkill({ skillId: getSkillByKey(key).id, caster, foe, distance });

test('every one of the 50 skills has an archetype', () => {
  for (const s of SKILLS) assert.ok(SKILL_ARCHETYPE[s.id], `skill ${s.id} ${s.key} unmapped`);
});

test('DIRECT hits in range and misses out of range (slapstick)', () => {
  fresh(); let [a, b] = pair();
  const hpFull = b.hp;
  const r = cast('Headbutt', a, b, 2);
  assert.equal(r.hit, true); assert.ok(b.hp < hpFull);
  [a, b] = pair();
  const miss = cast('Headbutt', a, b, 20);
  assert.equal(miss.hit, false);
});

test('Take_Down recoils the caster (RECOIL_SELF)', () => {
  fresh(); const [a, b] = pair();
  const aHp = a.hp;
  cast('Take_Down', a, b, 2);
  assert.ok(a.hp < aHp, 'caster took recoil');
});

test('Flamethrower applies a DoT that ticks over time', () => {
  fresh(); const [a, b] = pair();
  cast('Flamethrower', a, b, 3);
  assert.ok(b.dots.length > 0, 'dot applied');
  const before = b.hp;
  b.update(1.0); // tick
  assert.ok(b.hp < before, 'dot dealt damage over time');
});

test('Agility buffs caster speed (SELF_BUFF haste)', () => {
  fresh(); const [a, b] = pair();
  const base = a.effectiveSpeed;
  cast('Agility', a, b, 5);
  assert.ok(a.hasEffect('haste'));
  assert.ok(a.effectiveSpeed > base, 'faster while hasted');
});

test('Withdraw makes the caster immune (SHIELD immune)', () => {
  fresh(); const [a, b] = pair();
  cast('Withdraw', a, b, 5);
  assert.equal(a.isImmune, true);
  assert.equal(a.takeDamage(50), 0, 'immune blocks all damage');
});

test('Reflect bounces a projectile back at the sender', () => {
  fresh(); const [a, b] = pair();
  cast('Reflect', b, a, 5);               // b shields up
  const aHp = a.hp;
  cast('Ember', a, b, 5);                 // a throws a projectile at b
  assert.ok(a.hp < aHp, 'projectile reflected onto caster');
});

test('Rest heals the caster and leaves it helpless', () => {
  fresh(); const [a, b] = pair();
  a.hp = 50;
  cast('Rest', a, b, 5);
  assert.equal(a.hp, 90);
  assert.ok(a.hasEffect('helpless'));
});

test('Yawn puts the foe to sleep (STATUS) → cannot act/move', () => {
  fresh(); const [a, b] = pair();
  b.skillIds = [getSkillByKey('Tackle').id];
  cast('Yawn', a, b, 6);
  assert.equal(b.isAsleep, true);
  assert.equal(b.effectiveSpeed, 0);
  assert.equal(b.canCast(b.skillIds[0]), false);
});

test('Disable locks the foe’s last-used skill slot', () => {
  fresh(); const [a, b] = pair();
  const tackle = getSkillByKey('Tackle').id;
  b.skillIds = [tackle];
  b.lastSkillId = tackle;      // foe just used Tackle
  cast('Disable', a, b, 6);
  assert.equal(b.disabledSkillId, tackle);
  assert.equal(b.canCast(tackle), false);
});

test('Bide stores incoming damage during its window (CHARGE_COUNTER)', () => {
  fresh(); const [a, b] = pair();
  cast('Bide', a, b, 5);
  assert.ok(a.bide && a.bide.timer > 0);
  a.takeDamage(25);
  assert.equal(a.bide.stored, 25, 'absorbed damage is stored');
});

test('Spikes spawns a persistent floor hazard', () => {
  fresh(); const [a, b] = pair();
  const r = cast('Spikes', a, b, 5);
  assert.equal(r.hazards.length, 1);
  assert.equal(r.hazards[0].kind, 'spikes');
  assert.ok(r.hazards[0].timer > 0);
});

test('Self_Destruct drops the caster to 1 HP', () => {
  fresh(); const [a, b] = pair();
  cast('Self_Destruct', a, b, 3);
  assert.equal(a.hp, 1);
});

test('Lick applies a slow debuff to the foe', () => {
  fresh(); const [a, b] = pair();
  const base = b.effectiveSpeed;
  cast('Lick', a, b, 2);
  assert.ok(b.hasEffect('slow'));
  assert.ok(b.effectiveSpeed < base, 'slowed');
});
