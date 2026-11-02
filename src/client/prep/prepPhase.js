/**
 * Preparation-phase controller (GDD §4). Drives the active-fighter Training
 * Cell experience: FPP look-around, crosshair totem targeting, world tooltip,
 * hold-[E] purchase, HUD, and the shared countdown. When prep completes it
 * invokes onComplete with the final loadout (→ arena slice, GDD §5).
 *
 * Spectators would instead get the Bookmaker's Den (BookmakerUI); in local
 * single-player prototype the human is always an active fighter.
 */
import * as THREE from 'three';
import { FppController } from '../engine/fppController.js';
import { PrepHud } from '../ui/prepHud.js';
import { WorldTooltip } from '../ui/worldTooltip.js';
import { Overlay } from '../ui/overlay.js';
import { TrainingCellScene } from './trainingCellScene.js';
import { markTotemPurchased } from '../models/totem.js';
import { PrepSession, PURCHASE_HOLD_SECONDS } from '../../shared/prepSession.js';
import { DebugConfig } from '../../shared/debugConfig.js';
import { botDraft } from '../../shared/bot.js';

export class PrepPhase {
  /**
   * @param {Object} ctx
   * @param {THREE.WebGLRenderer} ctx.renderer
   * @param {import('../engine/input.js').Input} ctx.input
   * @param {string} ctx.localPlayerId
   * @param {Array<{playerId:string, monsterId:string, seed?:number}>} ctx.fighters
   * @param {(result:object)=>void} ctx.onComplete
   */
  constructor({ renderer, input, localPlayerId, fighters, onComplete }) {
    this.renderer = renderer;
    this.input = input;
    this.localPlayerId = localPlayerId;
    this.onComplete = onComplete;

    this.session = new PrepSession({ fighters, onComplete: () => this._finish() });
    this.cell = this.session.getCell(localPlayerId);

    // Bots auto-draft their 4 skills immediately (GDD §8). IDLE bots skip
    // drafting (they're passive dummies) and rely on the arena's free-skill
    // fallback so the bout stays valid.
    for (const f of fighters) {
      if (f.playerId === localPlayerId) continue;
      const cell = this.session.getCell(f.playerId);
      if (DebugConfig.get('botBehaviorMode') !== 'IDLE') botDraft(cell);
    }

    this.scene3d = new TrainingCellScene(this.cell);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 100);
    this.controller = new FppController(this.camera, input, renderer.domElement, {
      x: 0, z: 6, eyeHeight: 1.6, boundaryRadius: 9, speed: 3.5,
    });

    this.hud = new PrepHud();
    this.tooltip = new WorldTooltip();
    this.overlay = new Overlay();

    this.hud.setGold(this.cell.gold);
    this.hud.renderSlots(this.cell.loadout());

    this._aimedIndex = -1;
    this._holdStart = 0;
    this._finished = false;
    this.clock = new THREE.Clock();

    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if (!this._finished) this.session.update(dt);
    this.controller.update(dt);
    this.scene3d.update(dt, t);
    this.hud.setTime(this.session.timeLeft, this.session.progress);

    // crosshair totem targeting
    const hit = this.scene3d.totemUnderCrosshair(this.camera);
    if (hit && !this.cell.totems[hit.index].purchased) {
      const entry = this.cell.totems[hit.index];
      const effCost = this.cell.costOf(entry.skill);
      this.tooltip.show(entry.skill, effCost);
      this.tooltip.track(hit.totem.userData.anchor, this.camera);

      // hold-[E] purchase
      if (this.input.isDown('KeyE')) {
        if (this._aimedIndex !== hit.index) { this._aimedIndex = hit.index; this._holdStart = t; }
        const held = t - this._holdStart;
        if (this.cell.canPurchase(hit.index)) {
          this.tooltip.setHoldProgress(held / PURCHASE_HOLD_SECONDS);
          if (held >= PURCHASE_HOLD_SECONDS) this._completePurchase(hit);
        } else {
          this.tooltip.setHoldProgress(0);
          this.tooltip.setUnavailable(this._reason(hit.index));
        }
      } else {
        this._aimedIndex = -1;
        this.tooltip.setHoldProgress(0);
      }
    } else {
      this.tooltip.hide();
      this._aimedIndex = -1;
    }

    this.renderer.render(this.scene3d.scene, this.camera);
  }

  /** Debug/QA: make every fighter READY (cheapest-first) so prep completes. */
  debugForceReady() {
    for (const cell of this.session.cells.values()) {
      while (!cell.isReady) {
        let best = -1, bc = Infinity;
        cell.totems.forEach((t, i) => { if (cell.canPurchase(i) && t.skill.cost < bc) { best = i; bc = t.skill.cost; } });
        if (best < 0) break;
        cell.purchase(best);
      }
    }
    this.hud.setGold(this.cell.gold);
    this.hud.renderSlots(this.cell.loadout());
    this.hud.setReady(this.cell.isReady);
  }

  /** Debug/QA: purchase totem i directly (bypasses aim+hold). Returns slot. */
  debugBuy(i) {
    if (!this.cell.canPurchase(i)) return -1;
    this._completePurchase({ index: i });
    return this.cell.slots.findIndex((s) => s === this.cell.totems[i].skill.id);
  }

  _reason(i) {
    if (this.cell.firstEmptySlot === -1) return 'All 4 skill slots are full';
    const t = this.cell.totems[i];
    if (this.cell.gold < this.cell.costOf(t.skill)) return 'Not enough gold';
    return 'Unavailable';
  }

  _completePurchase(hit) {
    const slot = this.cell.purchase(hit.index);
    if (slot < 0) return;
    this.scene3d.totems[hit.index].userData.purchased = true;
    markTotemPurchased(this.scene3d.totems[hit.index]);
    this.hud.setGold(this.cell.gold);
    this.hud.renderSlots(this.cell.loadout());
    this.overlay.showToast(`Learned ${this.cell.totems[hit.index].skill.name} → slot [${slot + 1}]`);
    this.tooltip.setHoldProgress(0);
    this._aimedIndex = -1;
    if (this.cell.isReady) {
      this.hud.setReady(true);
      this.overlay.showToast('READY — all 4 skills locked in');
    }
  }

  _finish() {
    if (this._finished) return;
    this._finished = true;
    const result = {
      loadoutByPlayer: Object.fromEntries(
        [...this.session.cells].map(([id, c]) => [id, c.slots.filter((s) => s != null)])
      ),
      localLoadout: this.cell.slots.filter((s) => s != null),
    };
    setTimeout(() => this.onComplete?.(result), 400);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.controller.dispose();
    this.hud.dispose();
    this.tooltip.dispose();
    this.overlay.dispose();
  }
}
