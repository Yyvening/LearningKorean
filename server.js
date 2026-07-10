const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- PERSISTENT WORKSHOP STATE MEMORY ---
let activePlayers = {};        
let currentServerQueue = [];   
let currentActiveIndex = 0;    
let currentActiveMode = "reading"; 
let sessionGlobalClickLogs = [];   

io.on('connection', (socket) => {
    console.log(`📡 New device connected: ${socket.id}`);

    socket.on('join_session', (data) => {
        activePlayers[socket.id] = {
            name: data.name || "Anonymous Squadmate",
            status: data.isHost ? "Facilitating Workshop 👑" : "Practicing ✏️",
            isHost: !!data.isHost
        };

        console.log(`👤 User '${data.name}' registered.`);
        io.emit('update_roster', activePlayers);

        if (currentServerQueue && currentServerQueue.length > 0) {
            socket.emit('sync_game', {
                queue: currentServerQueue,
                activeIndex: currentActiveIndex,
                mode: currentActiveMode
            });
        }
    });

    socket.on('start_game', (data) => {
        currentServerQueue = data.queue || [];
        currentActiveIndex = 0;
        if (data.mode) currentActiveMode = data.mode;

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

    socket.on('nav_card', (data) => {
        currentActiveIndex = data.activeIndex;
        if (data.mode) currentActiveMode = data.mode;

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

    socket.on('submit_click', (data) => {
        const player = activePlayers[socket.id];
        if (!player) return;

        sessionGlobalClickLogs.push({
            name: player.name,
            word: data.word,
            isCorrect: !!data.isCorrect,
            mode: currentActiveMode,
            timestamp: new Date().toISOString()
        });

        if (data.isCorrect) {
            player.status = "Cleared Card! Waiting... 🎯";
        } else {
            player.status = "Reviewing Mistake... ⚠️";
        }

        io.emit('update_roster', activePlayers);
    });

    socket.on('end_game', () => {
        io.emit('game_over_analytics', sessionGlobalClickLogs);
    });

    socket.on('disconnect', () => {
        if (activePlayers[socket.id]) {
            console.log(`🛑 User '${activePlayers[socket.id].name}' disconnected.`);
            delete activePlayers[socket.id];
            io.emit('update_roster', activePlayers);
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 한글 스튜디오 Live at http://localhost:${PORT}`);
});
