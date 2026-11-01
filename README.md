# Monster Coliseum Brawl

A 3D multiplayer monster-battling prototype built on **Three.js** (renderer),
an **authoritative Node host server** (WebSocket), and packaged as a native
desktop app via **Electron + electron-builder** (Windows `.zip`+`.exe`,
macOS `.app` universal, Linux `.zip`).

> Status: **early prototype, built in vertical slices.** See the build list in
> the PR description / `docs/BUILD_LIST.md` for what is Done / Partial / Missing
> against the Game Design Document.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Rendering / gameplay client | Three.js | Runs everywhere, no engine license, scriptable here |
| Desktop packaging | Electron + electron-builder | Produces direct-launch `.exe` / `.app` (GDD §1) |
| Netcode | Node + `ws` (host-authoritative) | One client hosts the server; others connect (GDD §2) |
| Proximity voice | WebRTC + voice-activity gate | Positional 3D audio (GDD §2) — later slice |

## Project layout

```
assets/data/skills.csv      # canonical 50-skill sheet (GDD §10)
src/shared/                 # engine-agnostic data + rules (used by client, server, tests)
  skills.js                 #   50-skill DB + queries
  monsters.js               #   5 archetypes (GDD §7)
  draft.js                  #   totem draft w/ anti-softlock guarantee (GDD §4A)
  debugConfig.js            #   hot-reload debug variables (GDD §9)
src/client/                 # Three.js renderer (lobby, prep, arena)  [upcoming]
server/                     # authoritative host server               [upcoming]
electron/                   # Electron main + preload                 [upcoming]
test/                       # headless node:test suites
```

## Develop

```bash
npm install          # ~2-5 min cold (Electron + Three.js + Vite)
npm test             # headless data/rules tests (node --test)
npm run dev          # Vite dev server for the Three.js client
npm run electron:dev # full desktop app in dev
```

## Package desktop builds

```bash
npm run dist:linux   # Linux .zip   (buildable in CI / this sandbox)
npm run dist:win     # Windows .zip + .exe   (needs Windows runner or wine in CI)
npm run dist:mac     # macOS universal .app .zip   (needs macOS runner + signing)
```

Cross-platform artifacts are produced on CI runners per OS; this repo ships the
full `electron-builder` configuration in `package.json`.

## Data note

Three `Windup_Sec` values in the source skill sheet were corrupted by
spreadsheet date auto-formatting (`Zap_Cannon`, `Hyper_Beam`, `Self_Destruct`).
They are restored to their intended heavy-attack wind-ups (2.5 / 5.0 / 5.0s) in
both `assets/data/skills.csv` and `src/shared/skills.js`.
