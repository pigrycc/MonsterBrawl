/**
 * Footstep cadence tests (#6). The SOUND can't be verified in a headless
 * sandbox (no audio device), but the step-trigger logic is pure + testable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FootstepTracker } from '../src/client/audio/footsteps.js';

test('emits one step per stride travelled', () => {
  const f = new FootstepTracker(2.0);
  assert.equal(f.advance(1.0), 0, 'half a stride → no step yet');
  assert.equal(f.advance(1.0), 1, 'completing the stride → one step');
  assert.equal(f.advance(0), 0, 'no movement → no step');
});

test('fast movement in one frame can emit multiple steps (cadence scales with speed)', () => {
  const f = new FootstepTracker(1.0);
  assert.equal(f.advance(3.2), 3, 'covered 3+ strides → 3 steps');
});

test('ignores zero / negative movement', () => {
  const f = new FootstepTracker(2.0);
  assert.equal(f.advance(0), 0);
  assert.equal(f.advance(-5), 0);
});
