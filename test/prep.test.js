/**
 * Headless tests for the Dual Preparation Phase core (GDD §4): training-cell
 * economy + READY logic + skip-when-all-ready countdown, and the betting book.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DebugConfig } from '../src/shared/debugConfig.js';
import { TrainingCell, PrepSession, MAX_SKILL_SLOTS } from '../src/shared/prepSession.js';
import { BettingBook, BET_TYPES, PAYOUT_MULTIPLIER } from '../src/shared/betting.js';

function freshDebug() { DebugConfig.reset(); }

test('training cell starts with 50 gold, 6 totems, 4 empty slots (GDD §4A)', () => {
  freshDebug();
  const cell = new TrainingCell({ playerId: 'p1', monsterId: 'pyroroc', seed: 1 });
  assert.equal(cell.gold, 50);
  assert.equal(cell.totems.length, 6);
  assert.equal(cell.slots.length, MAX_SKILL_SLOTS);
  assert.ok(cell.slots.every((s) => s === null));
  assert.equal(cell.isReady, false);
});

test('totems always include >=4 affordable → a 4-skill build is always possible', () => {
  freshDebug();
  for (let seed = 1; seed <= 50; seed++) {
    const cell = new TrainingCell({ playerId: 'p', monsterId: 'galebird', gold: 50, seed });
    const affordable = cell.totems.filter((t) => t.skill.cost <= 50).length;
    assert.ok(affordable >= 4, `seed ${seed}: only ${affordable} affordable`);
  }
});

test('purchasing deducts gold, fills next slot, prevents duplicates + overfill', () => {
  freshDebug();
  const cell = new TrainingCell({ playerId: 'p1', monsterId: 'terrataur', gold: 50, seed: 3 });
  // Buy the 4 cheapest purchasable totems
  const order = cell.totems
    .map((t, i) => ({ i, cost: t.skill.cost }))
    .sort((a, b) => a.cost - b.cost);
  let bought = 0;
  for (const { i } of order) {
    if (cell.canPurchase(i)) {
      const goldBefore = cell.gold;
      const slot = cell.purchase(i);
      assert.ok(slot >= 0 && slot < 4);
      assert.equal(cell.gold, goldBefore - cell.costOf(cell.totems[i].skill));
      bought++;
    }
    if (bought === 4) break;
  }
  assert.equal(bought, 4, 'should be able to buy 4 skills');
  assert.equal(cell.isReady, true, 'ready after 4 slots filled');
  // Cannot buy a 5th (slots full)
  const extra = cell.totems.findIndex((t) => !t.purchased);
  if (extra >= 0) assert.equal(cell.canPurchase(extra), false, 'no 5th purchase');
});

test('cannot purchase a skill you cannot afford', () => {
  freshDebug();
  const cell = new TrainingCell({ playerId: 'p', monsterId: 'voltkid', gold: 5, seed: 7 });
  // With only 5 gold, any totem costing >5 is unpurchasable
  cell.totems.forEach((t, i) => {
    if (t.skill.cost > 5) assert.equal(cell.canPurchase(i), false, `${t.skill.name} should be unaffordable`);
  });
});

test('toggleAllSkillsFree makes every totem cost 0', () => {
  freshDebug();
  DebugConfig.set('toggleAllSkillsFree', true);
  const cell = new TrainingCell({ playerId: 'p', monsterId: 'pyroroc', gold: 0, seed: 2 });
  cell.totems.forEach((_, i) => assert.equal(cell.canPurchase(i), true));
  const g0 = cell.gold;
  cell.purchase(0);
  assert.equal(cell.gold, g0, 'free purchase costs no gold');
  freshDebug();
});

test('resetForNewBout clears slots and re-rolls totems (GDD §4A)', () => {
  freshDebug();
  const cell = new TrainingCell({ playerId: 'p', monsterId: 'aquaslug', gold: 50, seed: 4 });
  cell.purchase(cell.totems.findIndex((t, i) => cell.canPurchase(i)));
  assert.ok(cell.slots.some((s) => s !== null));
  cell.resetForNewBout({ gold: 70 });
  assert.ok(cell.slots.every((s) => s === null), 'slots cleared');
  assert.equal(cell.gold, 70);
  assert.equal(cell.totems.length, 6);
});

test('prep countdown uses debug duration and completes on timeout', () => {
  freshDebug();
  DebugConfig.set('trainingPhaseDuration', 5);
  let done = 0;
  const s = new PrepSession({
    fighters: [{ playerId: 'a', monsterId: 'pyroroc', seed: 1 }, { playerId: 'b', monsterId: 'voltkid', seed: 2 }],
    onComplete: () => { done++; },
  });
  assert.equal(s.timeLeft, 5);
  s.update(3); assert.equal(s.completed, false);
  s.update(3); // past 5s
  assert.equal(s.completed, true);
  assert.equal(done, 1);
  s.update(1); // no double-fire
  assert.equal(done, 1);
  freshDebug();
});

test('prep skips to zero when all fighters READY (GDD §4)', () => {
  freshDebug();
  DebugConfig.set('trainingPhaseDuration', 60);
  let done = 0;
  const s = new PrepSession({
    fighters: [{ playerId: 'a', monsterId: 'terrataur', seed: 10 }, { playerId: 'b', monsterId: 'galebird', seed: 11 }],
    onComplete: () => { done++; },
  });
  // Make both ready. The >=4-affordable guarantee ensures a 4-skill build is
  // reachable when buying cheapest-first (the rational path).
  for (const id of ['a', 'b']) {
    const cell = s.getCell(id);
    while (!cell.isReady) {
      // pick the cheapest currently-purchasable totem
      let best = -1, bestCost = Infinity;
      cell.totems.forEach((t, idx) => {
        if (cell.canPurchase(idx) && t.skill.cost < bestCost) { best = idx; bestCost = t.skill.cost; }
      });
      if (best < 0) break;
      cell.purchase(best);
    }
    assert.equal(cell.isReady, true);
  }
  assert.ok(s.timeLeft > 0, 'still time on the clock');
  s.update(0.1); // one tick → should detect allReady and complete
  assert.equal(s.completed, true, 'completes early when all ready');
  assert.equal(s.timeLeft, 0);
  assert.equal(done, 1);
  freshDebug();
});

// --- Betting (GDD §4B) -----------------------------------------------------

test('spectator may place exactly one wager, within max bet', () => {
  freshDebug();
  const book = new BettingBook();
  assert.equal(book.maxBet, 10);
  let r = book.placeBet('s1', { type: BET_TYPES.BOUT_UNDER_60, stake: 10 }, 50);
  assert.equal(r.ok, true);
  r = book.placeBet('s1', { type: BET_TYPES.BOUT_UNDER_60, stake: 5 }, 50);
  assert.equal(r.ok, false); assert.equal(r.reason, 'already_bet');
  r = book.placeBet('s2', { type: BET_TYPES.BOUT_UNDER_60, stake: 11 }, 50);
  assert.equal(r.ok, false); assert.equal(r.reason, 'over_max');
});

test('bet type targets are validated', () => {
  freshDebug();
  const book = new BettingBook();
  assert.equal(book.placeBet('a', { type: BET_TYPES.PLAYER_WINS, stake: 5 }, 50).reason, 'need_target_player');
  assert.equal(book.placeBet('b', { type: BET_TYPES.MONSTER_STUNNED_3, stake: 5 }, 50).reason, 'need_target_monster');
  assert.equal(book.placeBet('c', { type: BET_TYPES.PLAYER_WINS, stake: 5, targetPlayerId: 'p1' }, 50).ok, true);
});

test('closing betting rejects further wagers', () => {
  freshDebug();
  const book = new BettingBook();
  book.closeBetting();
  assert.equal(book.placeBet('s', { type: BET_TYPES.BOUT_UNDER_60, stake: 5 }, 50).reason, 'betting_closed');
});

test('resolve pays 2.0x on win, loses stake on loss (GDD §4B)', () => {
  freshDebug();
  const book = new BettingBook();
  book.placeBet('winA', { type: BET_TYPES.PLAYER_WINS, stake: 10, targetPlayerId: 'p1' }, 50);
  book.placeBet('loseA', { type: BET_TYPES.PLAYER_WINS, stake: 8, targetPlayerId: 'p2' }, 50);
  book.placeBet('fast', { type: BET_TYPES.BOUT_UNDER_60, stake: 6 }, 50);
  book.placeBet('stun', { type: BET_TYPES.MONSTER_STUNNED_3, stake: 7, targetMonsterId: 'terrataur' }, 50);

  const results = book.resolve({
    winnerPlayerId: 'p1',
    boutDurationSec: 42,
    stunCountsByMonsterId: { terrataur: 4, galebird: 1 },
  });

  assert.equal(results.get('winA').won, true);
  assert.equal(results.get('winA').payout, 20);
  assert.equal(results.get('winA').net, 10);
  assert.equal(results.get('loseA').won, false);
  assert.equal(results.get('loseA').net, -8);
  assert.equal(results.get('fast').won, true);   // 42 < 60
  assert.equal(results.get('stun').won, true);   // 4 >= 3
  assert.equal(PAYOUT_MULTIPLIER, 2.0);
});

test('bout-under-60 loses when bout runs 60s or longer', () => {
  freshDebug();
  const book = new BettingBook();
  book.placeBet('s', { type: BET_TYPES.BOUT_UNDER_60, stake: 5 }, 50);
  const r = book.resolve({ winnerPlayerId: 'x', boutDurationSec: 60, stunCountsByMonsterId: {} });
  assert.equal(r.get('s').won, false);
});
