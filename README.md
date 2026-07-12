# 🗡️ IMPOSTER — Social Deduction Party Game

A complete, self-contained multiplayer party game with two modes:

| Mode | How it works |
|---|---|
| **Local Pass & Play** | 3–10 players share one device. Runs 100% in the browser (state in memory + `localStorage` for saved names). |
| **Online Multiplayer** | Up to 16 players, each on their own device. Node.js + Express + Socket.io with all room state held in server memory — no database. |

## Quick start

```bash
npm install
npm start
# → open http://localhost:3000
```

To play online with friends on the same network, share `http://<your-LAN-IP>:3000` and the 4-digit room code. (Deploy the same folder to any Node host for internet play.)

Verify the server game engine without a browser:

```bash
node test-harness.js   # 23 offline integration assertions against server.js
```

## Rules

1. Each round the engine picks a random **Category** and **Target Word** from `public/words.js`.
2. Every player privately receives the word — except one random **Imposter**, who sees only the category and *"YOU ARE THE IMPOSTER. Blend in!"*.
3. **Discussion** (3 / 4 / 5 min): players take turns asking each other questions about the word. A rotating highlight (30s per turn) shows whose turn it is to ask.
4. **Voting**: everyone votes for who they think the Imposter is.
5. **Win conditions**
   - **Citizens win** if the Imposter receives the most votes (strict plurality — ties protect the Imposter) *and* the caught Imposter fails their 25-second "Last Stand" word guess.
   - **The Imposter wins** by surviving the vote, **or** by typing the exact Target Word at any point during a live round (matching is case/spacing/punctuation-insensitive). A wrong mid-round strike exposes them and hands Citizens the win.

## Architecture

```
imposter-game/
├── server.js           # Express + Socket.io backend (online mode)
│                       #   phase machine: lobby → reveal → discussion → voting → lastStand → results
│                       #   in-memory rooms, private role emits, live vote broadcasts,
│                       #   vote-lock grace window, host migration, disconnect forfeits
├── public/
│   ├── index.html      # Tailwind CDN theme config, fonts, app shell, anti-peek overlay
│   ├── app.js          # UI state machine (vanilla JS): screen registry + delegated actions
│   │                   #   LOCAL engine (sequential reveal, arena, secret ballots, tally)
│   │                   #   ONLINE client (socket wiring, lobby, live vote bars, timers)
│   └── words.js        # Shared dictionary (browser global + Node module, no build step)
├── test-harness.js     # Offline integration test with mocked express/socket.io
└── package.json
```

### Design notes

- **Anti-peek blackout** — every local hand-off renders the *next hidden state* into the DOM first, then covers the screen with a pure-black overlay, so a secret is never present behind the curtain.
- **Server-authoritative online play** — the word and the Imposter's identity never appear in any broadcast payload; roles are pushed only to each player's private socket. Clients derive timers from server-issued epoch timestamps, so countdowns stay in sync.
- **Vote-lock grace window** — once every connected player has voted, a 4-second "locking" countdown starts; withdrawing a vote (tiles are toggleable) cancels it.
- **Resilience** — host migration on host disconnect, Imposter disconnect forfeits the round, rooms with fewer than 3 live players end gracefully, and empty rooms are garbage-collected after 60s.

### Theme

Dark, high-contrast palette: Zinc/Slate surfaces · Indigo/Violet accents · Emerald success states · Rose for danger and everything Imposter. Display type: Space Grotesk; body: Inter.
