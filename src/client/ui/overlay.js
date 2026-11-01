/**
 * Lightweight DOM overlay helpers layered over the Three.js canvas:
 *   - a crosshair
 *   - an interaction prompt ("Press [E] to ...")
 *   - a toast line for transient feedback
 *
 * Kept framework-free (plain DOM) to avoid pulling in a UI library.
 */

const STYLE_ID = 'mcb-overlay-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    .mcb-crosshair{position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;
      border-radius:50%;background:rgba(255,255,255,.75);pointer-events:none;z-index:20;}
    .mcb-prompt{position:fixed;left:50%;top:58%;transform:translateX(-50%);z-index:21;
      padding:8px 14px;background:rgba(14,18,28,.82);border:1px solid #2b3448;border-radius:8px;
      font:14px system-ui,sans-serif;color:#e8ecf3;pointer-events:none;display:none;white-space:nowrap;}
    .mcb-prompt b{color:#ffd966;}
    .mcb-toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:22;
      padding:8px 16px;background:rgba(20,26,40,.9);border:1px solid #3a475e;border-radius:8px;
      font:13px system-ui,sans-serif;color:#cfe3ff;opacity:0;transition:opacity .2s;pointer-events:none;}
    .mcb-hint{position:fixed;left:16px;bottom:16px;z-index:21;font:12px system-ui,sans-serif;
      color:#8aa0c8;background:rgba(14,18,28,.7);border:1px solid #2b3448;border-radius:8px;padding:8px 12px;}
    .mcb-hint kbd{background:#2b3448;border-radius:4px;padding:1px 6px;color:#e8ecf3;font-family:inherit;}
  `;
  document.head.appendChild(s);
}

export class Overlay {
  constructor() {
    ensureStyle();
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'mcb-crosshair';
    this.prompt = document.createElement('div');
    this.prompt.className = 'mcb-prompt';
    this.toast = document.createElement('div');
    this.toast.className = 'mcb-toast';
    this.hint = document.createElement('div');
    this.hint.className = 'mcb-hint';
    this.hint.innerHTML = `<kbd>WASD</kbd> move · <kbd>Mouse</kbd> look · <kbd>E</kbd> interact · click to capture mouse`;
    document.body.append(this.crosshair, this.prompt, this.toast, this.hint);
    this._toastTimer = null;
  }

  showPrompt(html) { this.prompt.innerHTML = html; this.prompt.style.display = 'block'; }
  hidePrompt() { this.prompt.style.display = 'none'; }

  showToast(text, ms = 1800) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toast.style.opacity = '0'; }, ms);
  }

  dispose() {
    [this.crosshair, this.prompt, this.toast, this.hint].forEach((el) => el.remove());
  }
}
