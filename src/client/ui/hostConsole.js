/**
 * Host Match Setup Console (GDD §3). A DOM panel (toggle with [Tab]) exposing:
 *   - Room name
 *   - Player limit (2–10)
 *   - Game Mode dropdown: Tournament / Free-For-All / Team Fight
 *   - Bot Fill toggle
 *   - START MATCH button — visible/interactable only to the Host
 *
 * Reads/writes LocalState; in the networked build only the host sees the
 * editable controls (others see a read-only view).
 */
import { LocalState, GAME_MODES } from '../state/localState.js';

const STYLE_ID = 'mcb-hostconsole-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-host{position:fixed;right:16px;top:16px;z-index:30;width:300px;
      background:rgba(14,18,28,.92);border:1px solid #2b3448;border-radius:12px;
      font:13px system-ui,sans-serif;color:#e8ecf3;overflow:hidden;}
    .mcb-host h3{margin:0;padding:12px 14px;background:#1a2233;font-size:14px;
      display:flex;justify-content:space-between;align-items:center;}
    .mcb-host .body{padding:12px 14px;display:flex;flex-direction:column;gap:10px;}
    .mcb-host label{display:flex;flex-direction:column;gap:4px;color:#8aa0c8;font-size:12px;}
    .mcb-host input[type=text],.mcb-host select,.mcb-host input[type=number]{
      background:#0f1420;border:1px solid #2b3448;border-radius:6px;color:#e8ecf3;
      padding:6px 8px;font:13px system-ui,sans-serif;}
    .mcb-host .row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
    .mcb-host .toggle{display:flex;align-items:center;gap:8px;color:#e8ecf3;cursor:pointer;}
    .mcb-host .start{margin-top:4px;padding:10px;border:none;border-radius:8px;cursor:pointer;
      background:#2e7d32;color:#fff;font-weight:700;letter-spacing:.5px;font-size:14px;}
    .mcb-host .start:disabled{background:#3a3f4b;color:#8a909c;cursor:not-allowed;}
    .mcb-host .hostbadge{font-size:11px;color:#ffd966;border:1px solid #6b5a12;
      background:#2a2410;border-radius:10px;padding:2px 8px;}
    .mcb-host .hint{color:#5e6f8f;font-size:11px;}
  `;
  document.head.appendChild(s);
}

export class HostConsole {
  /** @param {() => void} onStart called when START MATCH clicked */
  constructor(onStart) {
    ensureStyle();
    this.onStart = onStart;
    const st = LocalState.get();

    this.root = document.createElement('div');
    this.root.className = 'mcb-host';
    this.root.innerHTML = `
      <h3>Match Setup
        <span class="hostbadge">${st.isHost ? 'HOST' : 'GUEST'}</span>
      </h3>
      <div class="body">
        <label>Room Name
          <input type="text" data-k="roomName" value="${st.roomName}" ${st.isHost ? '' : 'disabled'} />
        </label>
        <label>Game Mode
          <select data-k="gameMode" ${st.isHost ? '' : 'disabled'}>
            ${GAME_MODES.map((m) => `<option value="${m}" ${m === st.gameMode ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
        <div class="row">
          <label style="flex:1">Player Limit (2–10)
            <input type="number" min="2" max="10" data-k="playerLimit" value="${st.playerLimit}" ${st.isHost ? '' : 'disabled'} />
          </label>
        </div>
        <label class="toggle">
          <input type="checkbox" data-k="botFill" ${st.botFill ? 'checked' : ''} ${st.isHost ? '' : 'disabled'} />
          Bot Fill — fill empty slots with AI
        </label>
        ${st.isHost ? `<button class="start" data-start>START MATCH</button>` : ``}
        <div class="hint">Press <b>Tab</b> to toggle this panel.</div>
      </div>`;
    document.body.appendChild(this.root);

    // Wire inputs → state
    this.root.querySelector('[data-k=roomName]')?.addEventListener('input', (e) => LocalState.setRoomName(e.target.value));
    this.root.querySelector('[data-k=gameMode]')?.addEventListener('change', (e) => LocalState.setGameMode(e.target.value));
    this.root.querySelector('[data-k=playerLimit]')?.addEventListener('change', (e) => LocalState.setPlayerLimit(Number(e.target.value)));
    this.root.querySelector('[data-k=botFill]')?.addEventListener('change', (e) => LocalState.setBotFill(e.target.checked));
    this.startBtn = this.root.querySelector('[data-start]');
    this.startBtn?.addEventListener('click', () => { if (LocalState.canStartMatch()) this.onStart?.(); });

    this._unsub = LocalState.onChange(() => this.refresh());
    this.refresh();
  }

  refresh() {
    if (!this.startBtn) return;
    const can = LocalState.canStartMatch();
    this.startBtn.disabled = !can;
    this.startBtn.textContent = can ? 'START MATCH' : 'SELECT A MONSTER FIRST';
  }

  toggle() { this.root.style.display = this.root.style.display === 'none' ? '' : 'none'; }

  dispose() { this._unsub?.(); this.root.remove(); }
}
