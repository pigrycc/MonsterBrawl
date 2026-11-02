/**
 * Preparation-phase HUD (GDD §4A): synchronized countdown bar, gold wallet,
 * the 4 skill slots [1]-[4], and a READY banner. Plain DOM over the canvas.
 */
const STYLE_ID = 'mcb-prephud-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-prep-top{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:25;
      display:flex;flex-direction:column;align-items:center;gap:6px;font:13px system-ui,sans-serif;color:#e8ecf3;}
    .mcb-prep-timer{width:420px;height:10px;background:#1a2233;border:1px solid #2b3448;border-radius:6px;overflow:hidden;}
    .mcb-prep-timer > i{display:block;height:100%;background:linear-gradient(90deg,#ffd966,#ff8c42);transition:width .1s linear;}
    .mcb-prep-label{font-weight:700;letter-spacing:.5px;}
    .mcb-prep-gold{color:#ffd966;}
    .mcb-slots{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:25;display:flex;gap:10px;}
    .mcb-slot{width:96px;height:72px;background:rgba(14,18,28,.9);border:1px solid #2b3448;border-radius:10px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;position:relative;}
    .mcb-slot .key{position:absolute;top:4px;left:6px;font-size:11px;color:#8aa0c8;}
    .mcb-slot .nm{font-size:12px;font-weight:600;text-align:center;padding:0 4px;}
    .mcb-slot .meta{font-size:10px;color:#8aa0c8;}
    .mcb-slot.empty .nm{color:#55607a;}
    .mcb-slot.filled{border-color:#4a7;}
    .mcb-ready{position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:26;
      padding:6px 18px;background:#2e7d32;color:#fff;font-weight:800;letter-spacing:1px;border-radius:20px;
      font:14px system-ui,sans-serif;display:none;}
    .mcb-elem{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;}
  `;
  document.head.appendChild(s);
}

const ELEMENT_COLORS = {
  Neutral: '#b9c2d0', Fire: '#ff6b3d', Water: '#3fa7ff', Earth: '#b98a4a',
  Electric: '#ffd633', Flying: '#9fd0ff', Grass: '#5fd36a',
};

export class PrepHud {
  constructor() {
    ensureStyle();
    this.top = document.createElement('div');
    this.top.className = 'mcb-prep-top';
    this.top.innerHTML = `
      <div class="mcb-prep-label">PREPARATION — <span data-t>60.0</span>s · <span class="mcb-prep-gold"><span data-g>50</span>g</span></div>
      <div class="mcb-prep-timer"><i data-bar style="width:100%"></i></div>`;
    this.slotsEl = document.createElement('div');
    this.slotsEl.className = 'mcb-slots';
    this.ready = document.createElement('div');
    this.ready.className = 'mcb-ready';
    this.ready.textContent = 'READY';
    document.body.append(this.top, this.slotsEl, this.ready);
    this.renderSlots([null, null, null, null]);
  }

  setTime(timeLeft, progress) {
    this.top.querySelector('[data-t]').textContent = timeLeft.toFixed(1);
    this.top.querySelector('[data-bar]').style.width = `${Math.max(0, progress) * 100}%`;
  }

  setGold(g) { this.top.querySelector('[data-g]').textContent = g; }

  /** @param {(import('../../shared/skills.js').Skill|null)[]} loadout */
  renderSlots(loadout) {
    this.slotsEl.innerHTML = loadout.map((s, i) => {
      const key = i + 1;
      if (!s) return `<div class="mcb-slot empty"><span class="key">[${key}]</span><span class="nm">—</span></div>`;
      const c = ELEMENT_COLORS[s.element] || '#b9c2d0';
      return `<div class="mcb-slot filled"><span class="key">[${key}]</span>
        <span class="nm"><span class="mcb-elem" style="background:${c}"></span>${s.name}</span>
        <span class="meta">CD ${s.cooldown}s · ${s.damage ? s.damage + ' dmg' : 'util'}</span></div>`;
    }).join('');
  }

  setReady(isReady) { this.ready.style.display = isReady ? 'block' : 'none'; }

  dispose() { this.top.remove(); this.slotsEl.remove(); this.ready.remove(); }
}
