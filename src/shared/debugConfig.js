/**
 * Debug / tunable configuration registry — GDD §9.
 *
 * Every entry is a hot-reloadable variable surfaced by the in-game debug console
 * (the [~] overlay). The registry is the single source of truth: both the
 * authoritative server (match rules) and the client (HUD / UI) read from it, so
 * flipping a value live changes behavior everywhere that references it.
 */

/** @typedef {'bool'|'float'|'int'|'enum'} DebugVarType */

/**
 * @typedef {Object} DebugVar
 * @property {string} key
 * @property {string} label
 * @property {DebugVarType} type
 * @property {boolean|number|string} default
 * @property {boolean|number|string} value
 * @property {string} [help]
 * @property {number} [min]
 * @property {number} [max]
 * @property {string[]} [options]   For enum types
 */

/** @type {Record<string, DebugVar>} */
const REGISTRY = {};

/** @param {DebugVar} def */
function define(def) {
  REGISTRY[def.key] = { ...def, value: def.default };
}

// --- GDD §9 variables ------------------------------------------------------
define({ key: 'toggleAllSkillsFree', label: 'All Skills Free', type: 'bool', default: false, help: 'Sets all skill costs to 0 Gold.' });
define({ key: 'trainingPhaseDuration', label: 'Training Phase (s)', type: 'float', default: 60.0, min: 1, max: 600, help: 'Preparation timer length.' });
define({ key: 'suddenDeathTimer', label: 'Sudden Death (s)', type: 'float', default: 180.0, min: 10, max: 900, help: 'Match clock before Sudden Death triggers.' });
define({ key: 'startingGoldAmount', label: 'Starting Gold', type: 'int', default: 50, min: 0, max: 9999, help: 'Starting wallet balance.' });
define({ key: 'maxBetAmount', label: 'Max Bet', type: 'int', default: 10, min: 0, max: 9999, help: 'Maximum wager allowed.' });
define({ key: 'winRewardGold', label: 'Win Reward', type: 'int', default: 30, min: 0, max: 9999, help: 'Gold awarded to the bout victor.' });
define({ key: 'loseRewardGold', label: 'Lose Reward', type: 'int', default: 20, min: 0, max: 9999, help: 'Gold awarded to the defeated player.' });
define({ key: 'shoveCooldownSeconds', label: 'Shove Cooldown (s)', type: 'float', default: 10.0, min: 0, max: 120, help: 'Trainer shove cooldown per target.' });
define({ key: 'spectatorItemSpawnRate', label: 'Spectator Item Spawn (s)', type: 'float', default: 8.0, min: 1, max: 120, help: 'Spawn timer for spectator terrace items.' });
define({ key: 'arenaItemSpawnRate', label: 'Arena Item Spawn (s)', type: 'float', default: 15.0, min: 1, max: 120, help: 'Spawn timer for arena crowd drops.' });
define({ key: 'botBehaviorMode', label: 'Bot Behavior', type: 'enum', default: 'HUMANLIKE', options: ['IDLE', 'HUMANLIKE'], help: 'Default profile for spawned bots.' });
define({ key: 'forceLocalMonsterType', label: 'Force Local Monster', type: 'enum', default: 'NONE', options: ['NONE', 'Pyroroc', 'Aquaslug', 'Voltkid', 'Terrataur', 'Galebird'], help: 'Override local trainer monster selection.' });
// Feedback round 1 (#8): tuning multipliers.
define({ key: 'skillCooldownMultiplier', label: 'Skill Cooldown ×', type: 'enum', default: '1x', options: ['1x', '2x', '3x', '4x', '5x', '6x'], help: 'Scales all active skill cooldowns.' });
define({ key: 'monsterHpMultiplier', label: 'Monster HP ×', type: 'enum', default: '1x', options: ['1x', '2x', '3x', '4x', '5x', '6x'], help: 'Scales monster max (and proportional current) HP.' });
// Round 5 (#4): AI trainer reaction latency before evading a hostile monster.
define({ key: 'aiTrainerReactionSeconds', label: 'AI Trainer Reaction (s)', type: 'float', default: 3.0, min: 0, max: 10, help: 'Delay before an AI trainer reacts to being chased.' });

/** Change listeners for hot-reload propagation. @type {Set<Function>} */
const listeners = new Set();

export const DebugConfig = {
  /** @returns {DebugVar[]} */
  all: () => Object.values(REGISTRY),
  /** @param {string} key */
  get: (key) => REGISTRY[key]?.value,
  /** @param {string} key */
  meta: (key) => REGISTRY[key],
  /**
   * Set a value (coerced to the declared type) and notify listeners.
   * @param {string} key
   * @param {boolean|number|string} raw
   */
  set(key, raw) {
    const v = REGISTRY[key];
    if (!v) return false;
    let next = raw;
    if (v.type === 'bool') next = raw === true || raw === 'true' || raw === 1 || raw === '1';
    else if (v.type === 'int') next = Math.round(Number(raw));
    else if (v.type === 'float') next = Number(raw);
    else if (v.type === 'enum') next = String(raw);
    if ((v.type === 'int' || v.type === 'float') && Number.isFinite(next)) {
      if (v.min != null) next = Math.max(v.min, next);
      if (v.max != null) next = Math.min(v.max, next);
    }
    v.value = next;
    for (const fn of listeners) fn(key, next);
    return true;
  },
  /** Reset every variable to its default. */
  reset() {
    for (const v of Object.values(REGISTRY)) v.value = v.default;
    for (const fn of listeners) fn('*', null);
  },
  /** @param {(key:string, value:any)=>void} fn */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Serializable snapshot for syncing host → clients. */
  snapshot: () => Object.fromEntries(Object.values(REGISTRY).map((v) => [v.key, v.value])),
  /** Apply a snapshot (e.g. received from host). */
  applySnapshot(snap) {
    for (const [k, val] of Object.entries(snap || {})) {
      if (REGISTRY[k]) REGISTRY[k].value = val;
    }
    for (const fn of listeners) fn('*', null);
  },
  /** Parse an "Nx" multiplier enum value to a number (e.g. "3x" → 3). */
  multiplier(key) {
    const v = REGISTRY[key]?.value;
    const n = parseFloat(String(v));
    return Number.isFinite(n) && n > 0 ? n : 1;
  },
};
