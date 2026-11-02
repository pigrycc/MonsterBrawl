/**
 * Renderer entry point. Boots the GameApp state machine, which manages the
 * phase flow: lobby (§3) → preparation (§4) → arena (§5, upcoming).
 */
import { GameApp } from './app.js';

const app = document.getElementById('app');
new GameApp(app);

console.log('[MCB] app started');
