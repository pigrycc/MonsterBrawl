/**
 * Headless tests for the shared data layer. Runnable here with `npm test`
 * (node --test) — no browser/engine needed. These verify the GDD data rules
 * that the rest of the game depends on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SKILLS, SKILL_COUNT, getSkillById, getSkillByKey, freeSkills, affordableSkills } from '../src/shared/skills.js';
import { MONSTERS, getMonster } from '../src/shared/monsters.js';
import { generateTotemDraft, makeRng, DRAFT_TOTEM_COUNT, DRAFT_MIN_AFFORDABLE } from '../src/shared/draft.js';
import { DebugConfig } from '../src/shared/debugConfig.js';

test('skill database has exactly 50 entries (GDD §10)', () => {
  assert.equal(SKILL_COUNT, 50);
  assert.equal(SKILLS.length, 50);
});

test('skill ids are unique and contiguous 1..50', () => {
  const ids = SKILLS.map((s) => s.id).sort((a, b) => a - b);
  for (let i = 0; i < 50; i++) assert.equal(ids[i], i + 1);
});

test('date-corrupted windups are corrected to numeric seconds', () => {
  assert.equal(getSkillByKey('Zap_Cannon').windup, 2.5);
  assert.equal(getSkillByKey('Hyper_Beam').windup, 5.0);
  assert.equal(getSkillByKey('Self_Destruct').windup, 5.0);
  // no windup should be NaN
  for (const s of SKILLS) assert.ok(Number.isFinite(s.windup), `${s.key} windup NaN`);
});

test('all costs are from the allowed set {0,10,15,20,25,30}', () => {
  const allowed = new Set([0, 10, 15, 20, 25, 30]);
  for (const s of SKILLS) assert.ok(allowed.has(s.cost), `${s.key} cost ${s.cost}`);
});

test('lookup helpers work', () => {
  assert.equal(getSkillById(1).key, 'Tackle');
  assert.equal(getSkillByKey('tackle').id, 1);
  assert.ok(freeSkills().length >= 4, 'need at least 4 free skills for anti-softlock');
  assert.ok(affordableSkills(0).every((s) => s.cost === 0));
});

test('monster roster has the 5 archetypes (GDD §7)', () => {
  assert.equal(MONSTERS.length, 5);
  for (const id of ['pyroroc', 'aquaslug', 'voltkid', 'terrataur', 'galebird']) {
    assert.ok(getMonster(id), `missing ${id}`);
  }
  // basic-attack skill ids must resolve
  for (const m of MONSTERS) assert.ok(getSkillById(m.basicAttackSkillId), `${m.id} bad basic attack`);
});

test('totem draft: exactly 6 totems, >=4 affordable, no duplicates (GDD §4A)', () => {
  const monster = getMonster('pyroroc');
  for (let seed = 1; seed <= 200; seed++) {
    const totems = generateTotemDraft({ monster, gold: 50, rng: makeRng(seed) });
    assert.equal(totems.length, DRAFT_TOTEM_COUNT, `seed ${seed} count`);
    const unique = new Set(totems.map((t) => t.id));
    assert.equal(unique.size, totems.length, `seed ${seed} duplicates`);
    const affordable = totems.filter((t) => t.cost <= 50).length;
    assert.ok(affordable >= DRAFT_MIN_AFFORDABLE, `seed ${seed} only ${affordable} affordable`);
  }
});

test('totem draft with 0 gold still guarantees 4 affordable (free) skills', () => {
  const monster = getMonster('galebird');
  for (let seed = 1; seed <= 100; seed++) {
    const totems = generateTotemDraft({ monster, gold: 0, rng: makeRng(seed) });
    const affordable = totems.filter((t) => t.cost === 0).length;
    assert.ok(affordable >= DRAFT_MIN_AFFORDABLE, `seed ${seed} only ${affordable} free`);
  }
});

test('totem draft is affinity-weighted', () => {
  const monster = getMonster('terrataur'); // Earth
  let earthCount = 0;
  const trials = 400;
  for (let seed = 1; seed <= trials; seed++) {
    const totems = generateTotemDraft({ monster, gold: 50, rng: makeRng(seed) });
    earthCount += totems.filter((t) => t.element === 'Earth').length;
  }
  const earthShareInDb = SKILLS.filter((s) => s.element === 'Earth').length / SKILLS.length;
  const observedShare = earthCount / (trials * 6);
  assert.ok(observedShare > earthShareInDb, `affinity not weighted up: ${observedShare} vs ${earthShareInDb}`);
});

test('debug config defaults match GDD §9', () => {
  assert.equal(DebugConfig.get('trainingPhaseDuration'), 60.0);
  assert.equal(DebugConfig.get('startingGoldAmount'), 50);
  assert.equal(DebugConfig.get('maxBetAmount'), 10);
  assert.equal(DebugConfig.get('winRewardGold'), 30);
  assert.equal(DebugConfig.get('loseRewardGold'), 20);
  assert.equal(DebugConfig.get('shoveCooldownSeconds'), 10.0);
});

test('debug config clamps and coerces', () => {
  DebugConfig.set('startingGoldAmount', '77.6');
  assert.equal(DebugConfig.get('startingGoldAmount'), 78);
  DebugConfig.set('maxBetAmount', -5);
  assert.equal(DebugConfig.get('maxBetAmount'), 0);
  DebugConfig.reset();
  assert.equal(DebugConfig.get('startingGoldAmount'), 50);
});
