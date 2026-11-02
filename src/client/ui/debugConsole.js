/**
 * In-game Debug Console overlay (GDD §9). Toggled with the [~] / backtick key.
 * Renders a live control for every variable in the shared DebugConfig registry:
 *   - bool  → checkbox
 *   - int   → slider + number box (integer step)
 *   - float → slider + number box
 *   - enum  → dropdown
 *
 * Edits call DebugConfig.set(), whose listeners propagate hot-reloaded values to
 * the rest of the game immediately (and, in the networked build, host → clients).
 * Includes a Reset-to-defaults button. The console reflects external changes too
 * (it subscribes to DebugConfig.onChange), so values stay in sync.
 */
import { DebugConfig } from '../../shared/debugConfig.js';

const STYLE_ID = 'mcb-debug-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-dbg{position:fixed;top:0;right:0;height:100%;width:360px;z-index:60;display:none;
      background:rgba(8,10,16,.96);border-left:1px solid #2b3448;box-shadow:-8px 0 30px rgba(0,0,0,.5);
      font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8ecf3;overflow-y:auto;}
    .mcb-dbg.open{display:block;}
    .mcb-dbg header{position:sticky;top:0;background:#12161f;padding:12px 14px;border-bottom:1px solid #2b3448;
      display:flex;align-items:center;justify-content:space-between;}
    .mcb-dbg header b{font-size:13px;letter-spacing:.5px;}
    .mcb-dbg header .hint{color:#5e6f8f;font-size:11px;}
    .mcb-dbg .reset{background:#3a2330;border:1px solid #6b2a3a;color:#ffd0d8;border-radius:6px;
      padding:4px 10px;cursor:pointer;font:inherit;}
    .mcb-dbg .list{padding:8px 14px 40px;}
    .mcb-row{padding:9px 0;border-bottom:1px solid #1a2130;}
    .mcb-row .top{display:flex;justify-content:space-between;align-items:center;gap:8px;}
    .mcb-row label{color:#cfe3ff;}
    .mcb-row .val{color:#ffd966;font-weight:700;}
    .mcb-row .help{color:#5e6f8f;font-size:11px;margin-top:2px;}
    .mcb-row input[type=range]{width:100%;margin-top:6px;accent-color:#ffb02e;}
    .mcb-row .nb{width:72px;background:#0f1420;border:1px solid #2b3448;color:#e8ecf3;border-radius:5px;padding:3px 6px;font:inherit;}
    .mcb-row select{background:#0f1420;border:1px solid #2b3448;color:#e8ecf3;border-radius:5px;padding:4px 6px;font:inherit;}
    .mcb-row input[type=checkbox]{width:16px;height:16px;accent-color:#4ade80;}
    .mcb-dirty{color:#4ade80;}
  `;
  document.head.appendChild(s);
}

export class DebugConsole {
  /** @param {(key:string,value:any)=>void} [onChange] optional extra hook (e.g. networking broadcast) */
  constructor(onChange) {
    ensureStyle();
    this.extraOnChange = onChange;
    this.open = false;
    this._rows = new Map();

    this.root = document.createElement('div');
    this.root.className = 'mcb-dbg';
    this.root.innerHTML = `
      <header>
        <div><b>⚙ DEBUG CONSOLE</b><div class="hint">[~] to toggle · hot-reload</div></div>
        <button class="reset" data-reset>Reset</button>
      </header>
      <div class="list" data-list></div>`;
    document.body.appendChild(this.root);

    this.listEl = this.root.querySelector('[data-list]');
    this._build();

    this.root.querySelector('[data-reset]').addEventListener('click', () => {
      DebugConfig.reset();
      this._syncAll();
    });

    // Keep UI in sync with external changes (host sync, programmatic sets).
    this._unsub = DebugConfig.onChange((key) => {
      if (key === '*') this._syncAll(); else this._syncRow(key);
    });
  }

  _build() {
    for (const v of DebugConfig.all()) {
      const row = document.createElement('div');
      row.className = 'mcb-row';
      row.dataset.key = v.key;

      if (v.type === 'bool') {
        row.innerHTML = `
          <div class="top">
            <label>${v.label}</label>
            <input type="checkbox" data-input ${v.value ? 'checked' : ''}/>
          </div>${v.help ? `<div class="help">${v.help}</div>` : ''}`;
        row.querySelector('[data-input]').addEventListener('change', (e) => this._set(v.key, e.target.checked));
      } else if (v.type === 'enum') {
        row.innerHTML = `
          <div class="top">
            <label>${v.label}</label>
            <select data-input>${v.options.map((o) => `<option value="${o}" ${o === v.value ? 'selected' : ''}>${o}</option>`).join('')}</select>
          </div>${v.help ? `<div class="help">${v.help}</div>` : ''}`;
        row.querySelector('[data-input]').addEventListener('change', (e) => this._set(v.key, e.target.value));
      } else { // int / float
        const step = v.type === 'int' ? 1 : 0.1;
        row.innerHTML = `
          <div class="top">
            <label>${v.label}</label>
            <input class="nb" type="number" data-num min="${v.min ?? ''}" max="${v.max ?? ''}" step="${step}" value="${v.value}"/>
          </div>
          <input type="range" data-input min="${v.min ?? 0}" max="${v.max ?? 100}" step="${step}" value="${v.value}"/>
          ${v.help ? `<div class="help">${v.help}</div>` : ''}`;
        const range = row.querySelector('[data-input]');
        const num = row.querySelector('[data-num]');
        range.addEventListener('input', (e) => { num.value = e.target.value; this._set(v.key, e.target.value); });
        num.addEventListener('change', (e) => { this._set(v.key, e.target.value); });
      }

      this.listEl.appendChild(row);
      this._rows.set(v.key, row);
    }
  }

  _set(key, raw) {
    DebugConfig.set(key, raw);
    this._syncRow(key); // reflect coercion/clamping
    this.extraOnChange?.(key, DebugConfig.get(key));
  }

  _syncRow(key) {
    const row = this._rows.get(key);
    const v = DebugConfig.meta(key);
    if (!row || !v) return;
    const input = row.querySelector('[data-input]');
    const num = row.querySelector('[data-num]');
    if (v.type === 'bool') input.checked = !!v.value;
    else if (v.type === 'enum') input.value = v.value;
    else { input.value = v.value; if (num) num.value = v.value; }
  }

  _syncAll() { for (const key of this._rows.keys()) this._syncRow(key); }

  toggle() { this.open = !this.open; this.root.classList.toggle('open', this.open); }
  isOpen() { return this.open; }

  dispose() { this._unsub?.(); this.root.remove(); }
}
