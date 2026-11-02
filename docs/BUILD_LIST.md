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
| Spawn on sand + 3·2·1·GO! lock (look-only) | ✅ |
| 3:00 match clock | ✅ |
| Sudden Death (next damage ends match) | ✅ |
| Stances `[Q]/[E]/[F]` + 2.0s behavioral delay | ✅ |
| Defensive: −50% skill dmg + negate 1 basic | ✅ |
| Monster autonomous nav (stance-driven steering; NavMesh-lite flat arena) | ✅ / 🟡 (true NavMesh deferred) |
| Stamina (slow <50% → 0.7x, 0 → 3s ragdoll stun) | ✅ |
| Rest regen (+1/2s neutral vs +1/4s combat) | ✅ |
| Skills `[1]–[4]` + wind-up + HUD cooldown clocks | ✅ |
| Shove `LMB` (4m, 10s cooldown) | ✅ |
| Crowd drops (potion/adrenaline/oil) + `[E]` carry/deliver | ✅ |
| Trainer crossfire ragdoll | 🟡 (shove/drops done; crossfire knockback deferred) |
| Rewards +30/+20 (applied to wallet) | ✅ |
| Bot opponent (minimal, playable) | ✅ (full §8 profiles later) |
| Verified: headless render — full lobby→prep→arena→KO→VICTORY flow | ✅ |

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
| Idle profile (passive target dummy) | ✅ |
| Humanlike: drafts 4 affordable skills in prep | ✅ |
| Humanlike: rest `[F]` <30% stamina, offensive `[Q]` when ahead, guard when behind | ✅ |
| Humanlike: casts skills `[1]–[4]` when opponent in range | ✅ |
| Humanlike: collects crowd drops + shoves player | ✅ |
| Shared, deterministic bot brain (unit-tested) | ✅ |
| Verified: headless — Humanlike drafts+damages, Idle passive | ✅ |

## §9 Debug Console `[~]`
| Item | Status |
|---|---|
| Registry: all 12 variables + 2 enums | ✅ |
| In-game overlay UI (toggle `[~]`) | ✅ |
| Typed controls (checkbox/slider+number/dropdown) | ✅ |
| Hot-reload: edits take effect live | ✅ |
| Reset-to-defaults + external-change sync | ✅ |
| `forceLocalMonsterType` override wired (verified) | ✅ |
| `botBehaviorMode` IDLE/HUMANLIKE wired into arena bot | ✅ |
| Verified: headless render — opens, 12 rows, flip persists, override works | ✅ |

## §10 50-Skill DB | ✅ (loaded, corrected, tested)
