const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let sessionState = {
  players: {},
  queue: [],
  activeIndex: -1, 
  statsLog: [] 
};

io.on('connection', (socket) => {
  
  socket.on('join_session', ({ name, isHost }) => {
    socket.playerName = name;
    socket.isHost = isHost;

    sessionState.players[socket.id] = {
      name: name,
      isHost: isHost,
      status: isHost ? "Facilitator 👑" : "In Lobby 💬"
    };

    io.emit('update_roster', sessionState.players);
    
    socket.emit('sync_game', {
      queue: sessionState.queue,
      activeIndex: sessionState.activeIndex
    });
  });

  socket.on('start_game', ({ queue }) => {
    if (!socket.isHost) return;
    sessionState.queue = queue;
    sessionState.activeIndex = 0;
    sessionState.statsLog = []; 

    for (let id in sessionState.players) {
      if (!sessionState.players[id].isHost) {
        sessionState.players[id].status = "Thinking... 🧠";
      }
    }

    io.emit('update_roster', sessionState.players);
    io.emit('sync_game', { queue: sessionState.queue, activeIndex: sessionState.activeIndex });
  });

  socket.on('submit_click', ({ word, isCorrect }) => {
    if (sessionState.players[socket.id]) {
      const name = sessionState.players[socket.id].name;
      sessionState.statsLog.push({ name, word, isCorrect });

      if (isCorrect) {
        sessionState.players[socket.id].status = "Passed! 🎉";
      } else {
        sessionState.players[socket.id].status = "Retrying... ❌";
      }
      io.emit('update_roster', sessionState.players);
    }
  });

  socket.on('nav_card', ({ activeIndex }) => {
    if (!socket.isHost) return;
    sessionState.activeIndex = activeIndex;

    for (let id in sessionState.players) {
      if (!sessionState.players[id].isHost) {
        sessionState.players[id].status = "Thinking... 🧠";
      }
    }

    io.emit('update_roster', sessionState.players);
    io.emit('sync_game', { queue: sessionState.queue, activeIndex: sessionState.activeIndex });
  });

  socket.on('end_game', () => {
    if (!socket.isHost) return;
    sessionState.activeIndex = 999; 
    io.emit('game_over_analytics', sessionState.statsLog);
  });

  socket.on('disconnect', () => {
    if (sessionState.players[socket.id]) {
      delete sessionState.players[socket.id];
      io.emit('update_roster', sessionState.players);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Hangeul Lab running on port ${PORT}`));
