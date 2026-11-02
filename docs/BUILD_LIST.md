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
| Host-authoritative Node server (ws) | ✅ (server/, embedded in Electron main) |
| Client connect layer (NetClient) | ✅ |
| Shared protocol (C2S/S2C, versioned) | ✅ |
| Room browser UI + Host/Join/Single-Player menu | ✅ |
| Host Game (custom name, 2–10 limit) | ✅ |
| Direct IP/Port fallback | ✅ |
| Host authority (config/start gated, host promotion) | ✅ (verified over the wire) |
| Ping round-trip | ✅ |
| Per-client synchronized combat (all clients run same bout) | 🟡 (roster/config synced; combat sync is a follow-up) |
| Proximity 3D voice (WebRTC + VAD) + mute `[V]` + 🔊 | ❌ (deferred — separate effort) |

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
| Throwables + effects (shared, unit-tested) | ✅ |
| Rotten Tomato (5s blind trainer / 5s confuse monster) | ✅ |
| Stone (1.5s stun trainer/monster) | ✅ |
| Speed Draft (ally stamina/speed boost) | ✅ |
| Projectiles arc from stands → land → apply effect | ✅ |
| Confused-wander monster behavior in arena | ✅ |
| Spawns on `spectatorItemSpawnRate` cadence | ✅ |
| Verified: headless — thrown Stone stuns a monster in-arena | ✅ |
| Manual spectator pick `[E]` / aim-throw `LMB` from stands | 🟡 (auto-crowd now; manual spectator view pairs w/ multiplayer) |

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

---

## Feedback round 1 (playtest polish)
| # | Item | Status |
|---|---|---|
| 1 | Auto pointer-lock on scene entry (no preliminary click) | ✅ (click fallback retained) |
| 2 | Stance: instant switch + 2s cooldown *after* (was 2s pre-delay) | ✅ (overrides GDD §5B wording per feedback) |
| 3 | FPP pointing-hand gesture on skill cast | ✅ (viewmodel arm, eases out) |
| 4 | Monster locomotion juice (squash/bob + roll) | ✅ |
| 5 | Grander arena (r 13→22) + crowd (448 heads) + visible opponent trainer | ✅ |
| 6 | Out-of-bounds fail-safe (per-frame clamp to arena) | ✅ (no physics engine; clamp substitutes for CCD) |
| 7 | Audio SFX — UI clicks + combat impacts (synthesized WebAudio) | ✅ code / ⚠️ UNVERIFIED (no audio device in sandbox) |
| 8 | Debug multipliers: Skill Cooldown × and Monster HP × (1x–6x) | ✅ (wired + unit-tested) |

---

## Feedback round 2 (physics / sync / slapstick)
| Item | Status |
|---|---|
| Slapstick miss reactions (TRIP/PANCAKE/SPIN/PINBALL/RECOIL/DIZZY/FACEPLANT) | ✅ data-driven from the §10 sheet, range-based hit/miss, animated |
| True rigid-body physics (Rapier) + solid walls | ✅ 400-impulse contained; replaces clamp |
| Tumble ragdoll on stun | ✅ free-rotation body tumble (not articulated) |
| Real impulse knockback (shove/recoil/pinball) | ✅ |
| Per-client synchronized combat | ✅ host-authoritative CombatRunner + 30Hz snapshot stream; identical snapshots on all clients verified over the wire |
| Synced arena render (clients render snapshots, relay intents) | ✅ (client render path; full browser↔server loop needs real hardware to feel latency) |
| Updated §5B status: stance is now instant + post-cooldown (feedback #2 r1) | ✅ |

### Scope notes (honest)
- Physics is **rigid-body + free-tumble ragdoll**, not jointed/articulated skeletons.
- Combat sync is **host-authoritative state replication** (not input-lockstep) — robust against physics non-determinism; physics/ragdoll are a per-client cosmetic layer driven by authoritative positions.
- Networked **prep-phase skill drafting** is not yet synced; networked bouts currently start fighters with free basics. Deferred.
- The browser↔server synced render couldn't be exercised in the headless sandbox (Playwright is network-isolated from localhost); verified instead via Node client↔server integration tests + single-player headless render.

---

## Feedback round 3
| Item | Status |
|---|---|
| Monsters can be pushed through walls | ✅ FIXED — dense overlapping wall ring + hard radial clamp in physics step; 2000-impulse spam kept both bodies at r≤10.5 in a radius-22 arena |
| FPP hand always visible | ✅ FIXED — viewmodel hidden at rest, shows only during the active-skill point gesture (~0.3s) |
| LMB click-to-move order (overrides stance; clears on arrival; interrupted by cast/stance change) | ✅ (shared move-order in combat model + runner + scene; works single-player and synced) |
| Shove rebound LMB → RMB (so LMB is the move order) | ✅ + context-menu suppressed |

## Feedback round 4 (networked prep, spectators, voice, LAN tooling)
| Item | Status |
|---|---|
| #1 Networked prep-phase drafting (authoritative) | ✅ server PrepSession + per-client PREP_SNAPSHOT + prepBuy; drafted loadout carries into the bout — verified over the wire |
| #1 Client net-prep board UI | ✅ NetPrepPhase (6 totem cards, slots, timer, buy) |
| #2 Manual spectator view | ✅ non-fighters get an elevated orbiting camera + "SPECTATING"; combat input disabled |
| #3 Proximity voice (WebRTC mesh, positional PannerNode, VAD, [V] mute) | ⚠️ BUILT, UNVERIFIED — no mic/peer/audio device in sandbox; needs real two-machine test |
| #4 Two-machine tooling | ✅ NET `<ms>` ping HUD + `docs/NETWORK_TESTING.md` run guide (feel itself is user-verified only) |

### Caveats
- Voice signaling relays through the host; code is defensive (no-ops without getUserMedia/RTCPeerConnection) but its runtime behavior is unverified by me.
- Spectator-thrown items are not yet authoritative (the §6 crowd auto-throw still drives arena throwables); manual spectator throwing is a follow-up.
- Combat sync has no client-side prediction — high ping will feel like input lag.

---

## Feedback round 5
| Item | Status |
|---|---|
| #1 Ragdoll→Get-Up→Active recovery (no prone sliding) | ✅ explicit get-up state locks movement; verified slide=0 during get-up |
| #2 Trainer HP — FPP HUD bar + overhead world-space bars | ✅ |
| #2 Damage rules: trainers can't hurt each other; monsters can hit trainers | ✅ (TrainerState, source-gated) |
| #3 Reticle-targeted Offensive `[Q]` (monster vs trainer) + red/orange highlight | ✅ |
| #4 AI trainer reaction delay (~3s, debug-tunable) → kite + retaliate | ✅ |
| #5 Aggro interception (bodyguard): monster contact breaks trainer-chase | ✅ |
| #6 Footstep SFX (cadence scales with velocity) | ✅ logic / ⚠️ sound UNVERIFIED (no audio device) |

### Notes
- "NavMeshAgent pause" mapped to our steering/velocity pause (no nav-mesh engine).
- #4/#5 run in the authoritative runner (networked) and the single-player scene.
- Footstep *trigger cadence* is unit-tested; the audio itself needs a real device.

---

## Feedback round 6
| Item | Status |
|---|---|
| Authoritative spectator throwing | ✅ host spawns/flies/resolves spectator throwables in CombatRunner; replicated via snapshots. Verified over the sim: spawn→arc→land→stun/confuse, empty-sand miss, fighter-rejection, arena clamp |
| Spectator throw UI (keys [1]/[2]/[3] lob tomato/stone/draft) + client arc render | ✅ (synced; relayed as combatSpecThrow) |
| Slapstick-miss visual tuning | ✅ anticipation + exaggerated squash/stretch, overshoot easing, bounces, longer readable timing, and dust-puff particles on impact |

### Notes
- Authoritative spectator throws lead a MOVING monster imperfectly (lobs land where aimed) — intentional; precise aiming is a later refinement.
- Slapstick timing/feel is partly subjective — tuned for readability; adjust to taste.

---

## Skill-effect system (depth pass — flesh out the 50 skills)
| Item | Status |
|---|---|
| Effect taxonomy mapping all 50 skills → 14 archetypes | ✅ (docs/SKILL_EFFECTS.md) |
| Authoritative effect engine (`src/shared/skillEffects.js`) | ✅ shared, deterministic, 14 archetypes |
| Combatant status/effect system (DoT, buffs, shields, statuses, Bide) | ✅ sleep/confuse/taunt/disable/panic/slow/haste/endure/hover/immune/reflect/vulnerable |
| Field hazards (spikes/ice/cloud/trap/whirlpool) persist + tick | ✅ entry damage / DoT / pull / slow; Fly ignores ground hazards |
| Wired into authoritative runner (networked) + single-player arena | ✅ HP routes through CombatMatch (Sudden Death preserved) |
| Hazard + status visuals (ground discs, projectiles, toasts) | ✅ archetype-level (not bespoke per-skill art) |
| 15 new effect-engine tests (115 total) | ✅ one representative per archetype |

### Notes / honest scope
- Mechanics are **distinct and tested**; visuals are **archetype-shared** (all projectiles look alike, etc.) — bespoke per-skill VFX is a later polish pass.
- A few statuses (Encore repeat, Thief item use, trainer-screen blinds) are modeled in state + events but their full feedback loops are light; flagged for follow-up.
- Numbers (DoT dps, hazard durations, status seconds) are first-pass — needs a balance tuning pass with real play.
