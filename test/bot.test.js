/**
 * Headless tests for the bot subsystem (GDD §8).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DebugConfig } from '../src/shared/debugConfig.js';
import { TrainingCell } from '../src/shared/prepSession.js';
import { MonsterCombatant, STANCES } from '../src/shared/combat.js';
import { botDraft, botChooseStance, botChooseSkill, BOT_REST_FRACTION } from '../src/shared/bot.js';

const fresh = () => DebugConfig.reset();

test('botDraft reaches a full 4-skill loadout (GDD §8)', () => {
  fresh();
  for (const id of ['pyroroc', 'aquaslug', 'voltkid', 'terrataur', 'galebird']) {
    for (let seed = 1; seed <= 50; seed++) {
      const cell = new TrainingCell({ playerId: 'bot', monsterId: id, gold: 50, seed });
      botDraft(cell);
      assert.equal(cell.isReady, true, `${id} seed ${seed} not ready`);
      assert.equal(cell.slots.filter((s) => s != null).length, 4);
    }
  }
});

test('botDraft never overspends its budget', () => {
  fresh();
  for (let seed = 1; seed <= 100; seed++) {
    const cell = new TrainingCell({ playerId: 'bot', monsterId: 'terrataur', gold: 50, seed });
    botDraft(cell);
    assert.ok(cell.gold >= 0, `seed ${seed} went negative: ${cell.gold}`);
  }
});

test('bot rests when stamina drops below 30% (GDD §8)', () => {
  fresh();
  const self = new MonsterCombatant({ playerId: 'bot', monsterId: 'voltkid' });
  const foe = new MonsterCombatant({ playerId: 'p', monsterId: 'voltkid' });
  self.spendStamina(self.maxStamina * (1 - BOT_REST_FRACTION) + 1); // just under 30%
  assert.ok(self.staminaFraction < BOT_REST_FRACTION);
  assert.equal(botChooseStance(self, foe), STANCES.NEUTRAL);
});

test('bot plays offensively when ahead on HP', () => {
  fresh();
  const self = new MonsterCombatant({ playerId: 'bot', monsterId: 'pyroroc' });
  const foe = new MonsterCombatant({ playerId: 'p', monsterId: 'pyroroc' });
  foe.hp = foe.maxHp * 0.4; // bot is ahead
  assert.equal(botChooseStance(self, foe), STANCES.OFFENSIVE);
});

test('bot guards when behind on HP but not exhausted', () => {
  fresh();
  const self = new MonsterCombatant({ playerId: 'bot', monsterId: 'terrataur' });
  const foe = new MonsterCombatant({ playerId: 'p', monsterId: 'terrataur' });
  self.hp = self.maxHp * 0.3; // bot is behind, stamina still full
  assert.equal(botChooseStance(self, foe), STANCES.DEFENSIVE);
});

test('bot only casts when opponent is in range', () => {
  fresh();
  const self = new MonsterCombatant({ playerId: 'bot', monsterId: 'pyroroc', skillIds: [6, 1] }); // Mega_Punch(45), Tackle(15)
  assert.equal(botChooseSkill(self, 20, 6), null, 'out of range → no cast');
  const pick = botChooseSkill(self, 3, 6);
  assert.equal(pick, 6, 'in range → picks highest damage ready skill');
});

test('bot does not cast while stunned or on cooldown', () => {
  fresh();
  const self = new MonsterCombatant({ playerId: 'bot', monsterId: 'voltkid', skillIds: [1] });
  self.startCooldown(1);
  assert.equal(botChooseSkill(self, 2, 6), null, 'on cooldown → no cast');
  self.cooldowns.clear();
  self.spendStamina(self.maxStamina); // stun
  assert.equal(botChooseSkill(self, 2, 6), null, 'stunned → no cast');
});
