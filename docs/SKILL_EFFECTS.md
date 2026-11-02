# Skill Effect System — design map

Goal: turn the 50 skills from "damage + maybe stun" into **mechanically distinct**
effects, data-driven from the CSV. Rather than 50 bespoke one-offs, each skill is
tagged with an **effect archetype** (+ parameters). The authoritative engine
(`src/shared/skillEffects.js`) resolves archetypes against the combat sim, so the
same logic runs single-player and networked.

## Effect archetypes

| Archetype | Behavior |
|---|---|
| `DIRECT` | Instant hit on the foe if in range (melee/short). |
| `PROJECTILE` | Travels to the foe over flight time; hits on arrival (dodgeable by distance). |
| `BEAM` | Instant line hit at long range; some recoil the user. |
| `AOE` | Radius burst at a point (self or target); hits anyone inside. |
| `DOT` | Applies damage-over-time ticks for a duration. |
| `HAZARD` | Spawns a persistent field hazard (spikes/ice/oil/cloud) that affects whoever enters. |
| `SELF_BUFF` | Buffs the caster (speed/damage/evasion) for a duration. |
| `SHIELD` | Temporary damage block / reflect in front of the caster. |
| `HEAL` | Restores the caster's HP (often with a vulnerability window). |
| `TELEPORT` | Repositions the caster (blink / bounce / dig / fly). |
| `STATUS` | Applies a control debuff to the foe (sleep/confuse/taunt/disable/panic). |
| `CHARGE_COUNTER` | Absorbs incoming damage for a window, then returns it. |
| `KNOCKBACK` | Pushes the foe away (shockwave / roar). |
| `RECOIL_SELF` | Damages/knocks the CASTER (take_down / self_destruct / hyper_beam lock). |

Status sub-kinds: `sleep`, `confuse`, `taunt`, `disable`, `panic`, `slow`, `vulnerable`.

## Per-skill mapping (all 50)

| ID | Skill | Element | Archetype | Notes / parameters |
|----|-------|---------|-----------|--------------------|
| 1 | Tackle | Neutral | DIRECT | melee; miss→TRIP (slapstick) |
| 2 | Body_Slam | Neutral | AOE | short radius; self-centered leap |
| 3 | Rollout | Earth | PROJECTILE | fast linear; pinball miss |
| 4 | Take_Down | Neutral | DIRECT + RECOIL_SELF | hits foe, recoils self |
| 5 | Headbutt | Neutral | DIRECT | melee; basic for Terrataur |
| 6 | Mega_Punch | Neutral | DIRECT | heavy; windup; spin miss |
| 7 | Mega_Kick | Neutral | DIRECT | heavy; windup |
| 8 | Double_Slap | Neutral | DIRECT | fast, low dmg (×2 flavor) |
| 9 | Bite | Neutral | DIRECT | melee |
| 10 | Lick | Neutral | DIRECT + STATUS(slow) | cone-short; brief slow |
| 11 | Ember | Fire | PROJECTILE | small bouncing projectile |
| 12 | Flamethrower | Fire | DOT (cone) | sustained fire ticks; recoil push |
| 13 | Water_Gun | Water | BEAM | fast thin beam; basic for Aquaslug |
| 14 | Hydro_Pump | Water | BEAM + RECOIL_SELF | heavy beam; launches user back |
| 15 | Mud_Slap | Earth | PROJECTILE + STATUS(blind-trainer) | arc; screen splatter |
| 16 | Sludge_Bomb | Earth | AOE + HAZARD(slip) | burst + slippery puddle |
| 17 | Bullet_Seed | Grass | PROJECTILE | rapid multi-hit; basic for Galebird |
| 18 | Rock_Throw | Earth | PROJECTILE | physics rock |
| 19 | Zap_Cannon | Electric | PROJECTILE(slow) + STATUS(stun) | slow orb; 100% stun on hit |
| 20 | Hyper_Beam | Neutral | BEAM + RECOIL_SELF(lock) | huge dmg; user immobilized 2s after |
| 21 | Rock_Slide | Earth | AOE (target) | boulders at a point |
| 22 | Earthquake | Earth | AOE (radial) | hits all grounded |
| 23 | Poison_Gas | Neutral | HAZARD(cloud) + DOT | lingering poison cloud |
| 24 | Fire_Spin | Fire | HAZARD(trap) + DOT | vortex traps + ticks |
| 25 | Whirlpool | Water | HAZARD(pull) + DOT | pulls toward center |
| 26 | Sandstorm | Earth | KNOCKBACK (arena push) | sideways push |
| 27 | Spikes | Earth | HAZARD(floor) | caltrops; dmg on entry |
| 28 | Toxic_Spikes | Earth | HAZARD(floor) + DOT | poison on entry |
| 29 | Icy_Wind | Water | HAZARD(ice) + STATUS(slow) | ice sheet; low friction |
| 30 | Self_Destruct | Fire | AOE(point-blank) + RECOIL_SELF | massive; user→1 HP |
| 31 | Bounce | Flying | TELEPORT(up) | leaves + crashes down near foe |
| 32 | Dig | Earth | TELEPORT(sub) + DIRECT | burrow, erupt under foe |
| 33 | Agility | Neutral | SELF_BUFF(speed) | +100% speed |
| 34 | Withdraw | Water | SHIELD(immune) | fully immune briefly; kickable |
| 35 | Roar | Neutral | KNOCKBACK | cone shockwave |
| 36 | Tail_Whip | Neutral | STATUS(vulnerable) | increases foe cooldowns/confusion |
| 37 | Teleport | Neutral | TELEPORT(blink) | reappear behind foe |
| 38 | Endure | Neutral | SELF_BUFF(endure) | HP can't drop below 1 for 3s |
| 39 | Fly | Flying | SELF_BUFF(hover) | immune to ground hazards 4s |
| 40 | Bide | Neutral | CHARGE_COUNTER | absorb 2s → return stored dmg |
| 41 | Thief | Neutral | DIRECT + steal | snatch carried item |
| 42 | Yawn | Neutral | STATUS(sleep) | cancels foe windup |
| 43 | Screech | Neutral | STATUS(panic) | foe flees 2s |
| 44 | Taunt | Neutral | STATUS(taunt) | forces foe to rush straight 3s |
| 45 | Rest | Neutral | HEAL | +40 HP, helpless 3s |
| 46 | Smokescreen | Neutral | HAZARD(blind-cloud) | black cloud blinds trainers |
| 47 | Confuse_Ray | Electric | STATUS(confuse) | homing; 50% self-hit |
| 48 | Reflect | Neutral | SHIELD(reflect) | bounces projectiles back |
| 49 | Encore | Neutral | STATUS(encore) | foe repeats last skill |
| 50 | Disable | Neutral | STATUS(disable) | locks foe's last skill slot 5s |

## Open design questions (flag before/while implementing)
- **Trainer-targeted skills:** most skills target the foe monster; a few (Mud_Slap,
  Smokescreen, Poison_Gas) blind the *trainer*. I'll apply a short FPP screen
  effect for those when the foe is near the player.
- **Encore/Disable/Thief** need the foe's "last skill" + carried-item state, which
  partly exist; I'll stub the missing bits rather than block the whole system.
- **Hazards** persist on the field and need per-tick entry checks — adds a hazard
  list to the authoritative sim.
