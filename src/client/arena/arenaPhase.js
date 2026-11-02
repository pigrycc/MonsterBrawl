/**
 * Arena phase controller (GDD §5). Orchestrates the authoritative CombatMatch,
 * the 3D ArenaScene, the HUD, and the FPP trainer. Handles:
 *   - 3·2·1·GO! opening lock (look-only)
 *   - stance commands [Q]/[E]/[F] (2s delay handled by the sim)
 *   - active skills [1]-[4] with wind-up + cooldown + damage application
 *   - monster basic attacks (from the scene's steering)
 *   - LMB trainer shove, crowd-drop pickup/deliver
 *   - match clock, Sudden Death, and +30/+20 resolution
 *
 * A lightweight bot drives the opponent trainer's stance/skills so the local
 * bout is immediately playable (full §8 profiles come later).
 */
import * as THREE from 'three';
import { FppController } from '../engine/fppController.js';
import { ArenaScene } from './arenaScene.js';
import { ArenaHud } from '../ui/arenaHud.js';
import { Overlay } from '../ui/overlay.js';
import { CombatMatch, MonsterCombatant, STANCES, MATCH_STATE } from '../../shared/combat.js';
import { getSkillById } from '../../shared/skills.js';
import { DebugConfig } from '../../shared/debugConfig.js';

const SHOVE_RANGE = 3.5;
const SHOVE_DISTANCE = 4;

export class ArenaPhase {
  /**
   * @param {Object} ctx
   * @param {THREE.WebGLRenderer} ctx.renderer
   * @param {import('../engine/input.js').Input} ctx.input
   * @param {string} ctx.localPlayerId
   * @param {Array<{playerId:string, monsterId:string, skillIds:number[], isBot?:boolean}>} ctx.fighters (exactly 2)
   * @param {(result:object)=>void} ctx.onComplete
   */
  constructor({ renderer, input, localPlayerId, fighters, onComplete }) {
    this.renderer = renderer;
    this.input = input;
    this.localPlayerId = localPlayerId;
    this.onComplete = onComplete;

    const [f0, f1] = fighters;
    const localF = f0.playerId === localPlayerId ? f0 : f1;
    const foeF = f0.playerId === localPlayerId ? f1 : f0;

    this.local = new MonsterCombatant({ playerId: localF.playerId, monsterId: localF.monsterId, skillIds: localF.skillIds });
    this.foe = new MonsterCombatant({ playerId: foeF.playerId, monsterId: foeF.monsterId, skillIds: foeF.skillIds });

    this.match = new CombatMatch({ a: this.local, b: this.foe, countdown: 3, onEnd: (r) => this._onEnd(r) });
    this.scene3d = new ArenaScene({ a: this.local, b: this.foe });

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 120);
    this.controller = new FppController(this.camera, input, renderer.domElement, {
      x: -5, z: 7, eyeHeight: 1.7, boundaryRadius: this.scene3d.arenaRadius - 1, speed: 5.0,
    });

    this.hud = new ArenaHud({
      left: { name: this.local.def.name },
      right: { name: this.foe.def.name },
      skills: this.local.skillIds.map((id) => getSkillById(id)),
    });
    this.overlay = new Overlay();

    this.clock = new THREE.Clock();
    this._prevCount = null;
    this._windup = null;             // {skillId, time} active heavy wind-up
    this._shoveCooldown = 0;
    this._carrying = null;           // crowd drop being carried
    this._arenaDropTimer = DebugConfig.get('arenaItemSpawnRate');
    this._botTimer = 0;
    this._finished = false;

    this._bindInput();

    this._onResize = () => { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); };
    window.addEventListener('resize', this._onResize);
  }

  _bindInput() {
    const stance = (s) => { if (!this.match.locked) { this.local.commandStance(s); this.overlay.showToast(`Stance → ${s} (2s)`, 900); } };
    this._subs = [
      this.input.onPress('KeyQ', () => stance(STANCES.OFFENSIVE)),
      this.input.onPress('KeyE', () => this._onE()),
      this.input.onPress('KeyF', () => stance(STANCES.NEUTRAL)),
      this.input.onPress('Digit1', () => this._castSlot(0)),
      this.input.onPress('Digit2', () => this._castSlot(1)),
      this.input.onPress('Digit3', () => this._castSlot(2)),
      this.input.onPress('Digit4', () => this._castSlot(3)),
    ];
  }

  // [E] is dual-use: Defensive stance, unless standing on a crowd drop (pickup),
  // or carrying one near your monster (deliver).
  _onE() {
    if (this.match.locked) return;
    const near = this._nearestDrop();
    if (this._carrying) { this._deliverDrop(); return; }
    if (near && near.d < 1.6) { this._pickupDrop(near.drop); return; }
    this.local.commandStance(STANCES.DEFENSIVE);
    this.overlay.showToast('Stance → DEFENSIVE (2s)', 900);
  }

  _castSlot(i) {
    if (this.match.locked || this._finished) return;
    const skillId = this.local.skillIds[i];
    if (skillId == null) return;
    const skill = getSkillById(skillId);
    if (!this.local.canCast(skillId)) { this.overlay.showToast(`${skill.name}: not ready`, 700); return; }
    if (this._windup) return; // one wind-up at a time
    if (skill.windup >= 0.8) {
      this._windup = { skillId, time: skill.windup };
      this.overlay.showToast(`${skill.name} — winding up…`, Math.round(skill.windup * 1000));
    } else {
      this._resolveSkill(skillId);
    }
  }

  _resolveSkill(skillId) {
    const skill = getSkillById(skillId);
    if (!this.local.canCast(skillId)) return;
    this.local.spendStamina(skill.stamina);
    this.local.startCooldown(skillId);
    // Range/aim is abstracted for the prototype: skills hit the foe monster.
    if (skill.damage > 0) {
      const dealt = this.match.dealDamage(this.foe, skill.damage, { isBasic: false });
      this.scene3d.flashHit('b');
      if (dealt > 0) this.overlay.showToast(`${skill.name} → ${dealt} dmg`, 800);
    } else {
      this.overlay.showToast(`${skill.name} (utility)`, 800);
    }
  }

  _trainerShove() {
    if (this._shoveCooldown > 0 || this.match.locked) return;
    // Prototype: shove affects the opposing monster if within range of aim.
    const toFoe = new THREE.Vector3(this.scene3d.bView.pos.x - this.controller.position.x, 0, this.scene3d.bView.pos.z - this.controller.position.z);
    if (toFoe.length() <= SHOVE_RANGE) {
      toFoe.normalize();
      this.scene3d.bView.pos.addScaledVector(toFoe, SHOVE_DISTANCE);
      this.overlay.showToast('Shoved!', 700);
      this._shoveCooldown = DebugConfig.get('shoveCooldownSeconds');
    } else {
      this.overlay.showToast('Nothing in shove range', 700);
    }
  }

  _nearestDrop() {
    let best = null, bestD = Infinity;
    for (const drop of this.scene3d.drops) {
      const d = Math.hypot(drop.mesh.position.x - this.controller.position.x, drop.mesh.position.z - this.controller.position.z);
      if (d < bestD) { bestD = d; best = drop; }
    }
    return best ? { drop: best, d: bestD } : null;
  }

  _pickupDrop(drop) {
    this._carrying = drop;
    drop.mesh.visible = false;
    this.overlay.showToast(`Picked up ${drop.kind} — deliver to your monster ([E] near it)`, 1500);
  }

  _deliverDrop() {
    const toMon = Math.hypot(this.scene3d.aView.pos.x - this.controller.position.x, this.scene3d.aView.pos.z - this.controller.position.z);
    if (toMon > 2.5) { this.overlay.showToast('Get closer to your monster to deliver', 900); return; }
    const kind = this._carrying.kind;
    if (kind === 'potion') { this.local.hp = Math.min(this.local.maxHp, this.local.hp + 40); this.overlay.showToast('Healed +40 HP', 1000); }
    else if (kind === 'adrenaline') { this.local.stamina = Math.min(this.local.maxStamina, this.local.stamina + 50); this.overlay.showToast('Stamina +50', 1000); }
    else if (kind === 'oil') { this.overlay.showToast('Oil delivered (hazard)', 1000); }
    this.scene3d.removeDrop(this._carrying);
    this._carrying = null;
  }

  _botThink(dt) {
    // IDLE profile (GDD §8): passive target dummy — no stance changes, no casts.
    if (DebugConfig.get('botBehaviorMode') === 'IDLE') return;
    // HUMANLIKE (minimal): stay offensive, cast ready damage skills on a cadence.
    this._botTimer -= dt;
    if (this.foe.stance !== STANCES.OFFENSIVE && this.foe.staminaFraction > 0.3) this.foe.commandStance(STANCES.OFFENSIVE);
    if (this.foe.staminaFraction < 0.3) this.foe.commandStance(STANCES.NEUTRAL);
    if (this._botTimer <= 0) {
      this._botTimer = 2.0;
      for (const id of this.foe.skillIds) {
        const s = getSkillById(id);
        if (s && s.damage > 0 && this.foe.canCast(id)) {
          this.foe.spendStamina(s.stamina); this.foe.startCooldown(id);
          const dealt = this.match.dealDamage(this.local, s.damage, { isBasic: false });
          if (dealt > 0) this.scene3d.flashHit('a');
          break;
        }
      }
    }
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.match.update(dt);
    this.controller.update(dt);

    // Countdown overlay (3·2·1·GO!)
    if (this.match.locked) {
      const n = Math.ceil(this.match.countdown);
      this.hud.showCountdown(String(n));
    } else if (this._prevCount !== 'go') {
      this.hud.showCountdown('GO!');
      this._prevCount = 'go';
      setTimeout(() => this.hud.showCountdown(''), 600);
    }

    if (!this.match.locked && this.match.state !== MATCH_STATE.ENDED) {
      // wind-up resolution
      if (this._windup) {
        this._windup.time -= dt;
        if (this._windup.time <= 0) { const id = this._windup.skillId; this._windup = null; this._resolveSkill(id); }
      }
      // LMB shove (edge-detect via input.mouse)
      if (this.input.mouse.left && this._shoveCooldown <= 0) this._trainerShove();
      this._shoveCooldown = Math.max(0, this._shoveCooldown - dt);

      // bot opponent
      this._botThink(dt);

      // crowd drops
      this._arenaDropTimer -= dt;
      if (this._arenaDropTimer <= 0) {
        this._arenaDropTimer = DebugConfig.get('arenaItemSpawnRate');
        const kinds = ['potion', 'adrenaline', 'oil'];
        this.scene3d.spawnDrop(kinds[Math.floor(Math.random() * kinds.length)]);
      }
    }

    // Monster steering + basic-attack events
    const events = this.scene3d.update(dt, this.match.locked);
    for (const ev of events) {
      if (ev.attacker === 'a') { const d = this.match.dealDamage(this.foe, this._basicDamage(this.local), { isBasic: true }); if (d > 0) this.scene3d.flashHit('b'); }
      else { const d = this.match.dealDamage(this.local, this._basicDamage(this.foe), { isBasic: true }); if (d > 0) this.scene3d.flashHit('a'); }
    }

    // HUD
    this.hud.setBars(this.local, this.foe);
    this.hud.setClock(this.match.clock, this.match.state === MATCH_STATE.SUDDEN_DEATH);
    this.hud.renderSkills(this.local.cooldowns);
    if (this._carrying) this.overlay.showPrompt(`Carrying <b>${this._carrying.kind}</b> — <b>[E]</b> near your monster to deliver`);
    else { const n = this._nearestDrop(); if (n && n.d < 1.6) this.overlay.showPrompt(`<b>[E]</b> pick up <b>${n.drop.kind}</b>`); else this.overlay.hidePrompt(); }

    this.renderer.render(this.scene3d.scene, this.camera);
  }

  _basicDamage(c) { return getSkillById(c.def.basicAttackSkillId)?.damage ?? 12; }

  _onEnd(result) {
    if (this._finished) return;
    this._finished = true;
    const won = result.winnerPlayerId === this.localPlayerId;
    this.hud.showEnd(won ? 'VICTORY' : 'DEFEAT', won ? `+${result.winReward} Gold` : `+${result.loseReward} Gold`);
    setTimeout(() => this.onComplete?.(result), 3000);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this._subs?.forEach((off) => off());
    this.controller.dispose();
    this.hud.dispose();
    this.overlay.dispose();
  }
}
