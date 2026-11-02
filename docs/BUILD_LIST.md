# Build List — Monster Coliseum Brawl

Tracked against the GDD + the 50-skill sheet. Updated each slice.

Legend: ✅ Done · 🟡 Partial · ❌ Missing · 🚫 Needs native CI runner (config only here)

## Slice 1–2 (current) — Foundation & data layer
- ✅ Electron + Vite + Three.js project manifest (`package.json`)
- ✅ `electron-builder` config for win/mac(universal)/linux `.zip` (GDD §1)
- ✅ 50-skill CSV, date-corruption corrected (GDD §10)
- ✅ Typed skill loader + queries (`src/shared/skills.js`)
- ✅ 5-monster roster w/ stats + basic attacks (GDD §7)
- ✅ Totem draft w/ ≥4-affordable anti-softlock guarantee (GDD §4A)
- ✅ Debug variable registry, all 12 vars + 2 enums (GDD §9)
- ✅ Headless test suite (11 tests passing)

---

## §1 Platforms & Packaging
| Item | Status |
|---|---|
| Electron + Vite + Three.js skeleton | ✅ (main + preload + Vite + WebGL scene) |
| electron-builder win/mac/linux config | ✅ |
| **Linux `.zip` artifact (built & verified here)** | ✅ (99 MB, launchable, app.asar verified) |
| **CI workflow: win/mac/linux matrix** | ✅ (`.github/workflows/build-desktop.yml`) |
| **Windows `.zip` + `.exe` artifact** | ✅ CI (106 MB, green on `windows-latest`) |
| **macOS universal `.app` `.zip` artifact** | ✅ CI (165 MB arm64+x86_64, green on `macos-latest`, unsigned) |
| **Public direct-download links (GitHub Release)** | ✅ tag-triggered release job → [v0.1.3 release](https://github.com/pigrycc/MonsterBrawl/releases/tag/v0.1.3) |

## §2 Networking & Multiplayer
| Item | Status |
|---|---|
| Host-authoritative Node server (ws) | ❌ |
| Client connect layer | ❌ |
| Room browser UI | ❌ |
| Host Game (name, 2–10 limit) | ❌ |
| Direct IP/Port fallback | ❌ |
| Proximity 3D voice (WebRTC + VAD) | ❌ |
| Mute `[V]` + overhead 🔊 | ❌ |

## §3 Lobby & Hub
| Item | Status |
|---|---|
| Low-poly trainer in Ready Room (procedural model) | ✅ |
| Mirror customization (skin `[E]` / tunic `[R]`) | ✅ |
| 5 pedestals + `[E]` bind | ✅ |
| Host console mode dropdown (Tournament/FFA/Team) | ✅ |
| Bot Fill toggle | ✅ |
| Host-only START MATCH (disabled until monster chosen) | ✅ |
| FPP walk-around controller (pointer-lock + WASD) | ✅ |
| Verified: headless WebGL render, no errors, UI live | ✅ |
| Remaining polish: brighter lighting, framing, other players' trainers | 🟡 |

## §4 Preparation Phase
| Item | Status |
|---|---|
| Synchronized 60s countdown (debug-configurable) | ✅ |
| Skip-to-zero when all fighters READY | ✅ |
| 6 affinity-weighted totems (3D stone totems w/ runes) | ✅ |
| World-space 3D tooltip (name/cost/cd/windup/effect/element/slapstick) | ✅ |
| Hold `[E]` 1s buy → slot `[1]–[4]` (+ progress ring) | ✅ |
| READY at 4 skills (banner) | ✅ |
| Economy 50g / 0-10-20-30 | ✅ |
| **STRONG** anti-softlock: 4 cheapest totems collectively affordable | ✅ |
| Skills reset each bout (`resetForNewBout`) | ✅ |
| Bookmaker: 3 bets, 1 wager, 2.0x, max 10g | ✅ logic+UI / 🟡 wiring (needs spectators from networking) |
| Lobby→Prep phase transition (GameApp state machine) | ✅ |
| Verified: headless render — transition, HUD, timer, buy→slot→READY | ✅ |
| Spectator Bookmaker's Den 3D scene | 🟡 (UI built; 3D den deferred) |

## §5 Arena Combat (FPP)
| Item | Status |
|---|---|
| Spawn + 3·2·1·GO lock | ❌ |
| 3:00 clock | ❌ |
| Sudden Death | ❌ |
| Stances `[Q]/[E]/[F]` + 2s delay | ❌ |
| NavMesh monster nav | ❌ |
| Stamina (slow <50%, 0=3s stun) | ❌ |
| Rest regen (+1/2s vs +1/4s) | ❌ |
| Skills `[1]–[4]` + windup + HUD cd | ❌ |
| Shove `LMB` 4m, 10s/target | ❌ |
| Trainer crossfire ragdoll | ❌ |
| Crowd drops + `[E]` carry | ❌ |
| Rewards +30/+20 | ✅ (data) / ❌ (flow) |

## §6 Spectator Interaction
| Item | Status |
|---|---|
| Terraces + supply crates | ❌ |
| Tomato / Stone / Speed Draft | ❌ |
| Pick `[E]` / throw `LMB` | ❌ |

## §7 Monster Roster | ✅ (data+stats) / ❌ (3D models — procedural, upcoming)

## §8 Bot Subsystem
| Item | Status |
|---|---|
| Idle dummy | ❌ |
| Humanlike (draft/stamina/skills/drops/shove) | ❌ |

## §9 Debug Console `[~]` | ✅ (registry) / ❌ (overlay UI)

## §10 50-Skill DB | ✅ (loaded, corrected, tested)
