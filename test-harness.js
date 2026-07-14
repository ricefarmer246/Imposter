/**
 * test-harness.js — offline integration test for server.js.
 * Mocks express + socket.io, then drives 3 fake players through:
 *   Round 1: lobby -> reveal -> discussion -> voting -> lastStand (wrong guess) -> citizens win
 *   Round 2: play again -> imposter guesses correctly mid-discussion -> imposter wins
 */
"use strict";

const path = require("path");
const Module = require("module");

/* ---------- mocks ---------- */
const emitted = []; // { target, event, data }

class FakeSocket {
  constructor(id) {
    this.id = id;
    this.data = {};
    this.handlers = {};
  }
  join() {}
  on(event, fn) { this.handlers[event] = fn; }
  trigger(event, payload, ack) { return this.handlers[event](payload, ack || (() => {})); }
}

class FakeIoServer {
  constructor() { this.connectionHandler = null; }
  on(event, fn) { if (event === "connection") this.connectionHandler = fn; }
  to(target) {
    return { emit: (event, data) => emitted.push({ target, event, data }) };
  }
  connect(socket) { this.connectionHandler(socket); }
}

const fakeIo = new FakeIoServer();

const mocks = {
  express: Object.assign(() => ({ use() {} }), { static: () => (req, res, next) => next && next() }),
  "socket.io": { Server: class { constructor() { return fakeIo; } } },
  http: { createServer: () => ({ listen: (port, cb) => cb && cb() }) }
};

const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (mocks[request]) return mocks[request];
  return originalLoad(request, parent, isMain);
};

require(path.join(__dirname, "server.js"));

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastEvent = (name) => [...emitted].reverse().find((e) => e.event === name);
const eventsFor = (target, name) => emitted.filter((e) => e.target === target && e.event === name);
let failures = 0;
function assert(cond, label) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

/* ---------- scenario ---------- */
(async () => {
  const alice = new FakeSocket("sock-alice");
  const bob = new FakeSocket("sock-bob");
  const cara = new FakeSocket("sock-cara");
  [alice, bob, cara].forEach((s) => fakeIo.connect(s));

  // 1. Create + join room
  let code = null;
  alice.trigger("room:create", { name: "Alice" }, (res) => {
    assert(res.ok && /^\d{4}$/.test(res.code), "host creates room with 4-digit code");
    code = res.code;
  });
  bob.trigger("room:join", { code, name: "Bob" }, (res) => assert(res.ok, "Bob joins room"));
  cara.trigger("room:join", { code, name: "Cara" }, (res) => assert(res.ok, "Cara joins room"));
  bob.trigger("room:join", { code, name: "Bob" }, () => {}); // no-op: already in a room? (Bob has roomCode set — server rejects)
  cara.trigger("room:create", { name: "X" }, (res) =>
    assert(res.error, "player already in a room cannot create another"));

  // Non-host cannot start
  bob.trigger("game:start", { discussionSeconds: 180 }, (res) =>
    assert(!!res.error, "non-host cannot start the game"));

  // 2. Host starts — roles dealt privately
  alice.trigger("game:start", { discussionSeconds: 180 }, (res) => assert(res.ok, "host starts game"));
  const roleEvents = emitted.filter((e) => e.event === "game:role");
  assert(roleEvents.length === 3, "each player received a private role");
  const imposterRole = roleEvents.filter((e) => e.data.isImposter);
  assert(imposterRole.length === 1, "exactly one imposter assigned");
  const imposterId = imposterRole[0].target;
  const citizens = roleEvents.filter((e) => !e.data.isImposter);
  assert(citizens.every((e) => typeof e.data.word === "string" && e.data.word.length > 0),
    "citizens received the target word");
  assert(imposterRole[0].data.word === null && typeof imposterRole[0].data.category === "string",
    "imposter received only the category (no word)");
  const secretWord = citizens[0].data.word;

  // 3. Everyone readies up -> discussion starts
  [alice, bob, cara].forEach((s) => s.trigger("player:ready"));
  assert(!!lastEvent("discussion:start"), "discussion starts once all players are ready");

  // Guard: only the imposter can guess
  const nonImposter = [alice, bob, cara].find((s) => s.id !== imposterId);
  nonImposter.trigger("imposter:guess", { guess: secretWord }, (res) =>
    assert(!!res.error, "non-imposter guess is rejected"));

  // 4. Host skips to vote
  alice.trigger("discussion:skipToVote");
  assert(!!lastEvent("voting:start"), "host can skip the timer into voting");

  // Self-vote rejected; toggle works
  alice.trigger("vote:cast", { targetId: "sock-alice" });
  let vu = lastEvent("vote:update");
  assert(vu.data.counts["sock-alice"] === 0, "self-vote is rejected");
  alice.trigger("vote:cast", { targetId: "sock-bob" });
  alice.trigger("vote:cast", { targetId: "sock-bob" }); // toggle off
  vu = lastEvent("vote:update");
  assert(vu.data.counts["sock-bob"] === 0 && vu.data.votedCount === 0, "tapping your pick again withdraws the vote");

  // 5. Everyone votes for the imposter -> lock -> lastStand
  [alice, bob, cara].forEach((s) => {
    const target = s.id === imposterId
      ? [alice, bob, cara].find((o) => o.id !== s.id).id
      : imposterId;
    s.trigger("vote:cast", { targetId: target });
  });
  assert(!!lastEvent("vote:locking"), "vote lock countdown starts when all votes are in");
  await sleep(4300); // VOTE_LOCK_MS + margin
  const ls = lastEvent("lastStand:start");
  assert(!!ls && ls.data.accusedId === imposterId, "caught imposter enters last stand");

  // 6. Wrong last-stand guess -> citizens win
  const imposterSocket = [alice, bob, cara].find((s) => s.id === imposterId);
  imposterSocket.trigger("imposter:guess", { guess: "definitely-wrong-word" }, () => {});
  let over = lastEvent("game:over");
  assert(over.data.outcome === "citizens", "wrong last-stand guess => citizens win");
  assert(over.data.word === secretWord && over.data.imposterIds.includes(imposterId),
    "results reveal the word and the imposter");

  // 7. Play again -> round 2 -> imposter steals via correct mid-round guess
  alice.trigger("game:playAgain");
  assert(lastEvent("room:state").data.phase === "lobby", "play again returns the room to the lobby");

  emitted.length = 0;
  alice.trigger("game:start", { discussionSeconds: 240 }, () => {});
  const roles2 = emitted.filter((e) => e.event === "game:role");
  const imposter2 = roles2.find((e) => e.data.isImposter).target;
  const word2 = roles2.find((e) => !e.data.isImposter).data.word;
  [alice, bob, cara].forEach((s) => s.trigger("player:ready"));
  const impSock2 = [alice, bob, cara].find((s) => s.id === imposter2);
  impSock2.trigger("imposter:guess", { guess: `  ${word2.toUpperCase()}!! ` }, (res) =>
    assert(res.correct === true, "guess matching is case/punctuation-insensitive"));
  over = lastEvent("game:over");
  assert(over.data.outcome === "imposter", "correct mid-round guess => imposter wins instantly");

  // 8. Disconnect handling: imposter leaving mid-game forfeits
  alice.trigger("game:playAgain");
  emitted.length = 0;
  alice.trigger("game:start", { discussionSeconds: 240 }, () => {});
  const imposter3 = emitted.find((e) => e.event === "game:role" && e.data.isImposter).target;
  [alice, bob, cara].forEach((s) => s.trigger("player:ready"));
  const impSock3 = [alice, bob, cara].find((s) => s.id === imposter3);
  impSock3.trigger("disconnect");
  over = lastEvent("game:over");
  assert(over.data.outcome === "citizens" && /disconnected/i.test(over.data.reason),
    "imposter disconnect forfeits the round to the citizens");

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
