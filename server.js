const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Server storage for live games
const activeRooms = {}; 

io.on('connection', (socket) => {
  
  socket.on('join_room', ({ roomCode, name, isHost }) => {
    socket.join(roomCode);
    
    socket.roomCode = roomCode;
    socket.playerName = name;
    socket.isHost = isHost;

    if (!activeRooms[roomCode]) {
      activeRooms[roomCode] = {
        players: {},
        queue: [],
        activeIndex: 0
      };
    }

    // Register player info
    activeRooms[roomCode].players[socket.id] = { 
      name: name, 
      status: isHost ? "Host 👑" : "Thinking... 🧠" 
    };

    // Broadcast updated lists back to room
    io.to(roomCode).emit('update_host_dashboard', activeRooms[roomCode].players);
    
    // Sync newly joined/refreshed players to where the session currently is
    socket.emit('sync_session_state', {
      queue: activeRooms[roomCode].queue,
      activeIndex: activeRooms[roomCode].activeIndex
    });
  });

  socket.on('host_initialized_queue', ({ roomCode, queue }) => {
    if(activeRooms[roomCode]) {
      activeRooms[roomCode].queue = queue;
      activeRooms[roomCode].activeIndex = 0;
      
      // Reset statuses for a new game run
      for(let id in activeRooms[roomCode].players) {
        if(!activeRooms[roomCode].players[id].status.includes("👑")) {
          activeRooms[roomCode].players[id].status = "Thinking... 🧠";
        }
      }

      io.to(roomCode).emit('update_host_dashboard', activeRooms[roomCode].players);
      socket.to(roomCode).emit('sync_session_state', { queue, activeIndex: 0 });
    }
  });

  socket.on('host_nav_card', ({ roomCode, activeIndex }) => {
    if(activeRooms[roomCode]) {
      activeRooms[roomCode].activeIndex = activeIndex;
      
      // Reset student indicators back to thinking for the new card slide
      for(let id in activeRooms[roomCode].players) {
        if(!activeRooms[roomCode].players[id].status.includes("👑")) {
          activeRooms[roomCode].players[id].status = "Thinking... 🧠";
        }
      }

      io.to(roomCode).emit('update_host_dashboard', activeRooms[roomCode].players);
      socket.to(roomCode).emit('sync_session_state', { 
        queue: activeRooms[roomCode].queue, 
        activeIndex: activeIndex 
      });
    }
  });

  socket.on('student_submit_status', ({ roomCode, status }) => {
    if(activeRooms[roomCode] && activeRooms[roomCode].players[socket.id]) {
      activeRooms[roomCode].players[socket.id].status = status;
      io.to(roomCode).emit('update_host_dashboard', activeRooms[roomCode].players);
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socket.roomCode;
    if (roomCode && activeRooms[roomCode]) {
      delete activeRooms[roomCode].players[socket.id];
      io.to(roomCode).emit('update_host_dashboard', activeRooms[roomCode].players);
      
      // Clean up empty configurations after 15 mins of complete inactivity
      if (Object.keys(activeRooms[roomCode].players).length === 0) {
        setTimeout(() => {
          if (activeRooms[roomCode] && Object.keys(activeRooms[roomCode].players).length === 0) {
            delete activeRooms[roomCode];
          }
        }, 900000);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Hangeul Engine executing on port ${PORT}`));
