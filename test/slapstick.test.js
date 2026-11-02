/**
 * Slapstick miss-reaction tests (GDD §10 slapstick column, feedback #3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SKILLS, getSkillByKey } from '../src/shared/skills.js';
import { REACTION, reactionForId, resolveCast, skillRange, REACTION_BY_SKILL } from '../src/shared/slapstick.js';

test('every skill maps to a known reaction category', () => {
  for (const s of SKILLS) {
    const r = REACTION_BY_SKILL[s.id];
    assert.ok(Object.values(REACTION).includes(r), `${s.key} → ${r}`);
  }
});

test('signature slapstick lines map to the intended reaction', () => {
  // Tackle: "Miss causes monster to trip and stumble"
  assert.equal(reactionForId(getSkillByKey('Tackle').id), REACTION.TRIP);
  // Body_Slam: "Pancakes flat on sand"
  assert.equal(reactionForId(getSkillByKey('Body_Slam').id), REACTION.PANCAKE);
  // Mega_Punch: "spins monster around 360 degrees on miss"
  assert.equal(reactionForId(getSkillByKey('Mega_Punch').id), REACTION.SPIN);
  // Rollout: "Bounces violently off coliseum walls like a pinball"
  assert.equal(reactionForId(getSkillByKey('Rollout').id), REACTION.PINBALL);
  // Hydro_Pump: "launches user 3 meters backwards"
  assert.equal(reactionForId(getSkillByKey('Hydro_Pump').id), REACTION.RECOIL);
});

test('melee skills need the foe close; ranged reach far', () => {
  assert.ok(skillRange(getSkillByKey('Tackle')) <= 3.0);       // melee
  assert.ok(skillRange(getSkillByKey('Water_Gun')) >= 10);     // beam
  assert.equal(skillRange(getSkillByKey('Agility')), Infinity); // self-buff
});

test('resolveCast: in-range hits, out-of-range misses with a reaction', () => {
  const tackle = getSkillByKey('Tackle').id; // melee, range 3
  assert.deepEqual(resolveCast(tackle, 2), { hit: true, reaction: REACTION.NONE });
  const missed = resolveCast(tackle, 9);
  assert.equal(missed.hit, false);
  assert.equal(missed.reaction, REACTION.TRIP);
});

test('self-buff skills always land (no slapstick miss)', () => {
  const agility = getSkillByKey('Agility').id;
  assert.deepEqual(resolveCast(agility, 999), { hit: true, reaction: REACTION.NONE });
});
