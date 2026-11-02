/**
 * World-space 3D tooltip for skill totems (GDD §4A). A DOM panel positioned by
 * projecting a 3D anchor to screen space each frame. Shows the full skill card:
 * name, gold cost, cooldown, damage/effect, element, and the slapstick penalty.
 *
 * Also renders a radial purchase-progress ring while the player holds [E].
 */
import * as THREE from 'three';

const STYLE_ID = 'mcb-tooltip-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-tt{position:fixed;z-index:24;min-width:220px;max-width:280px;transform:translate(-50%,-110%);
      background:rgba(10,14,22,.95);border:1px solid #2b3448;border-radius:10px;padding:10px 12px;
      font:12px system-ui,sans-serif;color:#e8ecf3;pointer-events:none;display:none;box-shadow:0 6px 24px rgba(0,0,0,.5);}
    .mcb-tt h4{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:6px;}
    .mcb-tt .el{font-size:10px;padding:1px 6px;border-radius:8px;color:#0a0c12;font-weight:700;}
    .mcb-tt .grid{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:4px 0;}
    .mcb-tt .k{color:#8aa0c8;}
    .mcb-tt .slap{margin-top:6px;padding-top:6px;border-top:1px solid #2b3448;color:#ffcf99;font-style:italic;}
    .mcb-tt .cost{color:#ffd966;font-weight:700;}
    .mcb-tt .ring{margin-top:8px;height:6px;background:#1a2233;border-radius:4px;overflow:hidden;display:none;}
    .mcb-tt .ring > i{display:block;height:100%;width:0;background:#4ade80;}
    .mcb-tt .hint{margin-top:6px;color:#8aa0c8;font-size:11px;}
  `;
  document.head.appendChild(s);
}

const ELEMENT_COLORS = {
  Neutral: '#b9c2d0', Fire: '#ff6b3d', Water: '#3fa7ff', Earth: '#b98a4a',
  Electric: '#ffd633', Flying: '#9fd0ff', Grass: '#5fd36a',
};

export class WorldTooltip {
  constructor() {
    ensureStyle();
    this.el = document.createElement('div');
    this.el.className = 'mcb-tt';
    document.body.appendChild(this.el);
    this._v = new THREE.Vector3();
    this.currentSkillId = null;
  }

  /** @param {import('../../shared/skills.js').Skill} skill @param {number} effectiveCost */
  show(skill, effectiveCost) {
    if (this.currentSkillId !== skill.id) {
      const c = ELEMENT_COLORS[skill.element] || '#b9c2d0';
      const effect = skill.damage > 0 ? `${skill.damage} dmg` : '(utility)';
      this.el.innerHTML = `
        <h4>${skill.name} <span class="el" style="background:${c}">${skill.element}</span></h4>
        <div class="grid">
          <span class="k">Cost</span><span class="cost">${effectiveCost} gold</span>
          <span class="k">Cooldown</span><span>${skill.cooldown}s</span>
          <span class="k">Wind-up</span><span>${skill.windup}s</span>
          <span class="k">Effect</span><span>${effect}</span>
          <span class="k">Stamina</span><span>${skill.stamina}</span>
          <span class="k">Target</span><span>${skill.targetType.replace(/_/g, ' ')}</span>
        </div>
        <div class="slap">🎭 ${skill.slapstick}</div>
        <div class="ring"><i></i></div>
        <div class="hint">Hold <b>[E]</b> 1.0s to buy</div>`;
      this.currentSkillId = skill.id;
      this.ring = this.el.querySelector('.ring');
      this.ringFill = this.el.querySelector('.ring > i');
      this.hint = this.el.querySelector('.hint');
    }
    this.el.style.display = 'block';
  }

  /** @param {number} p 0..1 hold progress; <=0 hides the ring */
  setHoldProgress(p) {
    if (!this.ring) return;
    if (p > 0) { this.ring.style.display = 'block'; this.ringFill.style.width = `${Math.min(1, p) * 100}%`; }
    else { this.ring.style.display = 'none'; this.ringFill.style.width = '0'; }
  }

  setUnavailable(reason) {
    if (this.hint) this.hint.innerHTML = reason;
  }

  /** Project a world anchor to screen and move the tooltip there. */
  track(anchor, camera) {
    this._v.copy(anchor).project(camera);
    const x = (this._v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this._v.y * 0.5 + 0.5) * window.innerHeight;
    const behind = this._v.z > 1;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.visibility = behind ? 'hidden' : 'visible';
  }

  hide() { this.el.style.display = 'none'; this.currentSkillId = null; }
  dispose() { this.el.remove(); }
}
