/**
 * Dual Preparation Phase — core logic (GDD §4). Engine-agnostic so it can run
 * on the authoritative host and be unit-tested headlessly.
 *
 * Two parallel "rooms" share one synchronized countdown:
 *   A. TrainingCell  — active fighters draft 4 skills from 6 totems.
 *   B. BookmakersDen — spectators place exactly one wager.
 *
 * The countdown runs for trainingPhaseDuration (debug §9). If ALL active
 * fighters are READY before it expires, it skips to zero (GDD §4).
 */
import { DebugConfig } from './debugConfig.js';
import { generateTotemDraft, makeRng } from './draft.js';
import { getMonster } from './monsters.js';
import { getSkillById } from './skills.js';

export const MAX_SKILL_SLOTS = 4;
export const PURCHASE_HOLD_SECONDS = 1.0; // hold [E] this long to buy

/**
 * A single active fighter's training state: wallet, the 6 offered totems, and
 * the up-to-4 purchased skill slots.
 */
export class TrainingCell {
  /**
   * @param {Object} opts
   * @param {string} opts.playerId
   * @param {string} opts.monsterId
   * @param {number} [opts.gold]     starting gold (defaults to debug §9)
   * @param {number} [opts.seed]     RNG seed for a replicable draft
   */
  constructor({ playerId, monsterId, gold, seed }) {
    this.playerId = playerId;
    this.monsterId = monsterId;
    this.monster = getMonster(monsterId);
    this.gold = gold ?? DebugConfig.get('startingGoldAmount');
    this.slots = [null, null, null, null]; // skill ids or null
    this.rng = makeRng(seed);
    this.rollTotems();
  }

  /** (Re)generate the 6 affinity-weighted totems respecting current gold + debug. */
  rollTotems() {
    const allFree = DebugConfig.get('toggleAllSkillsFree');
    this.totems = generateTotemDraft({
      monster: this.monster,
      gold: this.gold,
      allFree,
      rng: this.rng,
    }).map((s) => ({ skill: s, purchased: false }));
    return this.totems;
  }

  /** Effective cost of a skill, honoring the all-free debug flag. */
  costOf(skill) {
    return DebugConfig.get('toggleAllSkillsFree') ? 0 : skill.cost;
  }

  get firstEmptySlot() {
    return this.slots.findIndex((s) => s === null);
  }

  get isReady() {
    return this.slots.every((s) => s !== null);
  }

  /** @returns {boolean} can this totem be purchased right now? */
  canPurchase(totemIndex) {
    const t = this.totems[totemIndex];
    if (!t || t.purchased) return false;
    if (this.firstEmptySlot === -1) return false;          // all 4 slots full
    if (this.slots.includes(t.skill.id)) return false;      // no duplicates
    return this.gold >= this.costOf(t.skill);
  }

  /**
   * Purchase a totem (after the 1.0s hold completes) and assign to the next
   * free HUD slot. Returns the slot index, or -1 if not purchasable.
   */
  purchase(totemIndex) {
    if (!this.canPurchase(totemIndex)) return -1;
    const t = this.totems[totemIndex];
    const slot = this.firstEmptySlot;
    this.gold -= this.costOf(t.skill);
    this.slots[slot] = t.skill.id;
    t.purchased = true;
    return slot;
  }

  /** The resolved Skill objects in each slot (null for empty). */
  loadout() {
    return this.slots.map((id) => (id == null ? null : getSkillById(id)));
  }

  /** Reset purchased skills for a fresh draft next bout (GDD §4A). */
  resetForNewBout({ gold } = {}) {
    if (gold != null) this.gold = gold;
    this.slots = [null, null, null, null];
    this.rollTotems();
  }
}

/**
 * Orchestrates the shared countdown across all training cells + the den.
 * Tick it with dt (seconds). Fires onComplete once when time hits 0 OR all
 * fighters are READY.
 */
export class PrepSession {
  /**
   * @param {Object} opts
   * @param {Array<{playerId:string, monsterId:string, gold?:number, seed?:number}>} opts.fighters
   * @param {() => void} [opts.onComplete]
   * @param {number} [opts.duration]  override (else debug §9 trainingPhaseDuration)
   */
  constructor({ fighters, onComplete, duration }) {
    this.duration = duration ?? DebugConfig.get('trainingPhaseDuration');
    this.timeLeft = this.duration;
    this.onComplete = onComplete;
    this.completed = false;
    this.cells = new Map();
    for (const f of fighters) {
      this.cells.set(f.playerId, new TrainingCell(f));
    }
  }

  getCell(playerId) { return this.cells.get(playerId); }

  get allReady() {
    for (const c of this.cells.values()) if (!c.isReady) return false;
    return this.cells.size > 0;
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (this.completed) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0 || this.allReady) {
      this.timeLeft = 0;
      this.completed = true;
      this.onComplete?.();
    }
  }

  /** 0..1 progress of the countdown (1 at start, 0 at end). */
  get progress() {
    return this.duration > 0 ? this.timeLeft / this.duration : 0;
  }
}
