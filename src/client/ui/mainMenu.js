/**
 * Main menu / room browser (GDD §2). Entry screen before the 3D lobby:
 *   - Host Game: custom room name + player limit (2-10) → starts/【connects to】
 *     the authoritative host server.
 *   - Join: a room-browser row (Room Name · Host · Players · Ping · Join), plus
 *     a Direct IP/Port field as the WAN fallback.
 *   - Single-player: skip networking and play vs bots locally.
 *
 * In a packaged Electron build the host client launches the bundled Node server
 * in-process; in the dev/web build the host connects to a server started with
 * `npm run server` (surfaced in the UI).
 */
import { DEFAULT_PORT } from '../../shared/protocol.js';

const STYLE_ID = 'mcb-menu-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-menu{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(circle at 50% 30%,#1a2233,#07090e);font:14px system-ui,sans-serif;color:#e8ecf3;}
    .mcb-menu .card{width:560px;background:rgba(12,16,24,.92);border:1px solid #2b3448;border-radius:16px;
      padding:26px 28px;box-shadow:0 20px 60px rgba(0,0,0,.5);}
    .mcb-menu h1{margin:0 0 2px;font-size:26px;letter-spacing:.5px;}
    .mcb-menu .tag{color:#8aa0c8;margin-bottom:18px;font-size:13px;}
    .mcb-menu .tabs{display:flex;gap:8px;margin-bottom:16px;}
    .mcb-menu .tab{flex:1;padding:9px;text-align:center;border:1px solid #2b3448;border-radius:8px;cursor:pointer;color:#9fb0cc;}
    .mcb-menu .tab.on{background:#1f2a40;color:#fff;border-color:#3a4f78;}
    .mcb-menu label{display:block;color:#8aa0c8;font-size:12px;margin:10px 0 4px;}
    .mcb-menu input{width:100%;background:#0f1420;border:1px solid #2b3448;border-radius:7px;color:#e8ecf3;padding:9px 10px;font:inherit;}
    .mcb-menu .row{display:flex;gap:10px;}
    .mcb-menu .btn{margin-top:16px;width:100%;padding:12px;border:none;border-radius:9px;font-weight:700;font-size:15px;cursor:pointer;background:#2e7d32;color:#fff;}
    .mcb-menu .btn.sec{background:#2b3448;color:#cfe3ff;}
    .mcb-menu .browser{margin-top:6px;border:1px solid #2b3448;border-radius:8px;overflow:hidden;}
    .mcb-menu .browser .head,.mcb-menu .browser .r{display:grid;grid-template-columns:2fr 1.4fr .8fr .8fr auto;gap:8px;padding:9px 12px;align-items:center;}
    .mcb-menu .browser .head{background:#161d2b;color:#8aa0c8;font-size:12px;}
    .mcb-menu .browser .r{border-top:1px solid #1a2130;}
    .mcb-menu .browser .r .join{background:#2e7d32;border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit;}
    .mcb-menu .status{margin-top:12px;color:#ffcf99;font-size:12px;min-height:16px;}
    .mcb-menu .hint{margin-top:10px;color:#5e6f8f;font-size:11px;}
    .mcb-menu .ping{color:#7fd38b;}
  `;
  document.head.appendChild(s);
}

export class MainMenu {
  /**
   * @param {Object} handlers
   * @param {(opts:{roomName:string,playerLimit:number})=>void} handlers.onHost
   * @param {(opts:{host:string,port:number})=>void} handlers.onJoin
   * @param {()=>void} handlers.onSinglePlayer
   */
  constructor(handlers) {
    ensureStyle();
    this.handlers = handlers;
    this.tab = 'host';

    this.root = document.createElement('div');
    this.root.className = 'mcb-menu';
    this.root.innerHTML = `
      <div class="card">
        <h1>⚔️ Monster Coliseum Brawl</h1>
        <div class="tag">Host-authoritative multiplayer · 2–10 trainers</div>
        <div class="tabs">
          <div class="tab on" data-tab="host">Host Game</div>
          <div class="tab" data-tab="join">Join</div>
          <div class="tab" data-tab="solo">Single-Player</div>
        </div>
        <div data-panel></div>
        <div class="status" data-status></div>
      </div>`;
    document.body.appendChild(this.root);
    this.panel = this.root.querySelector('[data-panel]');
    this.statusEl = this.root.querySelector('[data-status]');
    this.root.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => this._setTab(t.dataset.tab)));
    this._renderPanel();
  }

  _setTab(tab) {
    this.tab = tab;
    this.root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
    this._renderPanel();
  }

  _renderPanel() {
    if (this.tab === 'host') {
      this.panel.innerHTML = `
        <label>Room Name</label>
        <input data-rn type="text" value="Gladiator's Ready Room" maxlength="40"/>
        <div class="row">
          <div style="flex:1"><label>Player Limit (2–10)</label><input data-pl type="number" min="2" max="10" value="4"/></div>
          <div style="flex:1"><label>Port</label><input data-port type="number" value="${DEFAULT_PORT}"/></div>
        </div>
        <button class="btn" data-host>HOST GAME</button>
        <div class="hint">In the packaged app this starts the server automatically. In dev, run <b>npm run server</b> first, then Host connects to it.</div>`;
      this.panel.querySelector('[data-host]').addEventListener('click', () => {
        const roomName = this.panel.querySelector('[data-rn]').value || 'Room';
        const playerLimit = Math.max(2, Math.min(10, Number(this.panel.querySelector('[data-pl]').value) || 2));
        const port = Number(this.panel.querySelector('[data-port]').value) || DEFAULT_PORT;
        this.setStatus('Starting host…');
        this.handlers.onHost({ roomName, playerLimit, port });
      });
    } else if (this.tab === 'join') {
      this.panel.innerHTML = `
        <div class="browser">
          <div class="head"><span>Room Name</span><span>Host</span><span>Players</span><span>Ping</span><span></span></div>
          <div data-rows><div class="r"><span style="grid-column:1/5;color:#8aa0c8">No LAN rooms discovered — use Direct Connect.</span><span></span></div></div>
        </div>
        <label>Direct Connect (IP : Port)</label>
        <div class="row">
          <input data-ip type="text" value="127.0.0.1" style="flex:2"/>
          <input data-port type="number" value="${DEFAULT_PORT}" style="flex:1"/>
        </div>
        <button class="btn" data-join>JOIN</button>`;
      this.panel.querySelector('[data-join]').addEventListener('click', () => {
        const host = this.panel.querySelector('[data-ip]').value || '127.0.0.1';
        const port = Number(this.panel.querySelector('[data-port]').value) || DEFAULT_PORT;
        this.setStatus(`Connecting to ${host}:${port}…`);
        this.handlers.onJoin({ host, port });
      });
    } else {
      this.panel.innerHTML = `
        <p style="color:#9fb0cc;line-height:1.5">Play immediately against AI bots — no server needed. You can host or join a networked match from the menu any time.</p>
        <button class="btn" data-solo>PLAY VS BOTS</button>`;
      this.panel.querySelector('[data-solo]').addEventListener('click', () => this.handlers.onSinglePlayer());
    }
  }

  /** Populate the room browser with discovered/known rooms (GDD §2). */
  setRooms(rooms) {
    const rowsEl = this.panel?.querySelector('[data-rows]');
    if (!rowsEl) return;
    if (!rooms?.length) { rowsEl.innerHTML = `<div class="r"><span style="grid-column:1/5;color:#8aa0c8">No rooms found.</span><span></span></div>`; return; }
    rowsEl.innerHTML = rooms.map((r, i) => `
      <div class="r">
        <span>${r.roomName}</span><span>${r.hostName}</span>
        <span>${r.players}/${r.playerLimit}</span>
        <span class="ping">${r.ping ?? '—'}ms</span>
        <button class="join" data-i="${i}">Join</button>
      </div>`).join('');
    rowsEl.querySelectorAll('.join').forEach((b) => b.addEventListener('click', () => this.handlers.onJoin(rooms[Number(b.dataset.i)].connect)));
  }

  setStatus(msg, ping) { this.statusEl.innerHTML = ping != null ? `${msg} <span class="ping">(${ping}ms)</span>` : msg; }
  hide() { this.root.style.display = 'none'; }
  show() { this.root.style.display = 'flex'; }
  dispose() { this.root.remove(); }
}
