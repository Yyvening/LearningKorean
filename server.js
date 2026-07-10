const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve public static assets if needed, and route home to index.html
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- PERSISTENT WORKSHOP STATE MEMORY ---
let activePlayers = {};          // Tracks socket.id -> { name, status, isHost }
let currentServerQueue = [];     // Cached active deck words
let currentActiveIndex = 0;      // Current active card position
let currentActiveMode = "reading"; // Active quiz format state
let sessionGlobalClickLogs = [];   // Persistent workspace error log history
let hostSocketId = null;         // The ONE socket allowed to control the session

const MAX_NAME_LENGTH = 40;

// Strip anything that could be interpreted as HTML before it's ever
// broadcast to other clients (defense in depth - the client also escapes).
function sanitizeName(raw) {
    const str = (typeof raw === 'string' ? raw : 'Anonymous Squadmate').slice(0, MAX_NAME_LENGTH);
    return str.replace(/[<>&"']/g, (c) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function isFromHost(socket) {
    return hostSocketId !== null && socket.id === hostSocketId;
}

io.on('connection', (socket) => {
    console.log(`📡 New Townsville Comm-Link Established: ${socket.id}`);

    // 1. CHANNELS: PLAYER REGISTRATION & FORCE LATE-SYNC
    socket.on('join_session', (data) => {
        const safeName = sanitizeName(data && data.name);
        const wantsHost = !!(data && data.isHost);

        // Only grant host if nobody currently holds it. A name containing a
        // crown emoji is no longer sufficient on its own to become host -
        // that let any student claim control of the class.
        let grantedHost = false;
        if (wantsHost) {
            if (hostSocketId === null) {
                hostSocketId = socket.id;
                grantedHost = true;
            } else {
                grantedHost = (hostSocketId === socket.id);
            }
        }

        activePlayers[socket.id] = {
            name: safeName,
            status: grantedHost ? "Facilitating Session 🧪" : "Ready for Duty! 🦸‍♀️",
            isHost: grantedHost
        };

        console.log(`👤 Character [${safeName}] spawned in active classroom grid.`);

        // Tell the requester whether their host request actually succeeded,
        // since a second person requesting host will silently be denied.
        socket.emit('host_status', { isHost: grantedHost, requestedHost: wantsHost });

        io.emit('update_roster', activePlayers);

        // CRITICAL PATCH: Force-sync data parameters if this user joined late
        if (currentServerQueue && currentServerQueue.length > 0) {
            socket.emit('sync_game', {
                queue: currentServerQueue,
                activeIndex: currentActiveIndex,
                mode: currentActiveMode
            });
        }
    });

    // 2. CHANNELS: DECK INITIATION LOOP (host-only)
    socket.on('start_game', (data) => {
        if (!isFromHost(socket)) return;

        currentServerQueue = Array.isArray(data && data.queue) ? data.queue : [];
        currentActiveIndex = 0;
        if (data && data.mode) currentActiveMode = data.mode;

        for (let id in activePlayers) {
            if (!activePlayers[id].isHost) {
                activePlayers[id].status = "Analyzing Prompt... 🤔";
            }
        }

        io.emit('update_roster', activePlayers);
        io.emit('sync_game', {
            queue: currentServerQueue,
            activeIndex: currentActiveIndex,
            mode: currentActiveMode
        });
    });

    // 3. CHANNELS: REAL-TIME SLIDE SYNCHRONIZATION (host-only)
    socket.on('nav_card', (data) => {
        if (!isFromHost(socket)) return;

        const requestedIndex = Number.isInteger(data && data.activeIndex) ? data.activeIndex : currentActiveIndex;
        // Clamp so a stray click can't push the deck out of bounds for everyone.
        currentActiveIndex = Math.max(0, Math.min(requestedIndex, Math.max(currentServerQueue.length - 1, 0)));
        if (data && data.mode) currentActiveMode = data.mode;

        for (let id in activePlayers) {
            if (!activePlayers[id].isHost) {
                activePlayers[id].status = "Analyzing Prompt... 🤔";
            }
        }

        io.emit('update_roster', activePlayers);
        io.emit('sync_game', {
            queue: currentServerQueue,
            activeIndex: currentActiveIndex,
            mode: currentActiveMode
        });
    });

    // 4. CHANNELS: STREAM EVALUATION LOG
    socket.on('submit_click', (data) => {
        const player = activePlayers[socket.id];
        if (!player || !data || typeof data.word !== 'string') return;

        sessionGlobalClickLogs.push({
            name: player.name,
            word: data.word,
            isCorrect: !!data.isCorrect,
            mode: currentActiveMode,
            timestamp: new Date().toISOString()
        });

        player.status = data.isCorrect ? "Cleared Card! Waiting... 🎯" : "Reviewing Mistake... ⚠️";
        io.emit('update_roster', activePlayers);
    });

    // 5. CHANNELS: END MULTI-QUIZ WORKSHOP RUN (host-only)
    socket.on('end_game', () => {
        if (!isFromHost(socket)) return;
        io.emit('game_over_analytics', sessionGlobalClickLogs);
    });

    // 6. CHANNELS: CONNECTION TERMINATION CLEANUP
    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            console.log(`🛑 Character [${activePlayers[socket.id].name}] left the map.`);
            delete activePlayers[socket.id];

            // Free up the host slot so the class isn't stuck if the
            // facilitator's tab crashes or refreshes.
            if (hostSocketId === socket.id) {
                hostSocketId = null;
            }

            io.emit('update_roster', activePlayers);
        }
    });
});

// Run server pipeline
server.listen(PORT, () => {
    console.log(`
============================================================
  🚀 한글 스튜디오 · Powerpuff Server Engine Live!
  📂 Local Dev Endpoint Loop: http://localhost:${PORT}
============================================================
    `);
});
