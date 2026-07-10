// 한글 스튜디오 · Powerpuff Edition — realtime server
//
// Responsibilities added on top of the original protocol:
//  - Loads the vocab CSV ONCE on the server and broadcasts it to every
//    client, so the host and every student always quiz against the exact
//    same word pool, even if the sheet is edited mid-session.
//  - Tracks players by a persistent `clientId` (generated client-side and
//    stored in sessionStorage) instead of the ephemeral socket id, so a
//    wifi blip + reconnect is recognized as the same player rather than
//    a brand new one.
//  - Resolves duplicate display names ("로즈" -> "로즈 (2)") so the roster
//    and analytics can always tell two same-named players apart.
//  - Tracks how many (non-host) players have answered the current card
//    correctly and broadcasts that count for the host's pacing indicator.
//
// Run with: node server.js   (requires Node 18+ for global fetch)

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXpcCILEulBysiVCgHZWNbdIIDz-isW0CeiCkpg0FXerZ8o2N3dD5PNonYkK5nxsCauUWN93JbkZWH/pub?gid=0&single=true&output=csv";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const server = http.createServer(app);
const io = new Server(server);

// ------------------------------------------------------------------
// Vocab pool - single source of truth, loaded once and on host refresh
// ------------------------------------------------------------------
let vocabPool = [];
let vocabLoadError = null;

function parseCsv(text) {
  const clean = (v) => (v ? v.replace(/^"|"$/g, "").trim() : "");
  const lines = text.split(/\r?\n/);
  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      return {
        hangeul: clean(cols[0]),
        english: clean(cols[1]),
        type: clean(cols[2]),
        useCase: clean(cols[3]) || "",
      };
    })
    .filter((v) => v.hangeul && v.english);
}

async function loadVocabFromSheet() {
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`sheet responded HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) throw new Error("sheet had no usable rows");
    vocabPool = parsed;
    vocabLoadError = null;
  } catch (err) {
    vocabLoadError = err.message || "unknown error";
    console.error("Vocab sheet load failed:", vocabLoadError);
    if (vocabPool.length === 0) {
      // Only fall back if we have never successfully loaded anything yet -
      // a transient refresh failure should not nuke a working pool.
      vocabPool = [{ hangeul: "하루", english: "a day", type: "Vocab", useCase: "" }];
    }
  }
  return { vocabPool, vocabLoadError };
}

// Kick off the first load immediately so it's ready before anyone joins.
loadVocabFromSheet();

// ------------------------------------------------------------------
// Session state
// ------------------------------------------------------------------
let sessions = {};          // clientId -> { clientId, baseName, displayName, isHost, socketId, connected }
let socketToClient = {};    // socket.id -> clientId
let hostClientId = null;

let gameQueue = [];
let activeIndex = -1;
let activeMode = "reading";
let clearedThisCard = new Set(); // clientIds who answered correctly on the current card
let sessionLogs = [];             // { clientId, name, word, isCorrect, cardIndex } for the whole workshop

function uniqueDisplayName(base, ownerClientId) {
  const taken = new Set(
    Object.values(sessions)
      .filter((s) => s.clientId !== ownerClientId)
      .map((s) => s.displayName)
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

function broadcastRoster() {
  const roster = {};
  for (const clientId in sessions) {
    const s = sessions[clientId];
    roster[clientId] = {
      name: s.displayName,
      isHost: s.isHost,
      status: !s.connected ? "⚪ Reconnecting…" : s.isHost ? "👑 Hosting" : "🟢 Ready",
    };
  }
  io.emit("update_roster", roster);
}

function broadcastProgress() {
  const total = Object.values(sessions).filter((s) => !s.isHost).length;
  io.emit("progress_update", { cleared: clearedThisCard.size, total, cardIndex: activeIndex });
}

io.on("connection", (socket) => {
  socket.on("join_session", ({ clientId, name, isHost }) => {
    clientId = clientId || `anon-${socket.id}`;
    const baseName = (name || "Guest").trim();
    socketToClient[socket.id] = clientId;

    // Host allocation: first isHost:true request for a given clientId claims
    // it; the same clientId reconnecting always keeps it. Nobody else can
    // take over an active host slot.
    let grantedHost = false;
    if (isHost) {
      if (!hostClientId || hostClientId === clientId) {
        hostClientId = clientId;
        grantedHost = true;
      }
    }
    if (hostClientId === clientId) grantedHost = true;

    const existing = sessions[clientId];
    const displayName = existing ? existing.displayName : uniqueDisplayName(baseName, clientId);

    sessions[clientId] = {
      clientId,
      baseName,
      displayName,
      isHost: grantedHost,
      socketId: socket.id,
      connected: true,
    };

    socket.emit("host_status", { isHost: grantedHost, requestedHost: !!isHost, displayName });
    socket.emit("vocab_ready", { vocabPool, error: vocabLoadError });
    broadcastRoster();

    // Late-joiners / reconnectors get caught up on the live game state.
    if (activeIndex >= 0 && gameQueue.length > 0) {
      socket.emit("sync_game", { queue: gameQueue, activeIndex, mode: activeMode });
      broadcastProgress();
    }
  });

  socket.on("reload_vocab", async () => {
    const clientId = socketToClient[socket.id];
    const s = sessions[clientId];
    if (!s || !s.isHost) return;
    await loadVocabFromSheet();
    io.emit("vocab_ready", { vocabPool, error: vocabLoadError });
  });

  socket.on("start_game", ({ queue, mode }) => {
    const clientId = socketToClient[socket.id];
    const s = sessions[clientId];
    if (!s || !s.isHost) return;
    gameQueue = Array.isArray(queue) ? queue : [];
    activeMode = mode || "reading";
    activeIndex = 0;
    clearedThisCard = new Set();
    io.emit("sync_game", { queue: gameQueue, activeIndex, mode: activeMode });
    broadcastProgress();
  });

  socket.on("nav_card", ({ activeIndex: idx, mode }) => {
    const clientId = socketToClient[socket.id];
    const s = sessions[clientId];
    if (!s || !s.isHost) return;
    activeIndex = idx;
    if (mode) activeMode = mode;
    clearedThisCard = new Set();
    io.emit("sync_game", { queue: gameQueue, activeIndex, mode: activeMode });
    broadcastProgress();
  });

  socket.on("submit_click", ({ word, isCorrect }) => {
    const clientId = socketToClient[socket.id];
    const s = sessions[clientId];
    if (!s) return;
    sessionLogs.push({ clientId, name: s.displayName, word, isCorrect, cardIndex: activeIndex });
    if (isCorrect && !s.isHost) {
      clearedThisCard.add(clientId);
      broadcastProgress();
    }
  });

  socket.on("end_game", () => {
    const clientId = socketToClient[socket.id];
    const s = sessions[clientId];
    if (!s || !s.isHost) return;
    io.emit("game_over_analytics", sessionLogs);
  });

  socket.on("disconnect", () => {
    const clientId = socketToClient[socket.id];
    if (clientId && sessions[clientId] && sessions[clientId].socketId === socket.id) {
      sessions[clientId].connected = false;
      broadcastRoster();
    }
    delete socketToClient[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`한글 스튜디오 server listening on http://localhost:${PORT}`);
});
