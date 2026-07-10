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
let activePlayers = {};        // Tracks socket.id -> { name, status, isHost }
let currentServerQueue = [];   // Cached active deck words
let currentActiveIndex = 0;    // Current active card position
let currentActiveMode = "reading"; // Active quiz format state
let sessionGlobalClickLogs = [];   // Persistent workspace error log history

io.on('connection', (socket) => {
    console.log(`📡 New Townsville Comm-Link Established: ${socket.id}`);

    // 1. CHANNELS: PLAYER REGISTRATION & FORCE LATE-SYNC
    socket.on('join_session', (data) => {
        // Enforce host validation rules based on structural configuration or explicit flag
        const checksIfHost = !!data.isHost || (data.name && data.name.includes("👑"));
        
        // Register player profile attributes
        activePlayers[socket.id] = {
            name: data.name || "Anonymous Squadmate",
            status: checksIfHost ? "Facilitating Session 🧪" : "Ready for Duty! 🦸‍♀️",
            isHost: checksIfHost
        };

        console.log(`👤 Character [${data.name}] spawned in active classroom grid.`);
        
        // Push full roster table update to all clients instantly
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

    // 2. CHANNELS: DECK INITIATION LOOP
    socket.on('start_game', (data) => {
        // Overwrite standard parameters with fresh quiz targets passed from Host dashboard
        currentServerQueue = data.queue || [];
        currentActiveIndex = 0;
        if (data.mode) currentActiveMode = data.mode;

        // Reset player standing flags to active engagement targets
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

    // 3. CHANNELS: REAL-TIME SLIDE SYNCHRONIZATION
    socket.on('nav_card', (data) => {
        currentActiveIndex = data.activeIndex;
        if (data.mode) currentActiveMode = data.mode;

        // Reset user status flags cleanly for the next upcoming card
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
        if (!player) return;

        // Append log parameters directly into master evaluation history array
        sessionGlobalClickLogs.push({
            name: player.name,
            word: data.word,
            isCorrect: !!data.isCorrect,
            mode: currentActiveMode,
            timestamp: new Date().toISOString()
        });

        // Dynamic status adjustments for your sidebar feed tracker
        if (data.isCorrect) {
            player.status = "Cleared Card! Waiting... 🎯";
        } else {
            player.status = "Reviewing Mistake... ⚠️";
        }

        io.emit('update_roster', activePlayers);
    });

    // 5. CHANNELS: END MULTI-QUIZ WORKSHOP RUN
    socket.on('end_game', () => {
        // Direct broadcast of all cumulative evaluation entries to render full metrics
        io.emit('game_over_analytics', sessionGlobalClickLogs);
    });

    // 6. CHANNELS: CONNECTION TERMINATION CLEANUP
    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            console.log(`🛑 Character [${activePlayers[socket.id].name}] left the map.`);
            delete activePlayers[socket.id];
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
