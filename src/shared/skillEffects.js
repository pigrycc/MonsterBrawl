/**
 * Skill effect engine — turns each of the 50 skills into a distinct mechanic
 * (see docs/SKILL_EFFECTS.md). Engine-agnostic + deterministic so it runs in
 * the authoritative CombatRunner and is unit-testable.
 *
 * resolveSkill() mutates the caster/foe combatants (damage, status, buffs,
 * self-effects) and returns a descriptor the caller uses to:
 *   - know hit/miss (for slapstick),
 *   - spawn visuals (projectile/beam/aoe/hazard),
 *   - register field hazards (returned in `hazards`).
 */
import { getSkillById } from './skills.js';
import { skillRange } from './slapstick.js';

/** id → { type, ...params }. Built from the design map in docs/SKILL_EFFECTS.md. */
export const SKILL_ARCHETYPE = {
  1:  { type: 'DIRECT' },
  2:  { type: 'AOE', radius: 3 },
  3:  { type: 'PROJECTILE', speed: 18 },
  4:  { type: 'DIRECT', recoilSelf: 10 },
  5:  { type: 'DIRECT' },
  6:  { type: 'DIRECT' },
  7:  { type: 'DIRECT' },
  8:  { type: 'DIRECT' },
  9:  { type: 'DIRECT' },
  10: { type: 'DIRECT', status: { name: 'slow', sec: 2 } },
  11: { type: 'PROJECTILE', speed: 14 },
  12: { type: 'DOT', dps: 20, sec: 2, cone: true },
  13: { type: 'BEAM' },
  14: { type: 'BEAM', recoilSelf: 0, knockSelf: 3 },
  15: { type: 'PROJECTILE', speed: 12, blindTrainer: 5 },
  16: { type: 'AOE', radius: 2.5, hazard: { kind: 'slip', sec: 6, radius: 2.5 } },
  17: { type: 'PROJECTILE', speed: 20, hits: 5 },
  18: { type: 'PROJECTILE', speed: 16 },
  19: { type: 'PROJECTILE', speed: 8, status: { name: 'stun', sec: 3 } },
  20: { type: 'BEAM', selfLock: 2 },
  21: { type: 'AOE', radius: 3, atFoe: true },
  22: { type: 'AOE', radius: 6, radial: true },
  23: { type: 'HAZARD', kind: 'poison_cloud', sec: 5, radius: 4, dps: 6 },
  24: { type: 'HAZARD', kind: 'fire_trap', sec: 4, radius: 2.5, dps: 10, trap: true },
  25: { type: 'HAZARD', kind: 'whirlpool', sec: 4, radius: 3, dps: 8, pull: true },
  26: { type: 'KNOCKBACK', distance: 4, arena: true },
  27: { type: 'HAZARD', kind: 'spikes', sec: 20, radius: 2, entryDamage: 10 },
  28: { type: 'HAZARD', kind: 'toxic_spikes', sec: 20, radius: 2, entryDamage: 5, dot: { dps: 5, sec: 3 } },
  29: { type: 'HAZARD', kind: 'ice', sec: 8, radius: 4, status: { name: 'slow', sec: 2 } },
  30: { type: 'AOE', radius: 4, selfToOneHp: true },
  31: { type: 'TELEPORT', mode: 'bounce' },
  32: { type: 'TELEPORT', mode: 'dig', thenDirect: true },
  33: { type: 'SELF_BUFF', effect: 'haste', sec: 6 },
  34: { type: 'SHIELD', kind: 'immune', sec: 2.5 },
  35: { type: 'KNOCKBACK', distance: 4, cone: true },
  36: { type: 'STATUS', name: 'vulnerable', sec: 4 },
  37: { type: 'TELEPORT', mode: 'blink' },
  38: { type: 'SELF_BUFF', effect: 'endure', sec: 3 },
  39: { type: 'SELF_BUFF', effect: 'hover', sec: 4 },
  40: { type: 'CHARGE_COUNTER', sec: 2 },
  41: { type: 'DIRECT', steal: true },
  42: { type: 'STATUS', name: 'sleep', sec: 3, cancelWindup: true },
  43: { type: 'STATUS', name: 'panic', sec: 2 },
  44: { type: 'STATUS', name: 'taunt', sec: 3 },
  45: { type: 'HEAL', amount: 40, helplessSec: 3 },
  46: { type: 'HAZARD', kind: 'smoke', sec: 3, radius: 3, blindTrainer: 3 },
  47: { type: 'STATUS', name: 'confuse', sec: 4 },
  48: { type: 'SHIELD', kind: 'reflect', sec: 4 },
  49: { type: 'STATUS', name: 'encore', sec: 3 },
  50: { type: 'STATUS', name: 'disable', sec: 5 },
};

/**
 * Resolve a skill cast authoritatively.
 * @param {Object} ctx
 * @param {number} ctx.skillId
 * @param {import('./combat.js').MonsterCombatant} ctx.caster
 * @param {import('./combat.js').MonsterCombatant} ctx.foe
 * @param {number} ctx.distance   caster→foe distance (m)
 * @param {(target,amount,opts)=>number} [ctx.dealDamage]  optional damage sink
 *        so the host can route monster HP loss through CombatMatch (Sudden
 *        Death). Defaults to target.takeDamage.
 * @returns {{hit:boolean, kind:string, events:object[], hazards:object[]}}
 */
export function resolveSkill({ skillId, caster, foe, distance, dealDamage }) {
  const skill = getSkillById(skillId);
  const arch = SKILL_ARCHETYPE[skillId] || { type: 'DIRECT' };
  const events = [];
  const hazards = [];
  caster.lastSkillId = skillId;
  const hurt = (target, amount, opts) => (dealDamage ? dealDamage(target, amount, opts) : target.takeDamage(amount, opts));

  const inRange = distance <= skillRange(skill);
  const dealToFoe = (amount, opts = {}) => {
    // Reflect: a projectile aimed at a reflecting foe bounces back at the caster.
    if (opts.isProjectile && foe.isReflecting) {
      const back = hurt(caster, amount, { isProjectile: true });
      events.push({ kind: 'reflect', dmg: back });
      return 0;
    }
    const d = hurt(foe, amount, opts);
    if (d > 0) events.push({ kind: 'damage', target: 'foe', dmg: d });
    return d;
  };

  switch (arch.type) {
    case 'DIRECT': {
      if (!inRange) return miss(skill, arch);
      let dmg = skill.damage * (arch.hits || 1);
      dealToFoe(dmg, { isBasic: false });
      if (arch.status) applyStatus(foe, arch.status, caster);
      if (arch.recoilSelf) hurt(caster, arch.recoilSelf, {});
      if (arch.steal && foe.carriedItem) { caster.carriedItem = foe.carriedItem; foe.carriedItem = null; events.push({ kind: 'steal' }); }
      break;
    }
    case 'PROJECTILE': {
      if (!inRange) return miss(skill, arch);
      const hits = arch.hits || 1;
      dealToFoe(skill.damage * hits, { isProjectile: true });
      if (arch.status) applyStatus(foe, arch.status, caster);
      if (arch.blindTrainer) events.push({ kind: 'blindTrainer', target: 'foe', sec: arch.blindTrainer });
      events.push({ kind: 'projectile', speed: arch.speed });
      break;
    }
    case 'BEAM': {
      if (!inRange) return miss(skill, arch);
      dealToFoe(skill.damage, {});
      if (arch.selfLock) caster.applyEffect('locked', arch.selfLock);
      if (arch.knockSelf) events.push({ kind: 'knockSelf', distance: arch.knockSelf });
      events.push({ kind: 'beam' });
      break;
    }
    case 'AOE': {
      // AoE always "lands" (it's an area) — hits the foe if within radius.
      const hitFoe = distance <= (arch.radius + 1);
      if (hitFoe) dealToFoe(skill.damage, {});
      if (arch.selfToOneHp) caster.hp = 1;        // Self_Destruct
      events.push({ kind: 'aoe', radius: arch.radius, atFoe: !!arch.atFoe, radial: !!arch.radial });
      if (arch.hazard) hazards.push(makeHazard(arch.hazard, foe));
      return { hit: hitFoe, kind: arch.type, events, hazards };
    }
    case 'DOT': {
      if (!inRange) return miss(skill, arch);
      dealToFoe(skill.damage, {});
      foe.addDot(arch.dps, arch.sec, skill.element);
      events.push({ kind: 'dot', dps: arch.dps, sec: arch.sec });
      break;
    }
    case 'HAZARD': {
      hazards.push(makeHazard(arch, caster, foe));
      if (arch.blindTrainer) events.push({ kind: 'blindTrainer', target: 'foe', sec: arch.blindTrainer });
      events.push({ kind: 'hazard', hazardKind: arch.kind, radius: arch.radius });
      return { hit: true, kind: arch.type, events, hazards };
    }
    case 'SELF_BUFF': {
      caster.applyEffect(arch.effect, arch.sec);
      events.push({ kind: 'selfBuff', effect: arch.effect });
      return { hit: true, kind: arch.type, events, hazards };
    }
    case 'SHIELD': {
      caster.applyShield(arch.kind, arch.sec);
      events.push({ kind: 'shield', shieldKind: arch.kind });
      return { hit: true, kind: arch.type, events, hazards };
    }
    case 'HEAL': {
      caster.hp = Math.min(caster.maxHp, caster.hp + arch.amount);
      caster.applyEffect('helpless', arch.helplessSec); // vulnerable window
      events.push({ kind: 'heal', amount: arch.amount });
      return { hit: true, kind: arch.type, events, hazards };
    }
    case 'TELEPORT': {
      events.push({ kind: 'teleport', mode: arch.mode });
      if (arch.thenDirect && inRange) dealToFoe(skill.damage, {});
      return { hit: true, kind: arch.type, events, hazards };
    }
    case 'STATUS': {
      applyStatus(foe, { name: arch.name, sec: arch.sec }, caster);
      if (arch.cancelWindup) events.push({ kind: 'cancelWindup', target: 'foe' });
      if (arch.name === 'disable') foe.disabledSkillId = foe.lastSkillId;
      events.push({ kind: 'status', name: arch.name, target: 'foe' });
      return { hit: true, kind: arch.type, events, hazards };
    }
    case 'KNOCKBACK': {
      events.push({ kind: 'knockback', distance: arch.distance, cone: !!arch.cone, arena: !!arch.arena });
      return { hit: true, kind: arch.type, events, hazards };
    }
    case 'CHARGE_COUNTER': {
      caster.bide = { timer: arch.sec, stored: 0 };
      caster.applyEffect('biding', arch.sec);
      events.push({ kind: 'bide', sec: arch.sec });
      return { hit: true, kind: arch.type, events, hazards };
    }
    default: {
      if (!inRange) return miss(skill, arch);
      dealToFoe(skill.damage, {});
    }
  }
  return { hit: true, kind: arch.type, events, hazards };
}

/** Apply a named status to a target, honoring immunity. */
function applyStatus(target, status, caster) {
  if (!status || target.isImmune) return;
  switch (status.name) {
    case 'stun': target.stunTimer = Math.max(target.stunTimer, status.sec); target.stunCount += 1; break;
    case 'sleep': target.applyEffect('sleep', status.sec); break;
    case 'confuse': target.applyConfuse(status.sec); target.applyEffect('confuse', status.sec); break;
    case 'panic': target.applyEffect('panic', status.sec); break;
    case 'taunt': target.applyEffect('taunt', status.sec); break;
    case 'disable': target.applyEffect('disable', status.sec); break;
    case 'encore': target.applyEffect('encore', status.sec); break;
    case 'vulnerable': target.applyEffect('vulnerable', status.sec); break;
    case 'slow': target.applyEffect('slow', status.sec); break;
    default: target.applyEffect(status.name, status.sec);
  }
}

/** Build a field-hazard descriptor (resolved per-tick by the runner). */
function makeHazard(arch, caster, foe) {
  // Place at the foe's position for offensive hazards; at caster for defensive.
  const atFoe = arch.kind !== 'spikes' && arch.kind !== 'toxic_spikes';
  return {
    kind: arch.kind,
    timer: arch.sec,
    radius: arch.radius || 2,
    dps: arch.dps || 0,
    entryDamage: arch.entryDamage || 0,
    dot: arch.dot || null,
    pull: !!arch.pull,
    trap: !!arch.trap,
    status: arch.status || null,
    owner: caster?.playerId,
    anchor: atFoe ? 'foe' : 'caster',
  };
}

function miss(skill, arch) {
  return { hit: false, kind: arch.type, events: [{ kind: 'miss' }], hazards: [] };
}
