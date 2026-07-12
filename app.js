/**
 * app.js — Imposter Party Game frontend.
 *
 * A single-file, dependency-free UI state machine (vanilla JS + Tailwind).
 * Two engines share one component library:
 *   1. LOCAL  — Pass & Play, runs entirely in the browser.
 *   2. ONLINE — Socket.io client talking to server.js.
 */

"use strict";

/* ================================================================== */
/* 1. Utilities & UI atoms                                            */
/* ================================================================== */

const WORDS = window.IMPOSTER_WORDS;
const app = document.getElementById("app");
const blackoutEl = document.getElementById("blackout");
const toastEl = document.getElementById("toast");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const normalizeGuess = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const AVATAR_GRADIENTS = [
  "from-indigo-500 to-violet-500", "from-violet-500 to-fuchsia-500",
  "from-sky-500 to-indigo-500", "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500", "from-rose-500 to-pink-500",
  "from-cyan-500 to-sky-500", "from-lime-500 to-emerald-500",
  "from-fuchsia-500 to-rose-500", "from-teal-500 to-cyan-500"
];
const avatarClass = (i) => AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length];

/* Shared button/card class strings keep markup consistent. */
const BTN = {
  primary:
    "w-full py-4 rounded-2xl font-display font-bold text-lg tracking-wide bg-indigo-500 " +
    "hover:bg-indigo-400 active:scale-[.98] transition shadow-lg shadow-indigo-500/25 text-white",
  violet:
    "w-full py-4 rounded-2xl font-display font-bold text-lg tracking-wide bg-violet-500 " +
    "hover:bg-violet-400 active:scale-[.98] transition shadow-lg shadow-violet-500/25 text-white",
  ghost:
    "w-full py-3 rounded-xl font-semibold bg-zinc-800/80 hover:bg-zinc-700/80 " +
    "border border-zinc-700 transition text-zinc-200",
  danger:
    "w-full py-4 rounded-2xl font-display font-bold text-lg bg-rose-500 hover:bg-rose-400 " +
    "active:scale-[.98] transition shadow-lg shadow-rose-500/25 text-white",
  success:
    "w-full py-4 rounded-2xl font-display font-bold text-lg bg-emerald-500 hover:bg-emerald-400 " +
    "active:scale-[.98] transition shadow-lg shadow-emerald-500/25 text-white"
};
const CARD = "rounded-3xl border border-zinc-800 bg-zinc-900/80 backdrop-blur p-6 shadow-xl";

let toastTimer = null;
function toast(msg, tone = "info") {
  toastEl.textContent = msg;
  toastEl.className =
    "fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-sm font-medium shadow-2xl border animate-pop " +
    (tone === "error"
      ? "bg-rose-950/95 border-rose-700 text-rose-100"
      : tone === "success"
        ? "bg-emerald-950/95 border-emerald-700 text-emerald-100"
        : "bg-zinc-800/95 border-zinc-700 text-zinc-100");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

/** Pure-black anti-peek overlay used between local hand-offs. */
let blackoutHandler = null;
function showBlackout({ title, sub, buttonLabel, onTap }) {
  blackoutHandler = onTap;
  blackoutEl.innerHTML = `
    <p class="text-zinc-500 text-sm uppercase tracking-[.3em] mb-4">Screen hidden</p>
    <h2 class="font-display text-3xl sm:text-4xl font-bold text-white mb-3">${title}</h2>
    ${sub ? `<p class="text-zinc-400 mb-8 max-w-sm">${sub}</p>` : `<div class="mb-8"></div>`}
    <button data-action="blackoutTap" class="px-8 py-4 rounded-2xl font-display font-bold text-lg
      bg-zinc-100 text-zinc-950 hover:bg-white active:scale-[.98] transition">
      ${buttonLabel}
    </button>`;
  blackoutEl.classList.remove("hidden");
  blackoutEl.classList.add("flex");
}
function hideBlackout() {
  blackoutHandler = null;
  blackoutEl.classList.add("hidden");
  blackoutEl.classList.remove("flex");
}
blackoutEl.addEventListener("click", (e) => {
  if (e.target.closest("[data-action='blackoutTap']") && blackoutHandler) {
    const fn = blackoutHandler;
    hideBlackout();
    fn();
  }
});

/** SVG countdown ring. Progress is updated each second by tick(). */
function timerRing() {
  const C = 2 * Math.PI * 54;
  return `
  <div class="relative w-40 h-40 sm:w-48 sm:h-48 mx-auto">
    <svg viewBox="0 0 120 120" class="w-full h-full -rotate-90">
      <circle cx="60" cy="60" r="54" fill="none" stroke="#27272a" stroke-width="8"/>
      <circle id="ring-progress" cx="60" cy="60" r="54" fill="none" stroke="#818cf8"
        stroke-width="8" stroke-linecap="round" class="ring-progress"
        stroke-dasharray="${C}" stroke-dashoffset="0"/>
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center">
      <span id="timer-label" class="font-display text-4xl sm:text-5xl font-bold tabular-nums">--:--</span>
      <span class="text-xs uppercase tracking-widest text-zinc-500 mt-1">Discussion</span>
    </div>
  </div>`;
}

function updateRing(remainingMs, totalMs) {
  const ring = document.getElementById("ring-progress");
  const label = document.getElementById("timer-label");
  if (!ring || !label) return;
  const C = 2 * Math.PI * 54;
  const frac = Math.min(1, Math.max(0, remainingMs / totalMs));
  ring.style.strokeDashoffset = String(C * (1 - frac));
  ring.style.stroke = frac > 0.5 ? "#818cf8" : frac > 0.2 ? "#fbbf24" : "#fb7185";
  label.textContent = fmtClock(remainingMs);
}

/* ================================================================== */
/* 2. Global state & router                                           */
/* ================================================================== */

const S = { screen: "menu" };

/** Local (Pass & Play) game state. */
const L = {
  names: [],
  seconds: 240,
  category: null,
  word: null,
  imposterIndex: -1,
  revealIndex: 0,
  revealShown: false,
  discussionStartAt: 0,
  discussionEndsAt: 0,
  askOffset: 0,
  claimOpen: false,
  voteIndex: 0,
  votes: [],           // votes[i] = index of accused player
  lastStandGuess: "",
  result: null         // { outcome, reason, tally }
};

/** Online game state. */
const O = {
  selfId: null,
  name: "",
  state: null,   // last public room snapshot from the server
  role: null,    // { category, word, isImposter, round }
  discussion: null, // { startAt, endsAt, turnSeconds, order }
  votes: { counts: {}, votedCount: 0, eligible: 0 },
  myVote: null,
  locking: false,
  lastStand: null, // { endsAt, accusedId, accusedName, category }
  result: null,
  guessBusy: false
};

const SCREENS = {};
function render() {
  const fn = SCREENS[S.screen];
  app.innerHTML = fn ? fn() : `<p class="text-rose-400">Unknown screen: ${esc(S.screen)}</p>`;
  const focus = app.querySelector("[data-autofocus]");
  if (focus) focus.focus();
  tick(); // paint timers immediately, no 1s blank
}
function go(screen) {
  S.screen = screen;
  render();
}

function header(subtitle) {
  return `
  <header class="flex items-center justify-between mb-6">
    <div>
      <h1 class="font-display text-2xl font-bold tracking-tight">
        IMP<span class="text-rose-400">O</span>STER
      </h1>
      ${subtitle ? `<p class="text-xs uppercase tracking-[.25em] text-zinc-500 mt-0.5">${subtitle}</p>` : ""}
    </div>
    <button data-action="backToMenu" class="text-sm text-zinc-400 hover:text-zinc-200 px-3 py-1.5
      rounded-lg border border-zinc-800 hover:border-zinc-600 transition">Menu</button>
  </header>`;
}

/* ================================================================== */
/* 3. Main menu                                                       */
/* ================================================================== */

SCREENS.menu = () => `
  <div class="min-h-[80vh] flex flex-col justify-center animate-rise">
    <div class="text-center mb-10">
      <p class="text-xs uppercase tracking-[.4em] text-indigo-400 mb-3">Social deduction party game</p>
      <h1 class="font-display text-6xl sm:text-7xl font-bold tracking-tight">
        IMP<span class="text-rose-400">O</span>STER
      </h1>
      <p class="text-zinc-400 mt-4 max-w-md mx-auto">
        Everyone gets the secret word — except one of you.
        Ask questions, smell the bluff, and vote out the fraud.
      </p>
    </div>

    <div class="grid gap-4 max-w-md w-full mx-auto">
      <button data-action="goLocalSetup" class="${CARD} text-left hover:border-indigo-500/60 transition group">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500
               flex items-center justify-center text-2xl shrink-0">🛋️</div>
          <div>
            <h2 class="font-display text-xl font-bold group-hover:text-indigo-300 transition">Local Pass &amp; Play</h2>
            <p class="text-sm text-zinc-400">One device, 3–10 players. Pass it around the room.</p>
          </div>
        </div>
      </button>

      <button data-action="goOnlineEntry" class="${CARD} text-left hover:border-violet-500/60 transition group">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500
               flex items-center justify-center text-2xl shrink-0">🌐</div>
          <div>
            <h2 class="font-display text-xl font-bold group-hover:text-violet-300 transition">Online Lobby</h2>
            <p class="text-sm text-zinc-400">Host or join with a 4-digit room code. Every player on their own device.</p>
          </div>
        </div>
      </button>
    </div>

    <p class="text-center text-xs text-zinc-600 mt-10">
      Citizens win by voting out the Imposter · The Imposter wins by surviving the vote or guessing the exact word
    </p>
  </div>`;

/* ================================================================== */
/* 4. LOCAL MODE — Pass & Play                                        */
/* ================================================================== */

/* ---------- 4a. Setup ---------- */

function loadSavedNames() {
  try {
    const saved = JSON.parse(localStorage.getItem("imposter.names") || "[]");
    if (Array.isArray(saved) && saved.length >= 3) return saved.slice(0, 10).map(String);
  } catch { /* corrupted storage — fall through to defaults */ }
  return ["", "", ""];
}
function saveNames() {
  try { localStorage.setItem("imposter.names", JSON.stringify(L.names)); } catch { /* storage full/blocked */ }
}

SCREENS.localSetup = () => `
  ${header("Local Pass & Play")}
  <div class="${CARD} animate-rise">
    <h2 class="font-display text-2xl font-bold mb-1">Who's playing?</h2>
    <p class="text-sm text-zinc-400 mb-5">3 to 10 players. You'll pass this device around for secret role reveals.</p>

    <div class="grid gap-2.5 mb-4">
      ${L.names.map((n, i) => `
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-full bg-gradient-to-br ${avatarClass(i)}
               flex items-center justify-center font-display font-bold text-sm shrink-0">${i + 1}</div>
          <input id="name-${i}" value="${esc(n)}" maxlength="14" placeholder="Player ${i + 1} name"
            data-name-input="${i}"
            class="flex-1 bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm
                   placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
          ${L.names.length > 3 ? `
            <button data-action="localRemovePlayer" data-arg="${i}" aria-label="Remove player ${i + 1}"
              class="w-9 h-9 rounded-xl border border-zinc-700 text-zinc-400 hover:text-rose-400
                     hover:border-rose-500/60 transition">✕</button>` : ""}
        </div>`).join("")}
    </div>

    ${L.names.length < 10 ? `
      <button data-action="localAddPlayer" class="${BTN.ghost} mb-6">+ Add player</button>` : `<div class="mb-6"></div>`}

    <h3 class="text-sm font-semibold text-zinc-300 mb-2">Discussion timer</h3>
    <div class="grid grid-cols-3 gap-2 mb-6">
      ${[180, 240, 300].map((s) => `
        <button data-action="localSetSeconds" data-arg="${s}"
          class="py-3 rounded-xl font-display font-bold border transition
            ${L.seconds === s
              ? "bg-indigo-500/20 border-indigo-500 text-indigo-300"
              : "bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-500"}">
          ${s / 60} min
        </button>`).join("")}
    </div>

    <button data-action="localStart" class="${BTN.primary}">Start Round →</button>
  </div>`;

function syncNameInputs() {
  app.querySelectorAll("[data-name-input]").forEach((input) => {
    L.names[Number(input.dataset.nameInput)] = input.value;
  });
}

/* ---------- 4b. Engine ---------- */

function startLocalRound() {
  const category = pickRandom(Object.keys(WORDS));
  L.category = category;
  L.word = pickRandom(WORDS[category]);
  L.imposterIndex = Math.floor(Math.random() * L.names.length);
  L.revealIndex = 0;
  L.revealShown = false;
  L.askOffset = 0;
  L.claimOpen = false;
  L.voteIndex = 0;
  L.votes = [];
  L.lastStandGuess = "";
  L.result = null;
  showBlackout({
    title: `Pass to ${esc(L.names[0])}`,
    sub: "Everyone else, look away. Role reveals are private!",
    buttonLabel: `I'm ${esc(L.names[0])} — show my card`,
    onTap: () => go("localReveal")
  });
}

/* ---------- 4c. Sequential Role Reveal Dashboard ---------- */

SCREENS.localReveal = () => {
  const i = L.revealIndex;
  const name = L.names[i];
  const isImposter = i === L.imposterIndex;
  const next = L.names[i + 1] || null;

  const secretCard = !L.revealShown
    ? `
    <div class="rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-800/40 py-16 text-center mb-6">
      <div class="text-5xl mb-3">🔒</div>
      <p class="text-zinc-400 text-sm">Your secret is hidden</p>
    </div>
    <button data-action="localRevealShow" class="${BTN.primary} py-6 text-xl">Reveal My Secret Word</button>`
    : isImposter
      ? `
    <div class="rounded-2xl border border-rose-500/60 bg-rose-500/10 py-10 px-6 text-center mb-6 animate-pop">
      <p class="text-xs uppercase tracking-[.3em] text-rose-300 mb-3">Category · ${esc(L.category)}</p>
      <h3 class="font-display text-4xl font-bold text-rose-400 mb-3">YOU ARE THE IMPOSTER</h3>
      <p class="text-rose-200/90 font-medium">Blend in! You don't know the word — fake it, and listen for clues.</p>
    </div>
    <button data-action="localRevealHide" class="${BTN.success} py-6 text-lg">
      Secret Copied! ${next ? `Click to Hide &amp; Pass to ${esc(next)}` : "Click to Hide &amp; Start Discussion"}
    </button>`
      : `
    <div class="rounded-2xl border border-indigo-500/60 bg-indigo-500/10 py-10 px-6 text-center mb-6 animate-pop">
      <p class="text-xs uppercase tracking-[.3em] text-indigo-300 mb-3">Category · ${esc(L.category)}</p>
      <p class="text-zinc-400 text-sm mb-1">The secret word is</p>
      <h3 class="font-display text-5xl font-bold text-white">${esc(L.word)}</h3>
    </div>
    <button data-action="localRevealHide" class="${BTN.success} py-6 text-lg">
      Secret Copied! ${next ? `Click to Hide &amp; Pass to ${esc(next)}` : "Click to Hide &amp; Start Discussion"}
    </button>`;

  return `
  ${header("Role Reveal · Private")}
  <div class="${CARD} animate-rise">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-12 h-12 rounded-full bg-gradient-to-br ${avatarClass(i)}
           flex items-center justify-center font-display font-bold text-lg">${esc(name[0].toUpperCase())}</div>
      <div>
        <p class="text-xs uppercase tracking-widest text-zinc-500">Player ${i + 1} of ${L.names.length}</p>
        <h2 class="font-display text-2xl font-bold">${esc(name)}</h2>
      </div>
    </div>
    ${secretCard}
    <p class="text-center text-xs text-zinc-500 mt-4">Shield the screen — one glance can ruin the round.</p>
  </div>`;
};

function advanceLocalReveal() {
  L.revealShown = false;
  const next = L.revealIndex + 1;
  if (next < L.names.length) {
    L.revealIndex = next;
    render(); // swap the DOM to the next (locked) card *before* the blackout lifts
    showBlackout({
      title: `Pass to ${esc(L.names[next])}`,
      sub: "No peeking while the device travels.",
      buttonLabel: `I'm ${esc(L.names[next])} — show my card`,
      onTap: () => {}
    });
  } else {
    showBlackout({
      title: "Everyone is armed 🔪",
      sub: "Place the device where the whole table can see the timer. Take turns asking each other questions about the word.",
      buttonLabel: "Start the discussion",
      onTap: () => {
        L.discussionStartAt = Date.now();
        L.discussionEndsAt = L.discussionStartAt + L.seconds * 1000;
        go("localArena");
      }
    });
  }
}

/* ---------- 4d. Shared Game Arena (timer + turns + controls) ---------- */

function currentAskerIndex() {
  const elapsed = Date.now() - L.discussionStartAt;
  return (Math.floor(elapsed / 30000) + L.askOffset) % L.names.length;
}

SCREENS.localArena = () => {
  const asker = currentAskerIndex();
  return `
  ${header("Game Arena")}
  <div class="${CARD} animate-rise">
    <p class="text-center text-xs uppercase tracking-[.3em] text-zinc-500 mb-1">Category</p>
    <h2 class="text-center font-display text-2xl font-bold text-indigo-300 mb-6">${esc(L.category)}</h2>

    ${timerRing()}

    <div class="mt-8 mb-2 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-zinc-300">Whose turn to ask</h3>
      <button data-action="localNextAsker" class="text-xs text-indigo-300 hover:text-indigo-200
        border border-indigo-500/40 rounded-lg px-3 py-1.5 transition">Skip to next →</button>
    </div>
    <div id="asker-grid" class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-8">
      ${L.names.map((n, i) => `
        <div data-asker="${i}" class="flex items-center gap-2 rounded-xl border px-3 py-2.5 transition
          ${i === asker
            ? "border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-500/10"
            : "border-zinc-800 bg-zinc-800/40"}">
          <div class="w-7 h-7 rounded-full bg-gradient-to-br ${avatarClass(i)}
               flex items-center justify-center text-xs font-bold shrink-0">${esc(n[0].toUpperCase())}</div>
          <span class="text-sm font-medium truncate">${esc(n)}</span>
          ${i === asker ? `<span class="ml-auto w-2 h-2 rounded-full bg-violet-400 animate-pulseRing shrink-0"></span>` : ""}
        </div>`).join("")}
    </div>

    <div class="grid gap-3">
      <button data-action="localOpenClaim" class="${BTN.danger} py-3.5 text-base">🗡️ Imposter Claim — Guess the Word</button>
      <button data-action="localGoVote" class="${BTN.violet} py-3.5 text-base">Skip Timer → Start Voting</button>
    </div>
  </div>

  ${L.claimOpen ? `
  <div class="fixed inset-0 z-40 bg-black/80 flex items-center justify-center px-4">
    <div class="${CARD} max-w-md w-full border-rose-500/50 animate-pop">
      <h3 class="font-display text-2xl font-bold text-rose-400 mb-2">All-in Imposter Strike</h3>
      <p class="text-sm text-zinc-400 mb-4">
        The Imposter reveals themselves and guesses the exact word.
        <span class="text-emerald-400 font-medium">Correct = instant Imposter win.</span>
        <span class="text-rose-400 font-medium">Wrong = Citizens win.</span>
      </p>
      <input id="claim-guess" data-autofocus placeholder="Type the secret word…" maxlength="40"
        class="w-full bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-3 mb-4
               placeholder-zinc-500 focus:border-rose-500 focus:outline-none" />
      <div class="grid grid-cols-2 gap-3">
        <button data-action="localCloseClaim" class="${BTN.ghost}">Cancel</button>
        <button data-action="localSubmitClaim" class="py-3 rounded-xl font-display font-bold
          bg-rose-500 hover:bg-rose-400 transition text-white">Lock it in</button>
      </div>
    </div>
  </div>` : ""}`;
};

function updateAskerHighlight() {
  const grid = document.getElementById("asker-grid");
  if (!grid) return;
  const asker = currentAskerIndex();
  grid.querySelectorAll("[data-asker]").forEach((el) => {
    const active = Number(el.dataset.asker) === asker;
    el.className =
      "flex items-center gap-2 rounded-xl border px-3 py-2.5 transition " +
      (active
        ? "border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-500/10"
        : "border-zinc-800 bg-zinc-800/40");
    const dot = el.querySelector(".animate-pulseRing");
    if (active && !dot) {
      el.insertAdjacentHTML("beforeend",
        `<span class="ml-auto w-2 h-2 rounded-full bg-violet-400 animate-pulseRing shrink-0"></span>`);
    } else if (!active && dot) {
      dot.remove();
    }
  });
}

function resolveLocalClaim(guess) {
  const correct = normalizeGuess(guess) === normalizeGuess(L.word);
  L.claimOpen = false;
  L.result = correct
    ? { outcome: "imposter", reason: `${L.names[L.imposterIndex]} went all-in and nailed it — the word was "${L.word}"!`, tally: null }
    : { outcome: "citizens", reason: `${L.names[L.imposterIndex]} struck with "${guess.trim().slice(0, 40)}" — and missed!`, tally: null };
  go("localResults");
}

/* ---------- 4e. Sequential private voting ---------- */

function beginLocalVoting() {
  L.voteIndex = 0;
  L.votes = [];
  go("localVote"); // leave the arena at once (stops the discussion ticker for good)
  showBlackout({
    title: `${esc(L.names[0])}, it's your vote`,
    sub: "Take the device. Your ballot is secret.",
    buttonLabel: `I'm ${esc(L.names[0])} — open my ballot`,
    onTap: () => {}
  });
}

SCREENS.localVote = () => {
  const i = L.voteIndex;
  return `
  ${header("Secret Ballot")}
  <div class="${CARD} animate-rise">
    <div class="flex items-center gap-3 mb-2">
      <div class="w-10 h-10 rounded-full bg-gradient-to-br ${avatarClass(i)}
           flex items-center justify-center font-display font-bold">${esc(L.names[i][0].toUpperCase())}</div>
      <h2 class="font-display text-2xl font-bold">${esc(L.names[i])}, who is the Imposter?</h2>
    </div>
    <p class="text-sm text-zinc-400 mb-5">Ballot ${i + 1} of ${L.names.length} · tap a player to accuse them.</p>

    <div class="grid grid-cols-2 gap-3">
      ${L.names.map((n, j) => j === i ? "" : `
        <button data-action="localCastVote" data-arg="${j}"
          class="rounded-2xl border border-zinc-700 bg-zinc-800/50 hover:border-rose-500
                 hover:bg-rose-500/10 transition p-4 text-left group">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br ${avatarClass(j)}
               flex items-center justify-center font-display font-bold mb-2">${esc(n[0].toUpperCase())}</div>
          <p class="font-semibold truncate">${esc(n)}</p>
          <p class="text-xs text-zinc-500 group-hover:text-rose-300 transition">Vote out</p>
        </button>`).join("")}
    </div>
  </div>`;
};

function afterLocalVote(targetIndex) {
  L.votes[L.voteIndex] = targetIndex;
  const next = L.voteIndex + 1;
  if (next < L.names.length) {
    L.voteIndex = next;
    render(); // next voter's ballot is already beneath the blackout
    showBlackout({
      title: `${esc(L.names[next])}, it's your vote`,
      sub: "Ballot recorded. Pass the device along.",
      buttonLabel: `I'm ${esc(L.names[next])} — open my ballot`,
      onTap: () => {}
    });
  } else {
    tallyLocalVotes();
  }
}

function tallyLocalVotes() {
  const tally = L.names.map((name, i) => ({
    name, index: i,
    votes: L.votes.filter((v) => v === i).length,
    isImposter: i === L.imposterIndex
  })).sort((a, b) => b.votes - a.votes);

  const top = tally[0];
  const isTie = tally.length > 1 && tally[1].votes === top.votes;
  const caughtImposter = !isTie && top.votes > 0 && top.isImposter;

  if (caughtImposter) {
    go("localLastStand");
  } else {
    L.result = {
      outcome: "imposter",
      reason: isTie || top.votes === 0
        ? "The vote was deadlocked — the Imposter slipped away."
        : `${top.name} was voted out… but they were innocent. The Imposter survived.`,
      tally
    };
    go("localResults");
  }
}

/* ---------- 4f. Last stand + results ---------- */

SCREENS.localLastStand = () => `
  ${header("Last Stand")}
  <div class="${CARD} border-rose-500/50 animate-rise">
    <div class="text-center mb-6">
      <div class="text-5xl mb-3">⚖️</div>
      <h2 class="font-display text-3xl font-bold mb-2">
        You caught <span class="text-rose-400">${esc(L.names[L.imposterIndex])}</span>!
      </h2>
      <p class="text-zinc-400">
        One escape route remains: name the exact secret word
        (category: <span class="text-indigo-300 font-medium">${esc(L.category)}</span>) to steal the win.
      </p>
    </div>
    <input id="laststand-guess" data-autofocus placeholder="Type the secret word…" maxlength="40"
      class="w-full bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-3 mb-4 text-center
             font-display text-xl placeholder-zinc-500 focus:border-rose-500 focus:outline-none" />
    <button data-action="localSubmitLastStand" class="${BTN.danger}">Final Answer</button>
  </div>`;

function resolveLocalLastStand(guess) {
  const correct = normalizeGuess(guess) === normalizeGuess(L.word);
  const tally = L.names.map((name, i) => ({
    name, index: i,
    votes: L.votes.filter((v) => v === i).length,
    isImposter: i === L.imposterIndex
  })).sort((a, b) => b.votes - a.votes);

  L.result = correct
    ? { outcome: "imposter", reason: `Caught red-handed — but ${L.names[L.imposterIndex]} guessed "${L.word}" and stole the win!`, tally }
    : { outcome: "citizens", reason: `The Imposter guessed "${guess.trim().slice(0, 40)}" — wrong! Justice served.`, tally };
  go("localResults");
}

SCREENS.localResults = () => {
  const r = L.result;
  const citizensWin = r.outcome === "citizens";
  return `
  ${header("Round Over")}
  <div class="${CARD} animate-rise ${citizensWin ? "border-emerald-500/50" : "border-rose-500/50"}">
    <div class="text-center mb-6">
      <div class="text-6xl mb-4">${citizensWin ? "🏆" : "🗡️"}</div>
      <h2 class="font-display text-4xl font-bold ${citizensWin ? "text-emerald-400" : "text-rose-400"} mb-2">
        ${citizensWin ? "CITIZENS WIN" : "IMPOSTER WINS"}
      </h2>
      <p class="text-zinc-300">${esc(r.reason)}</p>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-6 text-center">
      <div class="rounded-2xl bg-zinc-800/60 border border-zinc-700 p-4">
        <p class="text-xs uppercase tracking-widest text-zinc-500 mb-1">The Imposter</p>
        <p class="font-display text-xl font-bold text-rose-400">${esc(L.names[L.imposterIndex])}</p>
      </div>
      <div class="rounded-2xl bg-zinc-800/60 border border-zinc-700 p-4">
        <p class="text-xs uppercase tracking-widest text-zinc-500 mb-1">The Word</p>
        <p class="font-display text-xl font-bold text-indigo-300">${esc(L.word)}</p>
      </div>
    </div>

    ${r.tally ? `
    <h3 class="text-sm font-semibold text-zinc-300 mb-2">Vote breakdown</h3>
    <div class="grid gap-2 mb-6">
      ${r.tally.map((t) => `
        <div class="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 py-2">
          <span class="text-sm font-medium w-28 truncate ${t.isImposter ? "text-rose-400" : ""}">
            ${esc(t.name)}${t.isImposter ? " 🗡️" : ""}
          </span>
          <div class="flex-1 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
            <div class="h-full rounded-full ${t.isImposter ? "bg-rose-500" : "bg-indigo-500"}"
                 style="width:${L.names.length ? (t.votes / L.names.length) * 100 : 0}%"></div>
          </div>
          <span class="text-sm tabular-nums text-zinc-400 w-6 text-right">${t.votes}</span>
        </div>`).join("")}
    </div>` : ""}

    <div class="grid gap-3">
      <button data-action="localPlayAgain" class="${BTN.primary}">Play Again — Same Crew</button>
      <button data-action="goLocalSetup" class="${BTN.ghost}">Change Players</button>
    </div>
  </div>`;
};

/* ================================================================== */
/* 5. ONLINE MODE — Socket.io client                                  */
/* ================================================================== */

let socket = null;

function ensureSocket() {
  if (socket) return socket;
  if (typeof io === "undefined") {
    toast("Online mode needs the Node server. Run `npm start` and open http://localhost:3000", "error");
    return null;
  }
  socket = io();

  socket.on("connect_error", () => toast("Can't reach the game server.", "error"));

  socket.on("room:state", (state) => {
    O.state = state;
    // The server's phase drives which screen we render.
    const map = {
      lobby: "onlineLobby",
      reveal: "onlineReveal",
      discussion: "onlineDiscussion",
      voting: "onlineVoting",
      lastStand: "onlineLastStand",
      results: "onlineResults"
    };
    const target = map[state.phase];
    if (target && S.screen.startsWith("online") && S.screen !== target) {
      if (state.phase === "lobby") {
        // fresh round — clear the previous round's leftovers
        O.role = null; O.discussion = null; O.myVote = null; O.locking = false;
        O.lastStand = null; O.result = null;
        O.votes = { counts: {}, votedCount: 0, eligible: 0 };
      }
      go(target);
    } else if (S.screen.startsWith("online")) {
      render();
    }
  });

  socket.on("game:role", (role) => {
    O.role = role;
    O.myVote = null;
    O.result = null;
    O.lastStand = null;
    go("onlineReveal");
  });

  socket.on("discussion:start", (payload) => {
    O.discussion = payload;
    go("onlineDiscussion");
  });

  socket.on("voting:start", () => {
    O.myVote = null;
    O.locking = false;
    go("onlineVoting");
  });

  socket.on("vote:update", (votes) => {
    O.votes = votes;
    if (S.screen === "onlineVoting") updateVoteBars();
  });

  socket.on("vote:locking", () => {
    O.locking = true;
    if (S.screen === "onlineVoting") render();
  });

  socket.on("vote:unlocked", () => {
    O.locking = false;
    if (S.screen === "onlineVoting") render();
  });

  socket.on("lastStand:start", (payload) => {
    O.lastStand = payload;
    go("onlineLastStand");
  });

  socket.on("game:over", (result) => {
    O.result = result;
    go("onlineResults");
  });

  socket.on("room:hostChanged", ({ hostName }) => {
    toast(`${hostName} is now the host.`);
  });

  return socket;
}

function me() {
  return O.state?.players.find((p) => p.id === O.selfId) || null;
}
function isHost() {
  return O.state && O.selfId === O.state.hostId;
}

/* ---------- 5a. Entry: host or join ---------- */

SCREENS.onlineEntry = () => `
  ${header("Online Multiplayer")}
  <div class="${CARD} max-w-md mx-auto animate-rise">
    <h2 class="font-display text-2xl font-bold mb-1">Join the table</h2>
    <p class="text-sm text-zinc-400 mb-5">Everyone plays on their own device. Roles arrive privately.</p>

    <label class="text-xs uppercase tracking-widest text-zinc-500">Your name</label>
    <input id="online-name" value="${esc(O.name)}" maxlength="14" placeholder="e.g. Riley" data-autofocus
      class="w-full bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-3 mt-1 mb-5
             placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />

    <button data-action="onlineHost" class="${BTN.primary} mb-5">Host a New Room</button>

    <div class="flex items-center gap-3 mb-5">
      <div class="flex-1 h-px bg-zinc-800"></div>
      <span class="text-xs text-zinc-500 uppercase tracking-widest">or join</span>
      <div class="flex-1 h-px bg-zinc-800"></div>
    </div>

    <div class="flex gap-3">
      <input id="online-code" inputmode="numeric" maxlength="4" placeholder="0000"
        class="w-28 bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-3 text-center
               font-display text-xl tracking-[.3em] placeholder-zinc-600 focus:border-violet-500 focus:outline-none" />
      <button data-action="onlineJoin" class="flex-1 py-3 rounded-xl font-display font-bold
        bg-violet-500 hover:bg-violet-400 transition text-white shadow-lg shadow-violet-500/25">
        Join Room
      </button>
    </div>
  </div>`;

/* ---------- 5b. Lobby ---------- */

SCREENS.onlineLobby = () => {
  const st = O.state;
  if (!st) return `<p class="text-zinc-400">Connecting…</p>`;
  const canStart = st.players.filter((p) => p.connected).length >= 3;

  return `
  ${header("Online Lobby")}
  <div class="${CARD} animate-rise">
    <div class="text-center mb-7">
      <p class="text-xs uppercase tracking-[.3em] text-zinc-500 mb-2">Room code</p>
      <button data-action="copyCode" title="Copy room code"
        class="font-display text-6xl font-bold tracking-[.25em] text-indigo-300 hover:text-indigo-200 transition">
        ${esc(st.code)}
      </button>
      <p class="text-xs text-zinc-500 mt-2">Tap the code to copy · friends join at this address</p>
    </div>

    <h3 class="text-sm font-semibold text-zinc-300 mb-2">
      Players <span class="text-zinc-500">(${st.players.length}/16)</span>
    </h3>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-7">
      ${st.players.map((p, i) => `
        <div class="flex items-center gap-2.5 rounded-xl border px-3 py-2.5
          ${p.connected ? "border-zinc-700 bg-zinc-800/50" : "border-zinc-800 bg-zinc-900 opacity-50"}">
          <div class="w-8 h-8 rounded-full bg-gradient-to-br ${avatarClass(i)}
               flex items-center justify-center text-sm font-bold shrink-0">${esc(p.name[0].toUpperCase())}</div>
          <span class="text-sm font-medium truncate">${esc(p.name)}${p.id === O.selfId ? " (you)" : ""}</span>
          ${p.id === st.hostId ? `<span class="ml-auto text-xs shrink-0" title="Host">👑</span>` : ""}
        </div>`).join("")}
    </div>

    ${isHost() ? `
      <h3 class="text-sm font-semibold text-zinc-300 mb-2">Discussion timer</h3>
      <div class="grid grid-cols-3 gap-2 mb-5">
        ${[180, 240, 300].map((s) => `
          <button data-action="onlineSetSeconds" data-arg="${s}"
            class="py-3 rounded-xl font-display font-bold border transition
              ${(O.hostSeconds || 240) === s
                ? "bg-indigo-500/20 border-indigo-500 text-indigo-300"
                : "bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-500"}">
            ${s / 60} min
          </button>`).join("")}
      </div>
      <button data-action="onlineStartGame" class="${canStart ? BTN.primary : BTN.ghost}"
        ${canStart ? "" : "disabled"}>
        ${canStart ? "Start Game →" : "Waiting for at least 3 players…"}
      </button>`
      : `<p class="text-center text-sm text-zinc-400 py-3">
           Waiting for the host to start the game<span class="animate-pulse">…</span>
         </p>`}
    <button data-action="onlineLeave" class="mt-3 ${BTN.ghost}">Leave Room</button>
  </div>`;
};

/* ---------- 5c. Private role reveal ---------- */

SCREENS.onlineReveal = () => {
  const st = O.state, role = O.role;
  if (!st || !role) return `<p class="text-zinc-400">Dealing roles…</p>`;
  const readyCount = st.players.filter((p) => p.connected && p.ready).length;
  const total = st.players.filter((p) => p.connected).length;
  const iAmReady = !!me()?.ready;

  const card = role.isImposter
    ? `
    <div class="rounded-2xl border border-rose-500/60 bg-rose-500/10 py-10 px-6 text-center mb-6 animate-pop">
      <p class="text-xs uppercase tracking-[.3em] text-rose-300 mb-3">Category · ${esc(role.category)}</p>
      <h3 class="font-display text-4xl font-bold text-rose-400 mb-3">YOU ARE THE IMPOSTER</h3>
      <p class="text-rose-200/90 font-medium">Blend in! Answer questions like you know the word. You can steal the win anytime by guessing it exactly.</p>
    </div>`
    : `
    <div class="rounded-2xl border border-indigo-500/60 bg-indigo-500/10 py-10 px-6 text-center mb-6 animate-pop">
      <p class="text-xs uppercase tracking-[.3em] text-indigo-300 mb-3">Category · ${esc(role.category)}</p>
      <p class="text-zinc-400 text-sm mb-1">The secret word is</p>
      <h3 class="font-display text-5xl font-bold text-white">${esc(role.word)}</h3>
      <p class="text-zinc-400 text-sm mt-3">One player doesn't know it. Find them.</p>
    </div>`;

  return `
  ${header(`Round ${role.round} · Your Secret Role`)}
  <div class="${CARD} max-w-md mx-auto animate-rise">
    ${card}
    ${iAmReady
      ? `<div class="text-center py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/40
           text-emerald-300 font-semibold">✓ Ready — waiting for the others</div>`
      : `<button data-action="onlineReady" class="${BTN.success}">Got it — I'm Ready</button>`}
    <p class="text-center text-sm text-zinc-500 mt-4">
      <span class="text-zinc-300 font-semibold">${readyCount}/${total}</span> players ready
    </p>
  </div>`;
};

/* ---------- 5d. Discussion arena ---------- */

function onlineCurrentAsker() {
  const d = O.discussion;
  if (!d || !d.order.length) return null;
  const idx = Math.floor((Date.now() - d.startAt) / (d.turnSeconds * 1000)) % d.order.length;
  return d.order[idx];
}

SCREENS.onlineDiscussion = () => {
  const st = O.state, d = O.discussion;
  if (!st || !d) return `<p class="text-zinc-400">Loading discussion…</p>`;
  const asker = onlineCurrentAsker();
  const imposter = !!O.role?.isImposter;

  return `
  ${header("Discussion")}
  <div class="${CARD} animate-rise">
    <p class="text-center text-xs uppercase tracking-[.3em] text-zinc-500 mb-1">Category</p>
    <h2 class="text-center font-display text-2xl font-bold text-indigo-300 mb-6">${esc(st.category)}</h2>

    ${timerRing()}

    <div class="mt-6 mb-6 text-center">
      ${imposter
        ? `<span class="inline-block px-4 py-2 rounded-full bg-rose-500/15 border border-rose-500/50
             text-rose-300 text-sm font-semibold">🗡️ You are the Imposter — blend in</span>`
        : `<button data-action="togglePeek" class="inline-block px-4 py-2 rounded-full bg-indigo-500/15
             border border-indigo-500/50 text-indigo-200 text-sm font-semibold">
             Your word: <span id="peek-word" class="${O.peek ? "" : "blur-sm select-none"}">${esc(O.role?.word || "")}</span>
             <span class="text-indigo-400/70 ml-1 text-xs">(tap to ${O.peek ? "hide" : "peek"})</span>
           </button>`}
    </div>

    <h3 class="text-sm font-semibold text-zinc-300 mb-2">Whose turn to ask</h3>
    <div id="asker-grid-online" class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-7">
      ${d.order.map((p, i) => `
        <div data-oasker="${p.id}" class="flex items-center gap-2 rounded-xl border px-3 py-2.5 transition
          ${asker && p.id === asker.id
            ? "border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-500/10"
            : "border-zinc-800 bg-zinc-800/40"}">
          <div class="w-7 h-7 rounded-full bg-gradient-to-br ${avatarClass(i)}
               flex items-center justify-center text-xs font-bold shrink-0">${esc(p.name[0].toUpperCase())}</div>
          <span class="text-sm font-medium truncate">${esc(p.name)}${p.id === O.selfId ? " (you)" : ""}</span>
        </div>`).join("")}
    </div>

    ${imposter ? `
    <div class="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4 mb-4">
      <p class="text-xs uppercase tracking-widest text-rose-300 mb-2">Steal the win</p>
      <div class="flex gap-2">
        <input id="online-guess" placeholder="Guess the exact word…" maxlength="40"
          class="flex-1 bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm
                 placeholder-zinc-500 focus:border-rose-500 focus:outline-none" />
        <button data-action="onlineImposterGuess" class="px-5 rounded-xl font-display font-bold text-sm
          bg-rose-500 hover:bg-rose-400 transition text-white">Guess</button>
      </div>
      <p class="text-xs text-zinc-500 mt-2">Correct = you win instantly. Wrong = you're exposed and Citizens win.</p>
    </div>` : ""}

    ${isHost() ? `<button data-action="onlineSkipToVote" class="${BTN.violet} py-3.5 text-base">Skip Timer → Start Voting</button>` : ""}
  </div>`;
};

function updateOnlineAskerHighlight() {
  const grid = document.getElementById("asker-grid-online");
  const asker = onlineCurrentAsker();
  if (!grid || !asker) return;
  grid.querySelectorAll("[data-oasker]").forEach((el) => {
    const active = el.dataset.oasker === asker.id;
    el.className =
      "flex items-center gap-2 rounded-xl border px-3 py-2.5 transition " +
      (active
        ? "border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-500/10"
        : "border-zinc-800 bg-zinc-800/40");
  });
}

/* ---------- 5e. Voting arena with live distribution bars ---------- */

SCREENS.onlineVoting = () => {
  const st = O.state;
  if (!st) return `<p class="text-zinc-400">Loading vote…</p>`;
  const imposter = !!O.role?.isImposter;

  return `
  ${header("Voting")}
  <div class="${CARD} animate-rise">
    <h2 class="font-display text-3xl font-bold text-center mb-1">Who is the Imposter?</h2>
    <p class="text-center text-sm text-zinc-400 mb-1">
      Tap a tile to accuse · tap again to withdraw your vote.
    </p>
    <p class="text-center text-sm mb-6">
      <span id="vote-progress" class="text-zinc-300 font-semibold">${O.votes.votedCount}/${O.votes.eligible}</span>
      <span class="text-zinc-500"> votes in · </span>
      <span id="vote-clock" class="text-zinc-300 font-semibold tabular-nums">--:--</span>
      <span class="text-zinc-500"> left</span>
    </p>

    ${O.locking ? `
      <div class="mb-5 text-center py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40
           text-amber-300 text-sm font-semibold animate-pulse">All votes are in — locking the ballot…</div>` : ""}

    <div class="grid gap-2.5 mb-6">
      ${st.players.filter((p) => p.connected).map((p, i) => {
        const mine = O.myVote === p.id;
        const self = p.id === O.selfId;
        return `
        <button data-action="onlineCastVote" data-arg="${p.id}" ${self ? "disabled" : ""}
          class="rounded-2xl border p-3.5 text-left transition relative overflow-hidden
            ${self
              ? "border-zinc-800 bg-zinc-900 opacity-60 cursor-not-allowed"
              : mine
                ? "border-rose-500 bg-rose-500/10 shadow-lg shadow-rose-500/10"
                : "border-zinc-700 bg-zinc-800/50 hover:border-rose-500/60"}">
          <div class="flex items-center gap-3 relative z-10">
            <div class="w-9 h-9 rounded-full bg-gradient-to-br ${avatarClass(i)}
                 flex items-center justify-center font-bold text-sm shrink-0">${esc(p.name[0].toUpperCase())}</div>
            <span class="font-semibold truncate">${esc(p.name)}${self ? " (you)" : ""}</span>
            ${mine ? `<span class="ml-auto text-rose-300 text-sm font-bold shrink-0">YOUR VOTE 🗳️</span>` : ""}
            <span data-vote-count="${p.id}" class="ml-auto text-sm tabular-nums text-zinc-400 shrink-0
              ${mine ? "!ml-3" : ""}">${O.votes.counts[p.id] || 0}</span>
          </div>
          <div class="mt-2.5 h-1.5 rounded-full bg-zinc-800 overflow-hidden relative z-10">
            <div data-vote-bar="${p.id}" class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500
                 transition-all duration-500" style="width:0%"></div>
          </div>
        </button>`;
      }).join("")}
    </div>

    ${imposter ? `
    <div class="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4">
      <div class="flex gap-2">
        <input id="online-guess" placeholder="Last chance — guess the word…" maxlength="40"
          class="flex-1 bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm
                 placeholder-zinc-500 focus:border-rose-500 focus:outline-none" />
        <button data-action="onlineImposterGuess" class="px-5 rounded-xl font-display font-bold text-sm
          bg-rose-500 hover:bg-rose-400 transition text-white">Guess</button>
      </div>
    </div>` : ""}
  </div>`;
};

function updateVoteBars() {
  const totalVotes = Math.max(1, Object.values(O.votes.counts).reduce((a, b) => a + b, 0));
  for (const [id, count] of Object.entries(O.votes.counts)) {
    const bar = document.querySelector(`[data-vote-bar="${CSS.escape(id)}"]`);
    const label = document.querySelector(`[data-vote-count="${CSS.escape(id)}"]`);
    if (bar) bar.style.width = `${(count / totalVotes) * 100}%`;
    if (label) label.textContent = String(count);
  }
  const progress = document.getElementById("vote-progress");
  if (progress) progress.textContent = `${O.votes.votedCount}/${O.votes.eligible}`;
}

/* ---------- 5f. Last stand & results ---------- */

SCREENS.onlineLastStand = () => {
  const ls = O.lastStand;
  if (!ls) return `<p class="text-zinc-400">Loading…</p>`;
  const iAmAccused = ls.accusedId === O.selfId;

  return `
  ${header("Last Stand")}
  <div class="${CARD} border-rose-500/50 max-w-md mx-auto animate-rise text-center">
    <div class="text-5xl mb-3">⚖️</div>
    <h2 class="font-display text-3xl font-bold mb-2">
      <span class="text-rose-400">${esc(ls.accusedName)}</span> was caught!
    </h2>
    <p class="text-zinc-400 mb-2">
      Category: <span class="text-indigo-300 font-medium">${esc(ls.category)}</span>
    </p>
    <p class="text-sm mb-6">
      <span id="laststand-clock" class="font-display text-2xl font-bold text-amber-400 tabular-nums">--:--</span>
      <span class="text-zinc-500"> to guess the word</span>
    </p>

    ${iAmAccused ? `
      <input id="online-guess" data-autofocus placeholder="Type the exact word…" maxlength="40"
        class="w-full bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-3 mb-4 text-center
               font-display text-xl placeholder-zinc-500 focus:border-rose-500 focus:outline-none" />
      <button data-action="onlineImposterGuess" class="${BTN.danger}">Final Answer</button>`
      : `<p class="text-zinc-300">Hold your breath — the Imposter gets one final guess to steal the win…</p>`}
  </div>`;
};

SCREENS.onlineResults = () => {
  const r = O.result;
  if (!r) return `<p class="text-zinc-400">Loading results…</p>`;
  const citizensWin = r.outcome === "citizens";
  const maxVotes = Math.max(1, ...r.votes.map((v) => v.votes));

  return `
  ${header("Round Over")}
  <div class="${CARD} animate-rise ${citizensWin ? "border-emerald-500/50" : "border-rose-500/50"}">
    <div class="text-center mb-6">
      <div class="text-6xl mb-4">${citizensWin ? "🏆" : "🗡️"}</div>
      <h2 class="font-display text-4xl font-bold ${citizensWin ? "text-emerald-400" : "text-rose-400"} mb-2">
        ${citizensWin ? "CITIZENS WIN" : "IMPOSTER WINS"}
      </h2>
      <p class="text-zinc-300">${esc(r.reason)}</p>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-6 text-center">
      <div class="rounded-2xl bg-zinc-800/60 border border-zinc-700 p-4">
        <p class="text-xs uppercase tracking-widest text-zinc-500 mb-1">The Imposter</p>
        <p class="font-display text-xl font-bold text-rose-400">${esc(r.imposterName)}</p>
      </div>
      <div class="rounded-2xl bg-zinc-800/60 border border-zinc-700 p-4">
        <p class="text-xs uppercase tracking-widest text-zinc-500 mb-1">The Word</p>
        <p class="font-display text-xl font-bold text-indigo-300">${esc(r.word)}</p>
      </div>
    </div>

    <h3 class="text-sm font-semibold text-zinc-300 mb-2">Final votes</h3>
    <div class="grid gap-2 mb-6">
      ${r.votes.sort((a, b) => b.votes - a.votes).map((v) => `
        <div class="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 py-2">
          <span class="text-sm font-medium w-28 truncate ${v.isImposter ? "text-rose-400" : ""}">
            ${esc(v.name)}${v.isImposter ? " 🗡️" : ""}
          </span>
          <div class="flex-1 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
            <div class="h-full rounded-full ${v.isImposter ? "bg-rose-500" : "bg-indigo-500"}"
                 style="width:${(v.votes / maxVotes) * 100}%"></div>
          </div>
          <span class="text-sm tabular-nums text-zinc-400 w-6 text-right">${v.votes}</span>
        </div>`).join("")}
    </div>

    ${isHost()
      ? `<button data-action="onlinePlayAgain" class="${BTN.primary}">Back to Lobby — Play Again</button>`
      : `<p class="text-center text-sm text-zinc-400 py-3">Waiting for the host to start a new round…</p>`}
    <button data-action="onlineLeave" class="mt-3 ${BTN.ghost}">Leave Room</button>
  </div>`;
};

/* ================================================================== */
/* 6. Actions (delegated click handling)                              */
/* ================================================================== */

const ACTIONS = {
  /* --- global --- */
  backToMenu() {
    if (S.screen.startsWith("online") && socket && O.state) {
      socket.emit("room:leave");
      O.state = null;
    }
    go("menu");
  },

  /* --- local mode --- */
  goLocalSetup() {
    L.names = loadSavedNames();
    go("localSetup");
  },
  localAddPlayer() {
    syncNameInputs();
    if (L.names.length < 10) L.names.push("");
    render();
  },
  localRemovePlayer({ arg }) {
    syncNameInputs();
    if (L.names.length > 3) L.names.splice(Number(arg), 1);
    render();
  },
  localSetSeconds({ arg }) {
    syncNameInputs();
    L.seconds = Number(arg);
    render();
  },
  localStart() {
    syncNameInputs();
    L.names = L.names.map((n) => n.replace(/\s+/g, " ").trim().slice(0, 14));
    if (L.names.some((n) => !n)) return toast("Every player needs a name.", "error");
    const lower = L.names.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) return toast("Names must be unique.", "error");
    saveNames();
    startLocalRound();
  },
  localRevealShow() { L.revealShown = true; render(); },
  localRevealHide() { advanceLocalReveal(); },
  localNextAsker() { L.askOffset += 1; updateAskerHighlight(); },
  localOpenClaim() { L.claimOpen = true; render(); },
  localCloseClaim() { L.claimOpen = false; render(); },
  localSubmitClaim() {
    const guess = document.getElementById("claim-guess")?.value || "";
    if (!guess.trim()) return toast("Type a guess first.", "error");
    resolveLocalClaim(guess);
  },
  localGoVote() { beginLocalVoting(); },
  localCastVote({ arg }) { afterLocalVote(Number(arg)); },
  localSubmitLastStand() {
    const guess = document.getElementById("laststand-guess")?.value || "";
    if (!guess.trim()) return toast("Type a guess first.", "error");
    resolveLocalLastStand(guess);
  },
  localPlayAgain() { startLocalRound(); },

  /* --- online mode --- */
  goOnlineEntry() {
    if (!ensureSocket()) return;
    go("onlineEntry");
  },
  onlineHost() {
    const name = document.getElementById("online-name")?.value || "";
    O.name = name;
    if (!ensureSocket()) return;
    socket.emit("room:create", { name }, (res) => {
      if (res.error) return toast(res.error, "error");
      O.selfId = res.selfId;
      O.state = res.state;
      go("onlineLobby");
    });
  },
  onlineJoin() {
    const name = document.getElementById("online-name")?.value || "";
    const code = document.getElementById("online-code")?.value || "";
    O.name = name;
    if (!/^\d{4}$/.test(code.trim())) return toast("Room codes are 4 digits.", "error");
    if (!ensureSocket()) return;
    socket.emit("room:join", { code: code.trim(), name }, (res) => {
      if (res.error) return toast(res.error, "error");
      O.selfId = res.selfId;
      O.state = res.state;
      go("onlineLobby");
    });
  },
  copyCode() {
    const code = O.state?.code || "";
    navigator.clipboard?.writeText(code)
      .then(() => toast(`Room code ${code} copied`, "success"))
      .catch(() => toast(`Room code: ${code}`));
  },
  onlineSetSeconds({ arg }) { O.hostSeconds = Number(arg); render(); },
  onlineStartGame() {
    socket.emit("game:start", { discussionSeconds: O.hostSeconds || 240 }, (res) => {
      if (res.error) toast(res.error, "error");
    });
  },
  onlineReady() { socket.emit("player:ready"); },
  onlineSkipToVote() { socket.emit("discussion:skipToVote"); },
  togglePeek() { O.peek = !O.peek; render(); },
  onlineCastVote({ arg }) {
    if (arg === O.selfId) return;
    O.myVote = O.myVote === arg ? null : arg;
    socket.emit("vote:cast", { targetId: arg });
    render();
    updateVoteBars();
  },
  onlineImposterGuess() {
    if (O.guessBusy) return;
    const guess = document.getElementById("online-guess")?.value || "";
    if (!guess.trim()) return toast("Type a guess first.", "error");
    O.guessBusy = true;
    socket.emit("imposter:guess", { guess }, (res) => {
      O.guessBusy = false;
      if (res.error) return toast(res.error, "error");
      // The server follows up with game:over either way.
    });
  },
  onlinePlayAgain() { socket.emit("game:playAgain"); },
  onlineLeave() {
    socket.emit("room:leave");
    O.state = null; O.role = null; O.result = null;
    go("menu");
  }
};

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset, el);
});

/* Enter-key shortcuts for the guess/name inputs. */
app.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const map = {
    "claim-guess": "localSubmitClaim",
    "laststand-guess": "localSubmitLastStand",
    "online-guess": "onlineImposterGuess",
    "online-code": "onlineJoin"
  };
  const action = map[e.target.id];
  if (action) ACTIONS[action]({});
});

/* ================================================================== */
/* 7. Ticker — drives every live countdown & the turn rotation        */
/* ================================================================== */

function tick() {
  const now = Date.now();

  if (S.screen === "localArena") {
    const remaining = L.discussionEndsAt - now;
    updateRing(remaining, L.seconds * 1000);
    updateAskerHighlight();
    if (remaining <= 0 && !L.claimOpen) beginLocalVoting();
  }

  if (S.screen === "onlineDiscussion" && O.discussion) {
    updateRing(O.discussion.endsAt - now, (O.discussion.endsAt - O.discussion.startAt) || 1);
    updateOnlineAskerHighlight();
  }

  if (S.screen === "onlineVoting" && O.state?.votingEndsAt) {
    const clock = document.getElementById("vote-clock");
    if (clock) clock.textContent = fmtClock(O.state.votingEndsAt - now);
  }

  if (S.screen === "onlineLastStand" && O.lastStand) {
    const clock = document.getElementById("laststand-clock");
    if (clock) clock.textContent = fmtClock(O.lastStand.endsAt - now);
  }
}

setInterval(tick, 1000);

/* Boot */
render();
