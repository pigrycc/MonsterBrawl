# Two-Machine Multiplayer Testing

This guide is the tooling + steps for the "real two-machine feel" test (feedback
#4) — something that can only be judged on actual hardware, not in CI.

## Run a host + a joiner

### Option A — packaged apps (recommended)
1. On **Machine H (host)**: launch `MonsterColiseumBrawl`, choose **Host Game**,
   set a room name + port (default `7777`), click **HOST GAME**. The app starts
   the authoritative server in-process and connects you as host.
2. Find Machine H's LAN IP (`ipconfig` on Windows, `ifconfig`/`ip addr` on
   macOS/Linux). Ensure the chosen port is allowed through the firewall.
3. On **Machine J (joiner)**: launch the app, choose **Join**, enter
   `MACHINE_H_IP : 7777` under Direct Connect, click **JOIN**.
4. Host selects a monster and presses **START MATCH**. Both machines run the
   authoritative prep draft, then the synced bout.

### Option B — dev / same LAN without packaging
1. On the host machine: `npm install` then `npm run server 7777` (binds all
   interfaces). In another terminal: `npm run dev` and open the Vite URL; choose
   **Join** → `127.0.0.1:7777`.
2. On the second machine (same LAN): open `http://MACHINE_H_IP:5173` (Vite dev
   server) and **Join** → `MACHINE_H_IP:7777`.

## What to check (the "feel" the sandbox can't judge)
- **Sync:** do both machines see the *same* monster positions, HP, and the same
  winner? (The `NET <ms>` readout top-right shows your ping.)
- **Responsiveness:** stance/skill/shove latency at your real ping.
- **Click-to-move / drafting:** do intents from the joiner resolve on the host?
- **Proximity voice (#3, UNVERIFIED in CI):** with mics on both machines, can
  you hear each other, and does the volume fall off with distance? `[V]` mutes.
  Browsers require **HTTPS or localhost** for mic access and a user gesture —
  packaged Electron is fine; for the dev/web path use localhost or https.

## Spectators
Any 3rd+ player who joins but isn't one of the two fighters automatically enters
**spectator mode** (elevated orbiting camera, "👁 SPECTATING"), watching the
authoritative bout.

## Known limitations to keep in mind while testing
- Combat sync is **host-authoritative state replication** (not lockstep); there
  is no client-side prediction yet, so high ping will feel like input lag.
- Proximity voice is **best-effort WebRTC** and was **not runtime-verified** in
  development — report whether it connects at all.
- NAT/WAN play needs port-forwarding to the host; LAN is the tested path.
