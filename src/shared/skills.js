/**
 * Skill database loader + query helpers.
 *
 * The canonical source of truth is assets/data/skills.csv (the GDD §10 sheet).
 * For runtime we bundle a parsed copy so the data layer works identically in the
 * browser renderer, the Node authoritative server, and headless tests — none of
 * which should depend on fetch()/fs at import time.
 *
 * NOTE (data correction): the source sheet had Windup_Sec for skills 19, 20 and
 * 30 corrupted by spreadsheet date auto-formatting (e.g. "2026-01-02"). These are
 * restored here to their intended heavy-attack wind-ups: 2.5 / 5.0 / 5.0 seconds.
 */

/** @typedef {'Neutral'|'Fire'|'Water'|'Earth'|'Electric'|'Flying'|'Grass'} Element */

/**
 * @typedef {Object} Skill
 * @property {number} id
 * @property {string} name          Human display name ("Body Slam")
 * @property {string} key           Raw key from sheet ("Body_Slam")
 * @property {Element} element
 * @property {number} cost          Gold cost (0/10/20/30...)
 * @property {number} cooldown      Seconds
 * @property {number} windup        Seconds
 * @property {number} damage
 * @property {number} stamina       Stamina cost
 * @property {string} targetType
 * @property {string} vfx           3D visual effect description
 * @property {string} slapstick     Slapstick penalty / comedic mechanic
 */

/** Raw rows mirror assets/data/skills.csv exactly (with the 3 corrections). */
const RAW = [
  [1, 'Tackle', 'Neutral', 0, 4.0, 0.2, 15, 10, 'Melee', 'Monster thrusts forward with physical velocity', 'Miss causes monster to trip and stumble forward in ragdoll'],
  [2, 'Body_Slam', 'Neutral', 10, 7.0, 0.8, 30, 25, 'Melee_AoE', 'High vertical leap followed by a flat belly flop', 'Pancakes flat on sand; 1s recovery if completely misses'],
  [3, 'Rollout', 'Earth', 15, 8.0, 0.4, 25, 20, 'Linear_Physics', 'Curls into a ball and rolls forward at high speed', 'Bounces violently off coliseum walls like a pinball'],
  [4, 'Take_Down', 'Neutral', 10, 6.0, 0.5, 35, 30, 'Melee_Recoil', 'Aggressive sprint leaving dust trails behind', 'Collision knocks back both target and attacker in ragdoll'],
  [5, 'Headbutt', 'Neutral', 0, 5.0, 0.3, 18, 12, 'Melee', 'Violent forward skull snap with yellow spark VFX', 'Hitting a stone wall stuns the user for 1.5 seconds'],
  [6, 'Mega_Punch', 'Neutral', 20, 9.0, 1.0, 45, 35, 'Melee', 'Front fist scales up cartoonishly to double size', 'Overswing spins monster around 360 degrees on miss'],
  [7, 'Mega_Kick', 'Neutral', 20, 8.5, 0.7, 40, 30, 'Melee', 'Windmill roundhouse kick with swoosh trail', 'Kicking into a shield deflects monster backwards'],
  [8, 'Double_Slap', 'Neutral', 0, 3.5, 0.1, 12, 8, 'Melee', 'Two rapid cartoon slaps with sound pops', 'Monster gets briefly dizzy if target steps out of reach'],
  [9, 'Bite', 'Neutral', 0, 4.5, 0.3, 16, 10, 'Melee', 'Snap of oversized glowing cartoon jaws', 'Chomps empty air with a loud comedic jaw snap'],
  [10, 'Lick', 'Neutral', 10, 6.0, 0.4, 10, 15, 'Cone_Short', 'Tongue extends 2.5m slapping target with slime', 'Leaves user tongue hanging out paralyzed for 0.5s'],
  [11, 'Ember', 'Fire', 0, 4.0, 0.3, 14, 10, 'Projectile', 'Three small bouncing fireballs launched in spread', 'May accidentally ignite dry grass or wooden debris on arena'],
  [12, 'Flamethrower', 'Fire', 20, 9.0, 0.5, 40, 35, 'Continuous_Cone', 'Sustained torrent of cartoon fire particles for 2s', 'Recoil slowly pushes monster backward while firing'],
  [13, 'Water_Gun', 'Water', 0, 3.5, 0.2, 12, 8, 'Fast_Beam', 'Thin pressurized water jet with splash ring', 'Pushes back lightweight objects and extinguishes fire'],
  [14, 'Hydro_Pump', 'Water', 25, 10.0, 0.8, 50, 40, 'Heavy_Beam', 'Massive surging water blast pushing all physics props', 'Massive recoil launches user 3 meters backwards'],
  [15, 'Mud_Slap', 'Earth', 0, 4.0, 0.2, 10, 10, 'Projectile_Arc', 'Lump of wet brown mud thrown on ballistic arc', "Splatters mud directly across opposing trainer's FPP screen"],
  [16, 'Sludge_Bomb', 'Earth', 15, 7.5, 0.6, 28, 22, 'Ballistic_AoE', 'Toxic purple sludge globule bursting on impact', 'Leaves slippery puddle that causes all characters to slide'],
  [17, 'Bullet_Seed', 'Grass', 10, 5.0, 0.2, 18, 15, 'Rapid_Projectiles', 'Machine-gun burst of 5 glowing green seeds', 'Empty casing seeds scatter and create tripping hazards'],
  [18, 'Rock_Throw', 'Earth', 0, 5.0, 0.6, 18, 14, 'Physics_Prop', 'Pulls a jagged stone from ground and chucks it', 'Rock stays on arena as a physical rolling obstacle'],
  [19, 'Zap_Cannon', 'Electric', 30, 12.0, 2.5, 60, 50, 'Slow_Orb', 'Humongous crackling plasma sphere flying slowly', '100% taser electrocution ragdoll if it lands'],
  [20, 'Hyper_Beam', 'Neutral', 30, 14.0, 5.0, 70, 60, 'Direct_Ray', 'Blinding cylindrical death ray piercing arena', 'User is completely immobilized for 2s after beam ends'],
  [21, 'Rock_Slide', 'Earth', 20, 8.0, 0.7, 35, 30, 'Target_AoE', 'Shadow appears on sand then 4 boulders fall', 'Boulders can crush either monster if they are in grapple'],
  [22, 'Earthquake', 'Earth', 25, 11.0, 0.8, 40, 35, 'Radial_AoE', 'Monster slams floor sending circular shockwave', 'Trips any monster or trainer touching arena ground'],
  [23, 'Poison_Gas', 'Neutral', 10, 6.5, 0.4, 15, 18, 'Lingering_Cloud', 'Dense green smoke cloud expanding over 4m radius', 'Completely blinds trainer view inside the smoke plume'],
  [24, 'Fire_Spin', 'Fire', 15, 7.0, 0.5, 24, 20, 'Trap_AoE', 'Vortex ring of fire trapping target inside', 'User gets pulled toward vortex if positioned too close'],
  [25, 'Whirlpool', 'Water', 15, 7.5, 0.5, 22, 20, 'Gravity_Vortex', 'Swirling water pool drawing props and monsters to center', 'Sucks in thrown spectator items and consumes them'],
  [26, 'Sandstorm', 'Earth', 10, 6.0, 0.4, 10, 15, 'Arena_Push', 'Gale of desert sand pushing entities sideways', 'Pushes trainer hats and light debris across coliseum'],
  [27, 'Spikes', 'Earth', 10, 5.0, 0.3, 0, 12, 'Floor_Hazard', 'Scatters 4 sharp caltrops around monster perimeter', 'Stepping on caltrops causes hopping-on-one-leg animation'],
  [28, 'Toxic_Spikes', 'Earth', 15, 6.5, 0.3, 5, 16, 'Floor_Hazard', 'Scatters 4 venomous purple spikes on arena sand', 'Afflicts 3s poison DOT to whoever steps on them'],
  [29, 'Icy_Wind', 'Water', 15, 7.0, 0.4, 20, 18, 'Cone_Floor', 'Freezing breeze turning arena floor into ice sheet', 'Friction reduced to zero; models slide uncontrollably'],
  [30, 'Self_Destruct', 'Fire', 30, 15.0, 5.0, 80, 90, 'Point_Blank_AoE', 'Monster inflates like a spherical red balloon and pops', 'Deals massive damage but leaves user at 1 HP'],
  [31, 'Bounce', 'Flying', 15, 7.0, 0.4, 25, 20, 'Vertical_Escape', 'Springs 10 meters into the air out of sight for 1.5s', 'Crash lands on randomized position near target'],
  [32, 'Dig', 'Earth', 15, 8.0, 0.5, 28, 22, 'Subterranean', 'Burrows under sand leaving moving mound of dirt', 'Erupts upward under target launching them into air'],
  [33, 'Agility', 'Neutral', 10, 8.0, 0.1, 0, 15, 'Self_Buff', 'Blue speed trails and wind lines emit from paws', 'Runs 100% faster but has extreme inertia on turns'],
  [34, 'Withdraw', 'Water', 10, 6.0, 0.1, 0, 10, 'Self_Defense', 'Pulls limbs inside shell becoming completely immune', 'Target can be physically kicked around the arena like ball'],
  [35, 'Roar', 'Neutral', 0, 5.0, 0.2, 0, 10, 'Cone_Knockback', 'Concentric shockwave rings blasting from open mouth', 'Physically blows back trainers and loose dropped items'],
  [36, 'Tail_Whip', 'Neutral', 0, 4.0, 0.2, 0, 8, 'Melee_Debuff', 'Comical wagging spin of rear end toward enemy', 'Causes victim monster to look confused increasing cooldowns'],
  [37, 'Teleport', 'Neutral', 15, 7.0, 0.1, 0, 12, 'Self_Blink', 'Pops out of existence with purple cartoon sparkle', 'Reappears 5 meters behind enemy trainer'],
  [38, 'Endure', 'Neutral', 10, 9.0, 0.1, 0, 25, 'Self_Buff', 'Claws dig into ground surrounded by red rage aura', 'HP cannot drop below 1 for the next 3 seconds'],
  [39, 'Fly', 'Flying', 15, 8.0, 0.3, 20, 20, 'Vertical_Stance', 'Hovers 1.5 meters above ground for 4 seconds', 'Completely immune to ground hazards (oil spikes ice)'],
  [40, 'Bide', 'Neutral', 20, 10.0, 0.2, 0, 30, 'Charge_Counter', 'Absorbs all damage taken over 2s while turning red', 'Fires stored damage back in one devastating punch'],
  [41, 'Thief', 'Neutral', 10, 6.0, 0.3, 12, 12, 'Melee_Steal', 'Sneaky dash snatching item carried by opposing trainer', 'Monster immediately consumes stolen item (e.g. potion)'],
  [42, 'Yawn', 'Neutral', 10, 7.0, 0.5, 0, 15, 'Target_Status', 'Spawns floating translucent Zzz bubbles toward foe', 'Victim falls asleep standing up cancelling active windup'],
  [43, 'Screech', 'Neutral', 0, 4.5, 0.2, 0, 10, 'Radial_Debuff', 'Ear-piercing sound waves with floating broken music notes', 'Target monster runs away in blind panic for 2s'],
  [44, 'Taunt', 'Neutral', 0, 4.0, 0.1, 0, 8, 'Target_Taunt', 'Slaps own buttocks and makes rude face at opponent', 'Forces enemy AI to rush blindly in straight line for 3s'],
  [45, 'Rest', 'Neutral', 20, 12.0, 0.2, 0, 0, 'Self_Heal', 'Collapses on side with nightcap and loud snoring bubble', 'Regenerates 40 HP but is fully helpless for 3 seconds'],
  [46, 'Smokescreen', 'Neutral', 0, 5.0, 0.2, 0, 10, 'Blind_Cloud', 'Puffs thick pitch-black exhaust cloud', 'Trainers in cloud see purely black screen for 3s'],
  [47, 'Confuse_Ray', 'Electric', 15, 7.5, 0.3, 0, 15, 'Homing_Wisp', 'Wobbly rainbow orb drifting toward target', 'Target has 50% chance to punch itself on next attack'],
  [48, 'Reflect', 'Neutral', 20, 9.0, 0.2, 0, 20, 'Front_Barrier', 'Spawns polygonal glass shield wall in front of paws', 'Bounces incoming projectiles directly back at sender'],
  [49, 'Encore', 'Neutral', 10, 6.0, 0.2, 0, 12, 'Status_Curse', 'Spawns party confetti and clapping sound effects', 'Forces opponent to repeat their last used skill again'],
  [50, 'Disable', 'Neutral', 15, 8.0, 0.3, 0, 15, 'Ranged_Gaze', 'Twin red psychic beams hitting enemy monster', "Locks opponent's most recently used skill slot for 5s"],
];

/** @type {Skill[]} */
export const SKILLS = RAW.map((r) => ({
  id: r[0],
  key: r[1],
  name: String(r[1]).replace(/_/g, ' '),
  element: r[2],
  cost: r[3],
  cooldown: r[4],
  windup: r[5],
  damage: r[6],
  stamina: r[7],
  targetType: r[8],
  vfx: r[9],
  slapstick: r[10],
}));

/** Fast lookup maps. */
const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
const BY_KEY = new Map(SKILLS.map((s) => [s.key.toLowerCase(), s]));

/** @param {number} id @returns {Skill|undefined} */
export const getSkillById = (id) => BY_ID.get(id);
/** @param {string} key @returns {Skill|undefined} */
export const getSkillByKey = (key) => BY_KEY.get(String(key).toLowerCase());

/** All distinct elements present in the database. */
export const ELEMENTS = [...new Set(SKILLS.map((s) => s.element))];

/** @param {Element} element @returns {Skill[]} */
export const skillsByElement = (element) =>
  SKILLS.filter((s) => s.element === element);

/** Skills that cost 0 gold (always affordable). */
export const freeSkills = () => SKILLS.filter((s) => s.cost === 0);

/** @param {number} gold @returns {Skill[]} skills a player with `gold` can afford */
export const affordableSkills = (gold) => SKILLS.filter((s) => s.cost <= gold);

export const SKILL_COUNT = SKILLS.length;
