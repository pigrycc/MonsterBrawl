/**
 * Arena combat HUD (GDD §5): both monsters' HP + stamina bars, the match clock
 * (with Sudden Death state), the 4 skill slots with cooldown clocks, current
 * stance (+ pending-stance delay), and the big 3-2-1-GO! countdown overlay.
 */
const STYLE_ID = 'mcb-arena-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-ar-bars{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:25;display:flex;gap:40px;
      font:12px system-ui,sans-serif;color:#e8ecf3;align-items:flex-start;}
    .mcb-ar-side{width:280px;}
    .mcb-ar-series{align-self:center;font:800 20px ui-monospace,monospace;color:#ffd966;
      background:rgba(14,18,28,.85);border:1px solid #2b3448;border-radius:8px;padding:4px 12px;
      letter-spacing:1px;white-space:nowrap;text-shadow:0 2px 6px #000;}
    .mcb-ar-series .bo3{display:block;font:600 9px system-ui,sans-serif;color:#8aa0c8;text-align:center;letter-spacing:0;}
    .mcb-ar-side.right{text-align:right;}
    .mcb-ar-name{font-weight:700;margin-bottom:3px;}
    .mcb-ar-bar{height:12px;background:#1a2233;border:1px solid #2b3448;border-radius:6px;overflow:hidden;margin-bottom:3px;}
    .mcb-ar-bar > i{display:block;height:100%;transition:width .12s linear;}
    .mcb-ar-hp > i{background:linear-gradient(90deg,#ef4444,#f59e0b);}
    .mcb-ar-stam > i{background:linear-gradient(90deg,#38bdf8,#22d3ee);}
    .mcb-ar-stance{font-size:11px;color:#8aa0c8;}
    .mcb-ar-clock{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:26;
      font:800 22px system-ui,sans-serif;color:#fff;text-shadow:0 2px 8px #000;letter-spacing:1px;}
    .mcb-ar-clock.sd{color:#ff5555;animation:mcbpulse 1s infinite;}
    @keyframes mcbpulse{50%{opacity:.5;}}
    .mcb-ar-skills{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:25;display:flex;gap:10px;}
    .mcb-ar-skill{width:92px;height:66px;background:rgba(14,18,28,.92);border:1px solid #2b3448;border-radius:10px;
      position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;}
    .mcb-ar-skill .key{position:absolute;top:3px;left:5px;font-size:11px;color:#8aa0c8;}
    .mcb-ar-skill .nm{font-size:11px;font-weight:600;text-align:center;padding:0 3px;}
    .mcb-ar-skill .cd{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;
      font:700 18px system-ui,sans-serif;color:#fff;}
    .mcb-ar-skill.ready{border-color:#4ade80;}
    .mcb-ar-stancekeys{position:fixed;bottom:92px;left:50%;transform:translateX(-50%);z-index:25;
      font:12px system-ui,sans-serif;color:#8aa0c8;background:rgba(14,18,28,.7);border:1px solid #2b3448;
      border-radius:8px;padding:6px 12px;}
    .mcb-ar-stancekeys b{color:#ffd966;}
    .mcb-count{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;
      font:900 120px system-ui,sans-serif;color:#fff;text-shadow:0 4px 24px #000;pointer-events:none;}
    .mcb-end{position:fixed;inset:0;z-index:45;display:none;flex-direction:column;align-items:center;justify-content:center;
      background:rgba(6,8,14,.82);color:#fff;font:system-ui,sans-serif;gap:10px;}
    .mcb-end h1{font-size:48px;margin:0;}
    .mcb-end .sub{color:#ffd966;font-size:18px;}
  `;
  document.head.appendChild(s);
}

const ELEMENT_COLORS = {
  Neutral: '#b9c2d0', Fire: '#ff6b3d', Water: '#3fa7ff', Earth: '#b98a4a',
  Electric: '#ffd633', Flying: '#9fd0ff', Grass: '#5fd36a',
};

export class ArenaHud {
  /**
   * @param {Object} o
   * @param {{name:string}} o.left   local monster (bars on the left)
   * @param {{name:string}} o.right  opponent
   * @param {(import('../../shared/skills.js').Skill|null)[]} o.skills local loadout
   */
  constructor({ left, right, skills }) {
    ensureStyle();
    this.bars = document.createElement('div');
    this.bars.className = 'mcb-ar-bars';
    this.bars.innerHTML = `
      <div class="mcb-ar-side left">
        <div class="mcb-ar-name">${left.name} (You)</div>
        <div class="mcb-ar-bar mcb-ar-hp"><i data-lhp style="width:100%"></i></div>
        <div class="mcb-ar-bar mcb-ar-stam"><i data-lstam style="width:100%"></i></div>
        <div class="mcb-ar-stance" data-lstance>Neutral</div>
      </div>
      <div class="mcb-ar-series" data-series title="Best of 3">0 - 0<span class="bo3">BEST OF 3</span></div>
      <div class="mcb-ar-side right">
        <div class="mcb-ar-name">${right.name}</div>
        <div class="mcb-ar-bar mcb-ar-hp"><i data-rhp style="width:100%"></i></div>
        <div class="mcb-ar-bar mcb-ar-stam"><i data-rstam style="width:100%"></i></div>
        <div class="mcb-ar-stance" data-rstance>Neutral</div>
      </div>`;
    this.clock = document.createElement('div');
    this.clock.className = 'mcb-ar-clock';
    this.skillsEl = document.createElement('div');
    this.skillsEl.className = 'mcb-ar-skills';
    this.stanceKeys = document.createElement('div');
    this.stanceKeys.className = 'mcb-ar-stancekeys';
    this.stanceKeys.innerHTML = `Stance: <b>[Q]</b> Offensive · <b>[E]</b> Defensive · <b>[F]</b> Rest · <b>[1–4]</b> Skills · <b>LMB</b> Move · <b>RMB</b> Shove`;

    // #4 Net status line (ping) — only shown in networked play.
    this.netStatus = document.createElement('div');
    this.netStatus.style.cssText = 'position:fixed;top:12px;right:14px;z-index:26;font:12px ui-monospace,monospace;color:#7fd38b;background:rgba(14,18,28,.7);border:1px solid #2b3448;border-radius:6px;padding:4px 10px;display:none;';
    document.body.appendChild(this.netStatus);

    // #2 Local trainer HP bar (bottom-left, by the book).
    this.trainerHp = document.createElement('div');
    this.trainerHp.style.cssText = 'position:fixed;left:16px;bottom:52px;z-index:25;width:200px;font:12px system-ui,sans-serif;color:#e8ecf3;';
    this.trainerHp.innerHTML = `<div style="margin-bottom:3px">🧍 Trainer</div>
      <div style="height:12px;background:#1a2233;border:1px solid #2b3448;border-radius:6px;overflow:hidden">
        <i data-thp style="display:block;height:100%;width:100%;background:linear-gradient(90deg,#39d98a,#8fe)"></i></div>`;
    document.body.appendChild(this.trainerHp);
    this.count = document.createElement('div');
    this.count.className = 'mcb-count';
    this.end = document.createElement('div');
    this.end.className = 'mcb-end';

    this.skills = skills;
    document.body.append(this.bars, this.clock, this.skillsEl, this.stanceKeys, this.count, this.end);
    this.renderSkills(new Map());
  }

  setBars(l, r) {
    this.bars.querySelector('[data-lhp]').style.width = `${(l.hp / l.maxHp) * 100}%`;
    this.bars.querySelector('[data-lstam]').style.width = `${(l.stamina / l.maxStamina) * 100}%`;
    this.bars.querySelector('[data-rhp]').style.width = `${(r.hp / r.maxHp) * 100}%`;
    this.bars.querySelector('[data-rstam]').style.width = `${(r.stamina / r.maxStamina) * 100}%`;
    this._stance(this.bars.querySelector('[data-lstance]'), l);
    this._stance(this.bars.querySelector('[data-rstance]'), r);
  }

  _stance(el, c) {
    const cd = c.stanceCooldownRemaining > 0 ? ` (switch in ${c.stanceCooldownRemaining.toFixed(1)}s)` : '';
    const stun = c.isStunned ? ' · STUNNED' : '';
    const conf = c.isConfused ? ' · CONFUSED' : '';
    el.textContent = `${c.stance}${cd}${stun}${conf}`;
  }

  setClock(seconds, suddenDeath) {
    if (suddenDeath) { this.clock.textContent = 'SUDDEN DEATH'; this.clock.classList.add('sd'); return; }
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    this.clock.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  showCountdown(text) { this.count.textContent = text; this.count.style.display = text ? 'flex' : 'none'; }

  /** @param {Map<number,number>} cooldowns skillId → seconds left */
  renderSkills(cooldowns) {
    this.skillsEl.innerHTML = this.skills.map((s, i) => {
      const key = i + 1;
      if (!s) return `<div class="mcb-ar-skill"><span class="key">[${key}]</span><span class="nm">—</span></div>`;
      const cd = cooldowns.get(s.id) ?? 0;
      const c = ELEMENT_COLORS[s.element] || '#b9c2d0';
      const cdOverlay = cd > 0 ? `<div class="cd">${cd.toFixed(1)}</div>` : '';
      return `<div class="mcb-ar-skill ${cd > 0 ? '' : 'ready'}">
        <span class="key">[${key}]</span>
        <span class="nm" style="color:${c}">${s.name}</span>${cdOverlay}</div>`;
    }).join('');
  }

  showEnd(title, sub) {
    this.end.innerHTML = `<h1>${title}</h1><div class="sub">${sub}</div><div style="color:#8aa0c8;font-size:13px">Returning to lobby…</div>`;
    this.end.style.display = 'flex';
  }

  /** #1 Hide the end/round banner (used between Bo3 rounds). */
  hideEnd() { this.end.style.display = 'none'; }

  /** #1 Best-of-3 score tracker near the HP bars, e.g. "1 - 0". */
  setSeriesScore(winsA, winsB) {
    const el = this.bars.querySelector('[data-series]');
    if (el) el.innerHTML = `${winsA} - ${winsB}<span class="bo3">BEST OF 3</span>`;
  }

  /** #2 Update the local trainer HP bar (0..1). */
  setTrainerHp(frac) {
    const bar = this.trainerHp.querySelector('[data-thp]');
    bar.style.width = `${Math.max(0, frac) * 100}%`;
    bar.style.background = frac > 0.3 ? 'linear-gradient(90deg,#39d98a,#8fe)' : 'linear-gradient(90deg,#ef4444,#f59e0b)';
  }

  /** #4 Show/update the net status (ping ms). Call with null to hide. */
  setNetStatus(pingMs) {
    if (pingMs == null) { this.netStatus.style.display = 'none'; return; }
    const color = pingMs < 60 ? '#7fd38b' : pingMs < 150 ? '#ffd966' : '#ff6b6b';
    this.netStatus.style.display = 'block';
    this.netStatus.style.color = color;
    this.netStatus.textContent = `NET ${pingMs}ms`;
  }

  dispose() { [this.bars, this.clock, this.skillsEl, this.stanceKeys, this.count, this.end, this.netStatus, this.trainerHp].forEach((e) => e.remove()); }
}
