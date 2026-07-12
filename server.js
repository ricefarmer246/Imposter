/**
 * server.js — Imposter Party Game (Online Multiplayer backend)
 *
 * Node.js + Express + Socket.io. All game state is held in memory.
 *
 * Phase machine per room:
 *   lobby -> reveal -> discussion -> voting -> (lastStand) -> results -> lobby
 *
 * Win conditions:
 *   - Citizens win when the Imposter receives the most votes (strict plurality)
 *     and then fails (or times out) their "last stand" word guess.
 *   - The Imposter wins by surviving the vote (not strict plurality target),
 *     or by guessing the exact target word at any time.
 */

"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const WORDS = require("./public/words.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 16;
const VALID_DISCUSSION_SECONDS = [180, 240, 300];
const TURN_SECONDS = 30;          // question-turn rotation length
const VOTING_TIMEOUT_MS = 90_000; // hard cap on the voting phase
const VOTE_LOCK_MS = 4_000;       // grace window once everyone has voted
const LAST_STAND_MS = 25_000;     // caught imposter's final guess window
const EMPTY_ROOM_TTL_MS = 60_000; // delete a room this long after it empties

/** @type {Map<string, Room>} */
const rooms = new Map();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function sanitizeName(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 14);
}

function normalizeGuess(raw) {
  return String(raw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createRoom(hostSocket, hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId: hostSocket.id,
    phase: "lobby",
    round: 0,
    players: new Map(), // socketId -> player
    category: null,
    word: null,
    imposterId: null,
    discussionSeconds: 240,
    discussionStartAt: null,
    discussionEndsAt: null,
    votingEndsAt: null,
    timers: { phase: null, voteLock: null, cleanup: null }
  };
  addPlayer(room, hostSocket, hostName);
  rooms.set(code, room);
  return room;
}

function addPlayer(room, socket, name) {
  const player = {
    id: socket.id,
    name,
    connected: true,
    ready: false,
    vote: null, // socketId of the accused, or null
    isImposter: false
  };
  room.players.set(socket.id, player);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  return player;
}

function clearTimer(room, key) {
  if (room.timers[key]) {
    clearTimeout(room.timers[key]);
    room.timers[key] = null;
  }
}

function clearAllTimers(room) {
  Object.keys(room.timers).forEach((k) => clearTimer(room, k));
}

function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

/** Public snapshot — never leaks the word or the imposter's identity. */
function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    category: room.phase === "lobby" ? null : room.category,
    discussionSeconds: room.discussionSeconds,
    discussionStartAt: room.discussionStartAt,
    discussionEndsAt: room.discussionEndsAt,
    votingEndsAt: room.votingEndsAt,
    turnSeconds: TURN_SECONDS,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      hasVoted: p.vote !== null
    }))
  };
}

function broadcastState(room) {
  io.to(room.code).emit("room:state", publicRoomState(room));
}

function voteCounts(room) {
  const counts = {};
  for (const p of room.players.values()) counts[p.id] = 0;
  for (const p of room.players.values()) {
    if (p.vote && counts[p.vote] !== undefined) counts[p.vote] += 1;
  }
  return counts;
}

function broadcastVotes(room) {
  const eligible = connectedPlayers(room).length;
  const votedCount = connectedPlayers(room).filter((p) => p.vote !== null).length;
  io.to(room.code).emit("vote:update", {
    counts: voteCounts(room),
    votedCount,
    eligible
  });
}

/* ------------------------------------------------------------------ */
/* Phase transitions                                                   */
/* ------------------------------------------------------------------ */

function startGame(room, requestedSeconds) {
  const active = connectedPlayers(room);
  if (active.length < MIN_PLAYERS) return { error: `Need at least ${MIN_PLAYERS} connected players.` };

  clearAllTimers(room);
  room.round += 1;
  room.discussionSeconds = VALID_DISCUSSION_SECONDS.includes(requestedSeconds)
    ? requestedSeconds
    : 240;

  // Pick category, word, and imposter.
  const category = pickRandom(Object.keys(WORDS));
  const word = pickRandom(WORDS[category]);
  const imposter = pickRandom(active);

  room.category = category;
  room.word = word;
  room.imposterId = imposter.id;
  room.phase = "reveal";
  room.discussionStartAt = null;
  room.discussionEndsAt = null;
  room.votingEndsAt = null;

  for (const p of room.players.values()) {
    p.ready = false;
    p.vote = null;
    p.isImposter = p.id === imposter.id;
  }

  // Private role delivery — pushed straight to each player's personal view.
  for (const p of active) {
    io.to(p.id).emit("game:role", {
      round: room.round,
      category,
      isImposter: p.isImposter,
      word: p.isImposter ? null : word
    });
  }

  broadcastState(room);
  return { ok: true };
}

function startDiscussion(room) {
  clearAllTimers(room);
  room.phase = "discussion";
  room.discussionStartAt = Date.now();
  room.discussionEndsAt = room.discussionStartAt + room.discussionSeconds * 1000;

  // The deterministic question order (clients rotate the highlight locally).
  const order = connectedPlayers(room).map((p) => ({ id: p.id, name: p.name }));
  io.to(room.code).emit("discussion:start", {
    startAt: room.discussionStartAt,
    endsAt: room.discussionEndsAt,
    turnSeconds: TURN_SECONDS,
    order
  });

  room.timers.phase = setTimeout(() => startVoting(room), room.discussionSeconds * 1000);
  broadcastState(room);
}

function startVoting(room) {
  if (room.phase !== "discussion") return;
  clearAllTimers(room);
  room.phase = "voting";
  room.votingEndsAt = Date.now() + VOTING_TIMEOUT_MS;
  for (const p of room.players.values()) p.vote = null;

  io.to(room.code).emit("voting:start", { endsAt: room.votingEndsAt });
  room.timers.phase = setTimeout(() => tallyVotes(room), VOTING_TIMEOUT_MS);
  broadcastState(room);
  broadcastVotes(room);
}

function maybeLockVotes(room) {
  const active = connectedPlayers(room);
  const everyoneVoted = active.length > 0 && active.every((p) => p.vote !== null);

  if (everyoneVoted && !room.timers.voteLock) {
    io.to(room.code).emit("vote:locking", { inMs: VOTE_LOCK_MS });
    room.timers.voteLock = setTimeout(() => tallyVotes(room), VOTE_LOCK_MS);
  } else if (!everyoneVoted && room.timers.voteLock) {
    clearTimer(room, "voteLock");
    io.to(room.code).emit("vote:unlocked");
  }
}

function tallyVotes(room) {
  if (room.phase !== "voting") return;
  clearAllTimers(room);

  const counts = voteCounts(room);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [topId, topVotes] = entries[0] || [null, 0];
  const isTie = entries.length > 1 && entries[1][1] === topVotes;
  const accusedId = !isTie && topVotes > 0 ? topId : null;

  if (accusedId === room.imposterId) {
    // Caught — but the imposter gets one dramatic final guess.
    startLastStand(room);
  } else {
    endGame(room, {
      outcome: "imposter",
      reason: accusedId
        ? `${room.players.get(accusedId)?.name || "An innocent citizen"} was voted out — the Imposter survived.`
        : "The vote was inconclusive — the Imposter survived."
    });
  }
}

function startLastStand(room) {
  room.phase = "lastStand";
  const endsAt = Date.now() + LAST_STAND_MS;
  io.to(room.code).emit("lastStand:start", {
    endsAt,
    accusedId: room.imposterId,
    accusedName: room.players.get(room.imposterId)?.name || "The Imposter",
    category: room.category
  });
  room.timers.phase = setTimeout(() => {
    endGame(room, {
      outcome: "citizens",
      reason: "The Imposter was caught and ran out of time to guess the word."
    });
  }, LAST_STAND_MS);
  broadcastState(room);
}

function endGame(room, { outcome, reason }) {
  clearAllTimers(room);
  room.phase = "results";

  const counts = voteCounts(room);
  io.to(room.code).emit("game:over", {
    outcome, // 'citizens' | 'imposter'
    reason,
    category: room.category,
    word: room.word,
    imposterId: room.imposterId,
    imposterName: room.players.get(room.imposterId)?.name || "Unknown",
    votes: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      votes: counts[p.id] || 0,
      isImposter: p.isImposter,
      connected: p.connected
    }))
  });
  broadcastState(room);
}

function resetToLobby(room) {
  clearAllTimers(room);
  // Drop players who disconnected mid-game.
  for (const [id, p] of room.players) {
    if (!p.connected) room.players.delete(id);
  }
  room.phase = "lobby";
  room.category = null;
  room.word = null;
  room.imposterId = null;
  room.discussionStartAt = null;
  room.discussionEndsAt = null;
  room.votingEndsAt = null;
  for (const p of room.players.values()) {
    p.ready = false;
    p.vote = null;
    p.isImposter = false;
  }
  broadcastState(room);
}

/* ------------------------------------------------------------------ */
/* Socket wiring                                                       */
/* ------------------------------------------------------------------ */

function getRoomOf(socket) {
  return rooms.get(socket.data.roomCode) || null;
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }, ack) => {
    const cleanName = sanitizeName(name);
    if (!cleanName) return ack({ error: "Enter a name first." });
    if (socket.data.roomCode) return ack({ error: "You are already in a room." });

    const room = createRoom(socket, cleanName);
    clearTimer(room, "cleanup");
    ack({ ok: true, code: room.code, selfId: socket.id, state: publicRoomState(room) });
  });

  socket.on("room:join", ({ code, name }, ack) => {
    const cleanName = sanitizeName(name);
    const room = rooms.get(String(code || "").trim());
    if (!cleanName) return ack({ error: "Enter a name first." });
    if (!room) return ack({ error: "Room not found. Check the 4-digit code." });
    if (room.phase !== "lobby") return ack({ error: "That game is already in progress." });
    if (connectedPlayers(room).length >= MAX_PLAYERS) return ack({ error: "That room is full." });
    if (connectedPlayers(room).some((p) => p.name.toLowerCase() === cleanName.toLowerCase())) {
      return ack({ error: "That name is taken in this room." });
    }

    clearTimer(room, "cleanup");
    addPlayer(room, socket, cleanName);
    ack({ ok: true, code: room.code, selfId: socket.id, state: publicRoomState(room) });
    broadcastState(room);
  });

  socket.on("room:leave", () => leaveRoom(socket));

  socket.on("game:start", ({ discussionSeconds }, ack) => {
    const room = getRoomOf(socket);
    if (!room) return ack({ error: "Room no longer exists." });
    if (socket.id !== room.hostId) return ack({ error: "Only the host can start the game." });
    if (room.phase !== "lobby") return ack({ error: "Game already started." });
    const result = startGame(room, Number(discussionSeconds));
    ack(result.error ? result : { ok: true });
  });

  socket.on("player:ready", () => {
    const room = getRoomOf(socket);
    if (!room || room.phase !== "reveal") return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.ready = true;
    broadcastState(room);

    if (connectedPlayers(room).every((p) => p.ready)) startDiscussion(room);
  });

  socket.on("discussion:skipToVote", () => {
    const room = getRoomOf(socket);
    if (!room || room.phase !== "discussion") return;
    if (socket.id !== room.hostId) return;
    startVoting(room);
  });

  socket.on("vote:cast", ({ targetId }) => {
    const room = getRoomOf(socket);
    if (!room || room.phase !== "voting") return;
    const player = room.players.get(socket.id);
    if (!player || !player.connected) return;
    if (targetId === socket.id) return; // cannot vote for yourself

    // Toggleable tiles: tapping your current pick clears it.
    if (targetId === null || player.vote === targetId) {
      player.vote = null;
    } else if (room.players.has(targetId)) {
      player.vote = targetId;
    }
    broadcastState(room);
    broadcastVotes(room);
    maybeLockVotes(room);
  });

  // The imposter may attempt the target word at ANY point once the round is live.
  socket.on("imposter:guess", ({ guess }, ack) => {
    const room = getRoomOf(socket);
    if (!room) return ack({ error: "Room no longer exists." });
    if (socket.id !== room.imposterId) return ack({ error: "Only the Imposter can guess." });
    const livePhases = ["discussion", "voting", "lastStand"];
    if (!livePhases.includes(room.phase)) return ack({ error: "You can only guess during a live round." });

    const correct = normalizeGuess(guess) === normalizeGuess(room.word);
    ack({ ok: true, correct });

    if (correct) {
      endGame(room, {
        outcome: "imposter",
        reason: `The Imposter guessed the secret word — "${room.word}"!`
      });
    } else if (room.phase === "lastStand") {
      endGame(room, {
        outcome: "citizens",
        reason: `The Imposter was caught and guessed wrong ("${String(guess).trim().slice(0, 40)}").`
      });
    } else {
      // A failed public strike mid-round exposes the imposter instantly.
      endGame(room, {
        outcome: "citizens",
        reason: `The Imposter went all-in with "${String(guess).trim().slice(0, 40)}" — and missed.`
      });
    }
  });

  socket.on("game:playAgain", () => {
    const room = getRoomOf(socket);
    if (!room || socket.id !== room.hostId) return;
    if (room.phase !== "results") return;
    resetToLobby(room);
  });

  socket.on("disconnect", () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const room = getRoomOf(socket);
  if (!room) return;
  const player = room.players.get(socket.id);
  socket.data.roomCode = null;
  if (!player) return;

  if (room.phase === "lobby" || room.phase === "results") {
    room.players.delete(socket.id);
  } else {
    player.connected = false;
    player.vote = null;
  }

  const remaining = connectedPlayers(room);

  // Promote a new host if needed.
  if (room.hostId === socket.id && remaining.length > 0) {
    room.hostId = remaining[0].id;
    io.to(room.code).emit("room:hostChanged", { hostId: room.hostId, hostName: remaining[0].name });
  }

  if (remaining.length === 0) {
    clearAllTimers(room);
    room.timers.cleanup = setTimeout(() => rooms.delete(room.code), EMPTY_ROOM_TTL_MS);
    return;
  }

  const midGame = ["reveal", "discussion", "voting", "lastStand"].includes(room.phase);

  if (midGame && socket.id === room.imposterId) {
    endGame(room, { outcome: "citizens", reason: "The Imposter disconnected and forfeited the round." });
    return;
  }
  if (midGame && remaining.length < MIN_PLAYERS) {
    endGame(room, { outcome: "imposter", reason: "Too many players left — round abandoned. Imposter escapes by default." });
    return;
  }

  if (room.phase === "reveal" && remaining.every((p) => p.ready)) {
    startDiscussion(room);
    return;
  }
  if (room.phase === "voting") {
    broadcastVotes(room);
    maybeLockVotes(room);
  }
  broadcastState(room);
}

server.listen(PORT, () => {
  console.log(`Imposter server running → http://localhost:${PORT}`);
});
