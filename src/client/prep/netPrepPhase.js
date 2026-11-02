/**
 * Networked preparation phase (#1). In a host-authoritative session the server
 * runs the real PrepSession and streams each client its own training cell via
 * PREP_SNAPSHOT. This phase renders those snapshots as a simple draft board
 * (6 totem cards + 4 slots + shared timer) and sends buy intents (prepBuy).
 *
 * Deliberately a 2D board rather than the full 3D training cell: the 3D aim +
 * hold-to-buy needs the local sim, but in synced play the HOST is authoritative
 * — so the client just picks totems and the server resolves purchases. When the
 * server broadcasts PREP_END, the app transitions to the synced arena.
 */
const STYLE_ID = 'mcb-netprep-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-np{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:18px;background:radial-gradient(circle at 50% 30%,#141b2b,#07090e);
      font:14px system-ui,sans-serif;color:#e8ecf3;}
    .mcb-np h2{margin:0;font-size:20px;}
    .mcb-np .timer{font-weight:800;color:#ffd966;font-size:16px;}
    .mcb-np .totems{display:grid;grid-template-columns:repeat(3,200px);gap:12px;}
    .mcb-np .totem{background:rgba(14,18,28,.92);border:1px solid #2b3448;border-radius:12px;padding:12px;}
    .mcb-np .totem.bought{opacity:.45;}
    .mcb-np .totem b{display:block;margin-bottom:4px;}
    .mcb-np .totem .el{font-size:11px;padding:1px 6px;border-radius:8px;color:#0a0c12;font-weight:700;}
    .mcb-np .totem .cost{color:#ffd966;margin:6px 0;}
    .mcb-np .totem button{width:100%;padding:7px;border:none;border-radius:7px;background:#2e7d32;color:#fff;font-weight:700;cursor:pointer;}
    .mcb-np .totem button:disabled{background:#3a3f4b;color:#8a909c;cursor:not-allowed;}
    .mcb-np .slots{display:flex;gap:10px;}
    .mcb-np .slot{width:120px;height:52px;border:1px solid #2b3448;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#55607a;}
    .mcb-np .slot.filled{border-color:#4a7;color:#e8ecf3;}
    .mcb-np .wallet{color:#ffd966;}
    .mcb-np .ready{color:#4ade80;font-weight:700;}
  `;
  document.head.appendChild(s);
}

const ELEMENT_COLORS = { Neutral: '#b9c2d0', Fire: '#ff6b3d', Water: '#3fa7ff', Earth: '#b98a4a', Electric: '#ffd633', Flying: '#9fd0ff', Grass: '#5fd36a' };

export class NetPrepPhase {
  /**
   * @param {Object} ctx
   * @param {import('../net/netClient.js').NetClient} ctx.net
   * @param {() => void} ctx.onComplete  called on PREP_END (app → arena)
   */
  constructor({ net, onComplete }) {
    ensureStyle();
    this.net = net;
    this.onComplete = onComplete;
    this.root = document.createElement('div');
    this.root.className = 'mcb-np';
    this.root.innerHTML = `
      <h2>⚒️ Preparation — draft 4 skills</h2>
      <div class="timer" data-timer>—</div>
      <div class="totems" data-totems></div>
      <div class="slots" data-slots></div>
      <div data-status>Loading your totems…</div>`;
    document.body.appendChild(this.root);
    this.totemsEl = this.root.querySelector('[data-totems]');
    this.slotsEl = this.root.querySelector('[data-slots]');
    this._last = null;

    this._off = [
      net.on('prepSnapshot', (s) => this._render(s)),
      net.on('prepEnd', () => this.onComplete?.()),
    ];
  }

  _render(s) {
    this._last = s;
    this.root.querySelector('[data-timer]').textContent = `${s.timeLeft.toFixed(1)}s`;
    const you = s.you;
    const filled = you.slots.filter((x) => x != null).length;
    const ready = filled >= 4;

    this.totemsEl.innerHTML = you.totems.map((t, i) => {
      const c = ELEMENT_COLORS[t.element] || '#b9c2d0';
      const affordable = you.gold >= t.cost && !t.purchased && !ready;
      return `<div class="totem ${t.purchased ? 'bought' : ''}">
        <b>${t.name} <span class="el" style="background:${c}">${t.element}</span></b>
        <div class="cost">${t.cost} gold</div>
        <button data-buy="${i}" ${affordable ? '' : 'disabled'}>${t.purchased ? 'LEARNED' : 'LEARN'}</button>
      </div>`;
    }).join('');
    this.totemsEl.querySelectorAll('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => this.net.prepBuy(Number(b.dataset.buy))));

    this.slotsEl.innerHTML = you.slots.map((id, i) =>
      `<div class="slot ${id != null ? 'filled' : ''}">[${i + 1}] ${id != null ? '✓' : '—'}</div>`).join('');

    this.root.querySelector('[data-status]').innerHTML = ready
      ? `<span class="ready">READY — waiting for opponent / timer</span>`
      : `<span class="wallet">${you.gold} gold</span> · ${filled}/4 skills chosen`;
  }

  update() { /* DOM-driven; nothing per-frame */ }

  dispose() { this._off?.forEach((off) => off()); this.root.remove(); }
}
