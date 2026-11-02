/**
 * Headless tests for Best-of-3 series tracking (round 7 #1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SeriesState, ROUNDS_TO_WIN, MAX_ROUNDS } from '../src/shared/series.js';

test('series starts 0-0 on round 1, not over', () => {
  const s = new SeriesState('A', 'B');
  assert.equal(s.winsA, 0);
  assert.equal(s.winsB, 0);
  assert.equal(s.round, 1);
  assert.equal(s.isOver, false);
  assert.equal(s.seriesWinner, null);
  assert.equal(s.scoreString(), '0 - 0');
});

test('constants are Bo3 (first to 2, max 3 rounds)', () => {
  assert.equal(ROUNDS_TO_WIN, 2);
  assert.equal(MAX_ROUNDS, 3);
});

test('recording a round win increments the right side', () => {
  const s = new SeriesState('A', 'B');
  s.recordRoundWin('A');
  assert.equal(s.winsA, 1);
  assert.equal(s.winsB, 0);
  assert.equal(s.scoreString(), '1 - 0');
  assert.equal(s.isOver, false);
});

test('an unknown winner id is ignored', () => {
  const s = new SeriesState('A', 'B');
  s.recordRoundWin('someone-else');
  assert.equal(s.winsA, 0);
  assert.equal(s.winsB, 0);
});

test('first to two wins the series (2-0 sweep)', () => {
  const s = new SeriesState('A', 'B');
  s.recordRoundWin('A');
  assert.equal(s.isOver, false);
  s.recordRoundWin('A');
  assert.equal(s.isOver, true);
  assert.equal(s.seriesWinner, 'A');
  assert.equal(s.scoreString(), '2 - 0');
});

test('a full three-round series resolves to the 2-1 winner', () => {
  const s = new SeriesState('A', 'B');
  s.recordRoundWin('A'); // 1-0
  s.nextRound();
  s.recordRoundWin('B'); // 1-1
  assert.equal(s.isOver, false);
  s.nextRound();
  assert.equal(s.round, 3, 'advanced to round 3');
  s.recordRoundWin('B'); // 1-2
  assert.equal(s.isOver, true);
  assert.equal(s.seriesWinner, 'B');
  assert.equal(s.scoreString(), '1 - 2');
});

test('recording wins after the series is over is a no-op', () => {
  const s = new SeriesState('A', 'B');
  s.recordRoundWin('A');
  s.recordRoundWin('A'); // series over 2-0
  s.recordRoundWin('B'); // should be ignored
  assert.equal(s.winsB, 0);
  assert.equal(s.seriesWinner, 'A');
});

test('nextRound does not advance once the series is decided', () => {
  const s = new SeriesState('A', 'B');
  s.recordRoundWin('A');
  s.recordRoundWin('A');
  const before = s.round;
  s.nextRound();
  assert.equal(s.round, before, 'no round advance after the series ends');
});

test('snapshot reflects score, round, winner and over flag', () => {
  const s = new SeriesState('A', 'B');
  s.recordRoundWin('A');
  const snap = s.snapshot();
  assert.deepEqual(snap, {
    winsA: 1, winsB: 0, round: 1, roundsToWin: 2, over: false, winner: null,
  });
  s.recordRoundWin('A');
  assert.equal(s.snapshot().over, true);
  assert.equal(s.snapshot().winner, 'A');
});

test('custom roundsToWin is honored', () => {
  const s = new SeriesState('A', 'B', 1); // best-of-1
  s.recordRoundWin('B');
  assert.equal(s.isOver, true);
  assert.equal(s.seriesWinner, 'B');
});
