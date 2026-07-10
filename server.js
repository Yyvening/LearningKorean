const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve your HTML file when anyone visits the web link
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let rooms = {}; 

io.on('connection', (socket) => {
  // Triggered when someone puts in a room code and hits connect
  socket.on('join_room', ({ roomCode, name, isHost }) => {
    socket.join(roomCode);
    if (!rooms[roomCode]) {
      rooms[roomCode] = { mode: 'reading', queue: [], activeIndex: 0, players: {} };
    }
    if (!isHost) {
      rooms[roomCode].players[socket.id] = { name, status: 'Thinking... 🧠' };
    }
    // Instantly update the host's monitoring dashboard
    io.to(roomCode).emit('update_host_dashboard', rooms[roomCode].players);
  });

  // Triggered when host picks a study track (Reading, Block Builder, etc.)
  socket.on('host_initialized_queue', ({ roomCode, queue, mode }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].queue = queue;
      rooms[roomCode].mode = mode;
      rooms[roomCode].activeIndex = 0;
      socket.to(roomCode).emit('sync_session_state', rooms[roomCode]);
    }
  });

  // Triggered when host clicks 'Next Card'
  socket.on('host_next_card', ({ roomCode, activeIndex }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].activeIndex = activeIndex;
      // Reset student statuses back to neutral for the fresh card
      for (let id in rooms[roomCode].players) {
        rooms[roomCode].players[id].status = 'Thinking... 🧠';
      }
      io.to(roomCode).emit('update_host_dashboard', rooms[roomCode].players);
      socket.to(roomCode).emit('sync_session_state', rooms[roomCode]);
    }
  });

  // Triggered when a student submits their individual response
  socket.on('student_submit_status', ({ roomCode, status }) => {
    if (rooms[roomCode] && rooms[roomCode].players[socket.id]) {
      rooms[roomCode].players[socket.id].status = status;
      io.to(roomCode).emit('update_host_dashboard', rooms[roomCode].players);
    }
  });

  // Handle a user disconnecting from the call gracefully
  socket.on('disconnect', () => {
    for (let roomCode in rooms) {
      if (rooms[roomCode].players[socket.id]) {
        delete rooms[roomCode].players[socket.id];
        io.to(roomCode).emit('update_host_dashboard', rooms[roomCode].players);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running smoothly on port ${PORT}`));