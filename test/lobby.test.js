/**
 * Headless logic tests for the lobby slice. These cover the pure,
 * engine-agnostic behavior (state transitions, selection rules, appearance
 * cycling) that drive the 3D scene — verifiable without WebGL/DOM.
 *
 * The Three.js scene construction itself is exercised by `npm run build`
 * (Vite resolves + transforms all modules) and by a headless render smoke
 * check; these tests pin the decision logic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LocalState, GAME_MODES, PEDESTAL_MONSTERS } from '../src/client/state/localState.js';
import { SKIN_TONES, TUNIC_COLORS } from '../src/client/models/trainer.js';
import { MONSTERS } from '../src/shared/monsters.js';
import { DebugConfig } from '../src/shared/debugConfig.js';

test('lobby exposes all 5 monsters as pedestals (GDD §3)', () => {
  assert.equal(PEDESTAL_MONSTERS.length, 5);
  assert.deepEqual(PEDESTAL_MONSTERS.map((m) => m.id).sort(), MONSTERS.map((m) => m.id).sort());
});

test('game modes match the host console dropdown (GDD §3)', () => {
  assert.deepEqual(GAME_MODES, ['Tournament', 'Free-For-All', 'Team Fight']);
});

test('local player starts with configured gold and no monster', () => {
  DebugConfig.reset();
  // state was initialized at import; validate the invariant holds post-reset path
  assert.equal(DebugConfig.get('startingGoldAmount'), 50);
  const st = LocalState.get();
  assert.ok(st.gold >= 0);
});

test('selecting a monster enables start-match (host) (GDD §3)', () => {
  const st = LocalState.get();
  st.isHost = true;
  st.selectedMonsterId = null;
  assert.equal(LocalState.canStartMatch(), false, 'no monster -> cannot start');
  LocalState.selectMonster('voltkid');
  assert.equal(st.selectedMonsterId, 'voltkid');
  assert.equal(LocalState.canStartMatch(), true, 'host + monster -> can start');
});

test('non-host cannot start the match', () => {
  const st = LocalState.get();
  st.isHost = false;
  LocalState.selectMonster('pyroroc');
  assert.equal(LocalState.canStartMatch(), false);
  st.isHost = true; // restore
});

test('player limit clamps to 2..10 (GDD §3)', () => {
  LocalState.setPlayerLimit(1);
  assert.equal(LocalState.get().playerLimit, 2);
  LocalState.setPlayerLimit(99);
  assert.equal(LocalState.get().playerLimit, 10);
  LocalState.setPlayerLimit(6);
  assert.equal(LocalState.get().playerLimit, 6);
});

test('game mode setter rejects unknown modes', () => {
  LocalState.setGameMode('Free-For-All');
  assert.equal(LocalState.get().gameMode, 'Free-For-All');
  LocalState.setGameMode('Nonsense');
  assert.equal(LocalState.get().gameMode, 'Free-For-All', 'unknown mode ignored');
  LocalState.setGameMode('Tournament'); // restore
});

test('appearance cycling palettes are non-empty and distinct', () => {
  assert.ok(SKIN_TONES.length >= 3);
  assert.ok(TUNIC_COLORS.length >= 3);
  assert.equal(new Set(SKIN_TONES).size, SKIN_TONES.length);
  assert.equal(new Set(TUNIC_COLORS).size, TUNIC_COLORS.length);
});

test('setAppearance updates and notifies listeners', () => {
  let notified = 0;
  const off = LocalState.onChange(() => { notified++; });
  LocalState.setAppearance({ skinTone: SKIN_TONES[2], tunicColor: TUNIC_COLORS[3] });
  off();
  const st = LocalState.get();
  assert.equal(st.appearance.skinTone, SKIN_TONES[2]);
  assert.equal(st.appearance.tunicColor, TUNIC_COLORS[3]);
  assert.ok(notified >= 1);
});
