/**
 * Footstep cadence (feedback #6). Emits a "step" every `stride` metres travelled
 * so the rhythm scales naturally with movement velocity (walk vs sprint). Pure +
 * testable: the trigger logic is unit-tested even though the sound itself can't
 * be verified in a headless sandbox (no audio device).
 */
export class FootstepTracker {
  /** @param {number} [stride] metres between steps */
  constructor(stride = 2.0) {
    this.stride = stride;
    this._dist = 0;
  }

  /**
   * Advance by a horizontal movement of `moved` metres this frame.
   * @param {number} moved  distance travelled since last call (>=0)
   * @returns {number} number of steps to play this frame (usually 0 or 1)
   */
  advance(moved) {
    if (!(moved > 0)) return 0;
    this._dist += moved;
    let steps = 0;
    while (this._dist >= this.stride) { this._dist -= this.stride; steps++; }
    return steps;
  }

  reset() { this._dist = 0; }
}
