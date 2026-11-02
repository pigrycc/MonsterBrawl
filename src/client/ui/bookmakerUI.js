/**
 * Bookmaker's Den UI (GDD §4B). Spectators place exactly one wager before the
 * training timer expires. Three bet types, 2.0x payout, max 10 gold (debug §9).
 */
import { BET_TYPES } from '../../shared/betting.js';
import { DebugConfig } from '../../shared/debugConfig.js';

const STYLE_ID = 'mcb-book-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-book{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:40;width:360px;
      background:rgba(12,14,22,.97);border:1px solid #3a2f5a;border-radius:14px;overflow:hidden;
      font:13px system-ui,sans-serif;color:#e8ecf3;box-shadow:0 10px 40px rgba(0,0,0,.6);}
    .mcb-book h3{margin:0;padding:14px;background:#231a3a;font-size:15px;}
    .mcb-book .body{padding:14px;display:flex;flex-direction:column;gap:12px;}
    .mcb-book .bet{border:1px solid #2b3448;border-radius:10px;padding:10px;cursor:pointer;background:#10131f;}
    .mcb-book .bet.sel{border-color:#a78bfa;background:#1a1530;}
    .mcb-book .bet b{display:block;margin-bottom:2px;}
    .mcb-book .bet small{color:#8aa0c8;}
    .mcb-book select,.mcb-book input{background:#0f1420;border:1px solid #2b3448;border-radius:6px;color:#e8ecf3;padding:5px 7px;margin-top:6px;width:100%;}
    .mcb-book .row{display:flex;gap:8px;align-items:center;}
    .mcb-book .place{padding:10px;border:none;border-radius:8px;background:#6d28d9;color:#fff;font-weight:700;cursor:pointer;}
    .mcb-book .place:disabled{background:#3a3f4b;color:#8a909c;cursor:not-allowed;}
    .mcb-book .status{font-size:12px;color:#8aa0c8;text-align:center;}
    .mcb-book .payout{color:#ffd966;}
  `;
  document.head.appendChild(s);
}

export class BookmakerUI {
  /**
   * @param {Object} opts
   * @param {Array<{id:string,name:string}>} opts.fighters  for PLAYER_WINS / monster targets
   * @param {Array<{id:string,name:string}>} opts.monsters
   * @param {number} opts.spectatorGold
   * @param {(bet:object)=>{ok:boolean,reason?:string}} opts.onPlace
   */
  constructor({ fighters, monsters, spectatorGold, onPlace }) {
    ensureStyle();
    this.fighters = fighters;
    this.monsters = monsters;
    this.onPlace = onPlace;
    this.selected = null;
    this.maxBet = DebugConfig.get('maxBetAmount');

    this.root = document.createElement('div');
    this.root.className = 'mcb-book';
    this.root.innerHTML = `
      <h3>🎲 Bookmaker's Den — one wager per bout</h3>
      <div class="body">
        <div class="bet" data-type="${BET_TYPES.PLAYER_WINS}">
          <b>A fighter wins the bout</b><small>Pays <span class="payout">2.0×</span></small>
          <select data-player>${fighters.map((f) => `<option value="${f.id}">${f.name}</option>`).join('')}</select>
        </div>
        <div class="bet" data-type="${BET_TYPES.BOUT_UNDER_60}">
          <b>Bout ends in under 60 seconds</b><small>Pays <span class="payout">2.0×</span></small>
        </div>
        <div class="bet" data-type="${BET_TYPES.MONSTER_STUNNED_3}">
          <b>A monster is stunned ≥ 3 times</b><small>Pays <span class="payout">2.0×</span></small>
          <select data-monster>${monsters.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select>
        </div>
        <div class="row">
          <label style="flex:1">Stake (max ${this.maxBet}, you have ${spectatorGold}g)
            <input type="number" data-stake min="1" max="${Math.min(this.maxBet, spectatorGold)}" value="${Math.min(this.maxBet, spectatorGold) || 1}"/>
          </label>
        </div>
        <button class="place" data-place disabled>SELECT A BET</button>
        <div class="status" data-status>Choose a wager, then place it before the timer ends.</div>
      </div>`;
    document.body.appendChild(this.root);

    this.root.querySelectorAll('.bet').forEach((b) => b.addEventListener('click', () => this._select(b)));
    this.placeBtn = this.root.querySelector('[data-place]');
    this.placeBtn.addEventListener('click', () => this._place());
  }

  _select(betEl) {
    this.root.querySelectorAll('.bet').forEach((b) => b.classList.remove('sel'));
    betEl.classList.add('sel');
    this.selected = betEl.dataset.type;
    this.placeBtn.disabled = false;
    this.placeBtn.textContent = 'PLACE WAGER';
  }

  _place() {
    if (!this.selected) return;
    const stake = Number(this.root.querySelector('[data-stake]').value);
    const bet = { type: this.selected, stake };
    if (this.selected === BET_TYPES.PLAYER_WINS) bet.targetPlayerId = this.root.querySelector('[data-player]').value;
    if (this.selected === BET_TYPES.MONSTER_STUNNED_3) bet.targetMonsterId = this.root.querySelector('[data-monster]').value;

    const res = this.onPlace(bet);
    const status = this.root.querySelector('[data-status]');
    if (res.ok) {
      status.textContent = `Wager placed: ${stake}g. Good luck! (betting locked)`;
      this.placeBtn.disabled = true;
      this.placeBtn.textContent = 'WAGER PLACED';
      this.root.querySelectorAll('.bet').forEach((b) => (b.style.pointerEvents = 'none'));
    } else {
      status.textContent = `Could not place bet: ${res.reason.replace(/_/g, ' ')}`;
    }
  }

  dispose() { this.root.remove(); }
}
