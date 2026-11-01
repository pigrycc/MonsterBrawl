/**
 * Centralized keyboard/mouse input. Tracks held keys, fires edge events for
 * taps, and supports "hold" bindings (e.g. hold [E] for 1.0s to purchase a
 * skill, GDD §4A). Reused by lobby, prep, and arena.
 */
export class Input {
  constructor(target = window) {
    this.target = target;
    this.down = new Set();        // currently-held key codes
    this.heldSince = new Map();   // code -> timestamp when pressed
    this._pressHandlers = new Map();   // code -> Set<fn> (edge: keydown)
    this._releaseHandlers = new Map(); // code -> Set<fn>
    this.mouse = { left: false, right: false, dx: 0, dy: 0 };

    this._onKeyDown = (e) => {
      if (this.down.has(e.code)) return; // ignore auto-repeat
      this.down.add(e.code);
      this.heldSince.set(e.code, performance.now());
      this._pressHandlers.get(e.code)?.forEach((fn) => fn(e));
    };
    this._onKeyUp = (e) => {
      this.down.delete(e.code);
      this.heldSince.delete(e.code);
      this._releaseHandlers.get(e.code)?.forEach((fn) => fn(e));
    };
    this._onMouseDown = (e) => { if (e.button === 0) this.mouse.left = true; if (e.button === 2) this.mouse.right = true; };
    this._onMouseUp = (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; };
    this._onMouseMove = (e) => { this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0; };

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('mousedown', this._onMouseDown);
    target.addEventListener('mouseup', this._onMouseUp);
    target.addEventListener('mousemove', this._onMouseMove);
  }

  isDown(code) { return this.down.has(code); }

  /** Seconds a key has been held (0 if not held). */
  heldDuration(code) {
    const t = this.heldSince.get(code);
    return t == null ? 0 : (performance.now() - t) / 1000;
  }

  /** Register an edge handler for keydown. Returns an unsubscribe fn. */
  onPress(code, fn) {
    if (!this._pressHandlers.has(code)) this._pressHandlers.set(code, new Set());
    this._pressHandlers.get(code).add(fn);
    return () => this._pressHandlers.get(code)?.delete(fn);
  }

  onRelease(code, fn) {
    if (!this._releaseHandlers.has(code)) this._releaseHandlers.set(code, new Set());
    this._releaseHandlers.get(code).add(fn);
    return () => this._releaseHandlers.get(code)?.delete(fn);
  }

  /** Consume accumulated mouse delta (call once per frame). */
  consumeMouseDelta() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return d;
  }

  dispose() {
    const t = this.target;
    t.removeEventListener('keydown', this._onKeyDown);
    t.removeEventListener('keyup', this._onKeyUp);
    t.removeEventListener('mousedown', this._onMouseDown);
    t.removeEventListener('mouseup', this._onMouseUp);
    t.removeEventListener('mousemove', this._onMouseMove);
  }
}
