# SideQuest — Co-op Snake 🐍

A redesigned, two-player co-op Snake game. Team up to collect dots for a shared score while avoiding walls, your own body, and your teammate.

## Publish on GitHub Pages

1. Create a repository on GitHub.
2. Upload every file in this folder to the repository root.
3. Open **Settings → Pages**. Under Build and deployment, choose **Deploy from a branch**, select `main` and `/(root)`, then save.
4. Open the published Pages URL in two browsers/devices.
5. One player chooses **Create a room** and shares the code. The other enters it and chooses **Join**.

## Controls

- Move: arrow keys or `W A S D`
- Pause/resume: `P` (host) or the Pause button
- Mobile: on-screen directional pad
- Sound: use the sound toggle

## Multiplayer: what runs where?

GitHub Pages serves the static HTML, CSS and JavaScript; it does **not** run a live game server. The game uses WebRTC data channels via PeerJS. PeerJS's public signaling service helps the browsers discover each other; gameplay state is sent directly between the host browser and the joining browser. The host browser runs the authoritative game loop and must remain open.

This is the best practical no-custom-backend option, but it is not literally external-service-free: PeerJS signaling is external, and some networks prevent direct peer-to-peer connections. No TURN relay is configured, so some networks may fail to connect. For a strict GitHub-only setup with no external signaling service, players would need to exchange WebRTC connection details manually.

## Files

- `index.html` — redesigned lobby and game UI
- `style.css` — responsive visual design
- `game.js` — game logic, rendering, controls, and PeerJS connection
- `README.md` — setup and limitations
- `LICENSE` — MIT license
- `.gitignore` — common OS/editor exclusions

## Note

This is a casual browser game prototype, not a ranked or cheat-resistant multiplayer service. Room codes are short and should not be treated as private secrets.
