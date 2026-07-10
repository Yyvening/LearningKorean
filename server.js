const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, '/')));

let activeClassroomPlayers = {};
let runningSessionState = {
  queue: [],
  activeIndex: 0,
  mode: "reading"
};
let evaluationAuditHistory = [];

io.on('connection', (socket) => {

  socket.on('join_session', (profile) => {
    activeClassroomPlayers[socket.id] = {
      name: profile.name,
      isHost: profile.isHost,
      status: "Lobby"
    };
    io.emit('update_roster', activeClassroomPlayers);
    if(runningSessionState.queue.length > 0) {
      socket.emit('sync_game', runningSessionState);
    }
  });

  socket.on('start_game', (payload) => {
    runningSessionState.queue = payload.queue;
    runningSessionState.activeIndex = 0;
    runningSessionState.mode = payload.mode;
    
    for (let id in activeClassroomPlayers) {
      activeClassroomPlayers[id].status = "Active Solving";
    }
    
    io.emit('update_roster', activeClassroomPlayers);
    io.emit('sync_game', runningSessionState);
  });

  socket.on('nav_card', (payload) => {
    runningSessionState.activeIndex = payload.activeIndex;
    runningSessionState.mode = payload.mode;
    io.emit('sync_game', runningSessionState);
  });

  socket.on('submit_click', (metric) => {
    const player = activeClassroomPlayers[socket.id];
    if (!player) return;

    evaluationAuditHistory.push({
      name: player.name,
      word: metric.word,
      isCorrect: metric.isCorrect,
      timestamp: Date.now()
    });

    if(metric.isCorrect) {
      player.status = `✅ Cleared Card ${runningSessionState.activeIndex + 1}`;
    } else {
      player.status = `⚠️ Error on Card ${runningSessionState.activeIndex + 1}`;
    }
    io.emit('update_roster', activeClassroomPlayers);
  });

  socket.on('end_game', () => {
    io.emit('game_over_analytics', evaluationAuditHistory);
    evaluationAuditHistory = []; 
    runningSessionState = { queue: [], activeIndex: 0, mode: "reading" };
  });

  socket.on('disconnect', () => {
    delete activeClassroomPlayers[socket.id];
    io.emit('update_roster', activeClassroomPlayers);
  });
});

const PORT = 3000;
http.listen(PORT, () => {
  console.log(`Server executing live environment on http://localhost:${PORT}`);
});
