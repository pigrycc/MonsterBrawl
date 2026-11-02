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
import { botChooseStance, botChooseSkill } from '../../shared/bot.js';
import { THROWABLES, THROWABLE_INFO, applyThrowable, randomThrowable } from '../../shared/throwables.js';
import { resolveCast } from '../../shared/slapstick.js';
import { SFX } from '../audio/sfx.js';

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

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 160);
    this.controller = new FppController(this.camera, input, renderer.domElement, {
      x: -10, z: 12, eyeHeight: 1.7, boundaryRadius: this.scene3d.arenaRadius - 1, speed: 6.0,
    });
    this._buildViewmodel(); // #3 first-person pointing hand

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
    const stance = (s) => {
      if (this.match.locked) return;
      if (this.local.commandStance(s)) this.overlay.showToast(`Stance → ${s}`, 800);
      else if (this.local.stanceCooldownRemaining > 0) this.overlay.showToast(`Stance on cooldown (${this.local.stanceCooldownRemaining.toFixed(1)}s)`, 700);
    };
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
    if (this.local.commandStance(STANCES.DEFENSIVE)) this.overlay.showToast('Stance → DEFENSIVE', 800);
    else if (this.local.stanceCooldownRemaining > 0) this.overlay.showToast(`Stance on cooldown (${this.local.stanceCooldownRemaining.toFixed(1)}s)`, 700);
  }

  // #3 First-person pointing viewmodel: a simple arm + pointing hand parented
  // to the camera, lowered at rest, thrust forward (index finger out) on cast.
  _buildViewmodel() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0ac86, flatShading: true, roughness: 0.8 });
    const vm = new THREE.Group();
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 6), skin);
    forearm.rotation.x = Math.PI / 2; forearm.position.set(0, 0, -0.25);
    const fist = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), skin);
    fist.position.set(0, 0, -0.5);
    const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 5), skin);
    finger.rotation.x = Math.PI / 2; finger.position.set(0, 0.02, -0.66);
    vm.add(forearm, fist, finger);
    // Rest pose: lowered to the bottom-right of the view, tucked back.
    vm.position.set(0.35, -0.42, -0.5);
    vm.rotation.set(0.5, 0, 0);
    this.camera.add(vm);
    // Ensure the camera (hence the viewmodel) is in the rendered scene graph.
    this.scene3d.scene.add(this.camera);
    this.viewmodel = vm;
    this._vmRest = { pos: vm.position.clone(), rot: vm.rotation.clone() };
    this._vmPoint = 0; // 0..1 gesture progress
  }

  _triggerPointGesture() { this._vmPoint = 1; } // decays over time in update()

  _updateViewmodel(dt) {
    if (!this.viewmodel) return;
    this._vmPoint = Math.max(0, this._vmPoint - dt * 3.5); // ~0.3s return
    const p = this._easeOutBack(this._vmPoint);
    const rest = this._vmRest;
    // Thrust forward + raise toward center, index finger leading.
    this.viewmodel.position.set(
      rest.pos.x - 0.22 * p,
      rest.pos.y + 0.34 * p,
      rest.pos.z - 0.28 * p
    );
    this.viewmodel.rotation.set(rest.rot.x - 0.5 * p, rest.rot.y, rest.rot.z);
  }

  _easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return x <= 0 ? 0 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

  _castSlot(i) {
    if (this.match.locked || this._finished) return;
    const skillId = this.local.skillIds[i];
    if (skillId == null) return;
    const skill = getSkillById(skillId);
    if (!this.local.canCast(skillId)) { this.overlay.showToast(`${skill.name}: not ready`, 700); return; }
    this._triggerPointGesture(); // #3 point on command
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

    // #3 Range-based hit/miss. A miss triggers the skill's slapstick reaction
    // on the caster's own monster (GDD §10 slapstick column).
    const dist = Math.hypot(this.scene3d.bView.pos.x - this.scene3d.aView.pos.x, this.scene3d.bView.pos.z - this.scene3d.aView.pos.z);
    const { hit, reaction } = resolveCast(skillId, dist);

    if (skill.damage > 0) {
      if (hit) {
        const dealt = this.match.dealDamage(this.foe, skill.damage, { isBasic: false });
        this.scene3d.flashHit('b');
        if (dealt > 0) { SFX.impact(Math.min(1, skill.damage / 50)); this.overlay.showToast(`${skill.name} → ${dealt} dmg`, 800); }
      } else {
        this.scene3d.playReaction('a', reaction);
        this.overlay.showToast(`${skill.name} MISSED! (${skill.slapstick})`, 1600);
      }
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
      this.scene3d.knockback('b', { x: toFoe.x, z: toFoe.z }, SHOVE_DISTANCE); // #1 real impulse
      SFX.impact(0.5);
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

    // HUMANLIKE (GDD §8): stance by stamina/HP advantage, cast in range, chase
    // drops, shove the player when adjacent.
    this.foe.commandStance(botChooseStance(this.foe, this.local));

    // Distance between the two monsters (used for skill range).
    const dist = Math.hypot(this.scene3d.bView.pos.x - this.scene3d.aView.pos.x, this.scene3d.bView.pos.z - this.scene3d.aView.pos.z);

    this._botTimer -= dt;
    if (this._botTimer <= 0) {
      const skillId = botChooseSkill(this.foe, dist, 6);
      if (skillId != null) {
        const s = getSkillById(skillId);
        this.foe.spendStamina(s.stamina); this.foe.startCooldown(skillId);
        this._botTimer = 1.5;
        if (s.damage > 0) {
          const dealt = this.match.dealDamage(this.local, s.damage, { isBasic: false });
          if (dealt > 0) { this.scene3d.flashHit('a'); SFX.hurt(); }
        }
      } else {
        this._botTimer = 0.5; // re-check soon
      }
    }

    // Bot trainer chases the nearest drop and "delivers" it to its monster.
    this._botDrop(dt);

    // Bot trainer shoves the player's monster when adjacent (GDD §8).
    this._botShoveTimer = Math.max(0, (this._botShoveTimer ?? 0) - dt);
    const botToPlayerMon = Math.hypot(this.scene3d.aView.pos.x - this._botTrainerPos().x, this.scene3d.aView.pos.z - this._botTrainerPos().z);
    if (this._botShoveTimer === 0 && botToPlayerMon < 3.5) {
      const dir = new THREE.Vector3(this.scene3d.aView.pos.x - this.scene3d.bView.pos.x, 0, this.scene3d.aView.pos.z - this.scene3d.bView.pos.z);
      if (dir.lengthSq() > 0) { dir.normalize(); this.scene3d.knockback('a', { x: dir.x, z: dir.z }, 4); } // #1 impulse
      this._botShoveTimer = DebugConfig.get('shoveCooldownSeconds');
    }
  }

  /** A stand-in position for the bot trainer: just behind its monster. */
  _botTrainerPos() {
    return { x: this.scene3d.bView.pos.x, z: this.scene3d.bView.pos.z + 1.5 };
  }

  /** Bot collects crowd drops and applies the buff to its own monster. */
  _botDrop(dt) {
    if (this.scene3d.drops.length === 0) return;
    // Grab the nearest drop if the bot "reaches" it (simple timed approach).
    const bp = this._botTrainerPos();
    let nearest = null, nd = Infinity;
    for (const d of this.scene3d.drops) {
      const dd = Math.hypot(d.mesh.position.x - bp.x, d.mesh.position.z - bp.z);
      if (dd < nd) { nd = dd; nearest = d; }
    }
    // Drift the bot monster toward the drop a touch (abstracted collection),
    // then consume when close.
    if (nearest && nd < 2.0) {
      if (nearest.kind === 'potion') this.foe.hp = Math.min(this.foe.maxHp, this.foe.hp + 40);
      else if (nearest.kind === 'adrenaline') this.foe.stamina = Math.min(this.foe.maxStamina, this.foe.stamina + 50);
      this.scene3d.removeDrop(nearest);
    }
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.match.update(dt);
    this.controller.update(dt);
    this._updateViewmodel(dt); // #3 pointing-hand animation

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

      // Spectators in the stands lob throwables onto the arena (GDD §6). In
      // the local prototype the "crowd" does this automatically on the
      // spectatorItemSpawnRate cadence; in multiplayer these are driven by
      // actual spectator inputs relayed through the host.
      this._specTimer = (this._specTimer ?? DebugConfig.get('spectatorItemSpawnRate')) - dt;
      if (this._specTimer <= 0) {
        this._specTimer = DebugConfig.get('spectatorItemSpawnRate');
        this._spawnSpectatorThrow();
      }
    }

    // Monster steering + basic-attack events + landed spectator throwables
    const { events, landed } = this.scene3d.update(dt, this.match.locked);
    for (const ev of events) {
      if (ev.attacker === 'a') { const d = this.match.dealDamage(this.foe, this._basicDamage(this.local), { isBasic: true }); if (d > 0) { this.scene3d.flashHit('b'); SFX.impact(0.4); } }
      else { const d = this.match.dealDamage(this.local, this._basicDamage(this.foe), { isBasic: true }); if (d > 0) { this.scene3d.flashHit('a'); SFX.hurt(); } }
    }
    for (const l of landed) this._resolveThrowLanding(l);

    // HUD
    this.hud.setBars(this.local, this.foe);
    this.hud.setClock(this.match.clock, this.match.state === MATCH_STATE.SUDDEN_DEATH);
    this.hud.renderSkills(this.local.cooldowns);
    if (this._carrying) this.overlay.showPrompt(`Carrying <b>${this._carrying.kind}</b> — <b>[E]</b> near your monster to deliver`);
    else { const n = this._nearestDrop(); if (n && n.d < 1.6) this.overlay.showPrompt(`<b>[E]</b> pick up <b>${n.drop.kind}</b>`); else this.overlay.hidePrompt(); }

    this.renderer.render(this.scene3d.scene, this.camera);
  }

  _basicDamage(c) { return getSkillById(c.def.basicAttackSkillId)?.damage ?? 12; }

  /** A spectator lobs a throwable aimed near one of the monsters (GDD §6). */
  _spawnSpectatorThrow() {
    const kind = randomThrowable();
    const info = THROWABLE_INFO[kind];
    // Aim near a random monster with some scatter (spectators aren't precise).
    const targetMon = Math.random() < 0.5 ? this.scene3d.aView : this.scene3d.bView;
    const tp = new THREE.Vector3(
      targetMon.pos.x + (Math.random() - 0.5) * 3,
      0.3,
      targetMon.pos.z + (Math.random() - 0.5) * 3
    );
    const proj = this.scene3d.spawnThrowable(info.color, tp);
    proj.kind = kind;
    this.overlay.showToast(`Crowd throws a ${info.name}!`, 900);
  }

  /** Resolve a landed throwable against whichever monster is nearby. */
  _resolveThrowLanding(landing) {
    // Find the projectile kind by proximity (the scene removed the mesh, so the
    // kind rode on the landing via the nearest projectile — fall back random).
    const kind = landing.kind ?? this._lastThrowKind ?? THROWABLES.STONE;
    const da = Math.hypot(landing.pos.x - this.scene3d.aView.pos.x, landing.pos.z - this.scene3d.aView.pos.z);
    const db = Math.hypot(landing.pos.x - this.scene3d.bView.pos.x, landing.pos.z - this.scene3d.bView.pos.z);
    const hitRadius = 2.0;
    let target = null, which = null;
    if (da <= hitRadius && da <= db) { target = this.local; which = 'a'; }
    else if (db <= hitRadius) { target = this.foe; which = 'b'; }
    if (!target) return; // landed on empty sand
    const res = applyThrowable(kind, target, { isMonster: true });
    if (res) {
      this.scene3d.flashHit(which);
      this.overlay.showToast(`${THROWABLE_INFO[kind].name} hits ${target.def.name}: ${res.effect}!`, 1100);
    }
  }

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
    this.scene3d.dispose?.(); // #1 free the Rapier world
  }
}
