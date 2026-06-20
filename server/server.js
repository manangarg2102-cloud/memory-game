const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

const themes = {
  fruits: ["apple", "banana", "orange", "mango", "grape", "kiwi", "peach", "pear", "plum", "cherry", "watermelon", "pineapple", "strawberry", "blueberry", "lemon", "lime", "papaya", "guava"],
  animals: ["lion", "tiger", "elephant", "giraffe", "zebra", "monkey", "penguin", "dolphin", "kangaroo", "panda", "koala", "eagle", "parrot", "rabbit", "bear", "wolf", "fox", "deer"],
  countries: ["india", "japan", "brazil", "france", "egypt", "canada", "australia", "mexico", "italy", "spain", "china", "russia", "germany", "uk", "usa", "korea", "turkey", "greece"],
  movies: ["titanic", "avatar", "inception", "jaws", "frozen", "gladiator", "matrix", "up", "gravity", "joker", "casablanca", "psycho", "alien", "rocky", "braveheart", "toy story", "godfather", "goodfellas"]
};

class BotPlayer {
  constructor(name, theme) {
    this.name = name;
    this.theme = theme;
  }
  makeMove(sequence, usedWords) {
    const available = themes[this.theme].filter(w => !usedWords.includes(w));
    if (available.length === 0) return null;
    const newWord = available[Math.floor(Math.random() * available.length)];
    return [...sequence, newWord];
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-room', (data) => {
    const roomId = uuidv4().substring(0, 6).toUpperCase();
    rooms[roomId] = {
      id: roomId,
      host: socket.id,
      theme: data.theme,
      settings: {
        hintsEnabled: data.hintsEnabled || false,
        maxHints: data.maxHints || 2,
        timerSeconds: data.timerSeconds || 10,
        bots: data.bots || 0
      },
      players: [{
        id: socket.id,
        name: data.playerName,
        hintsLeft: data.hintsEnabled ? (data.maxHints || 2) : 0,
        isBot: false,
        isAlive: true
      }],
      sequence: [],
      usedWords: [],
      currentPlayerIndex: 0,
      currentWordIndex: 0,
      turnTimer: null,
      gameState: 'waiting',
      chat: []
    };

    for (let i = 0; i < data.bots; i++) {
      rooms[roomId].players.push({
        id: `bot-${roomId}-${i}`,
        name: `Bot ${i + 1} 🤖`,
        hintsLeft: 0,
        isBot: true,
        isAlive: true
      });
    }

    socket.join(roomId);
    socket.emit('room-created', {
      roomId,
      room: rooms[roomId],
      inviteLink: `https://YOUR_VERCEL_APP.vercel.app/join/${roomId}`
    });
    io.to(roomId).emit('room-update', rooms[roomId]);
  });

  socket.on('join-room', (data) => {
    const room = rooms[data.roomId];
    if (!room) {
      socket.emit('error', { message: 'Room not found!' });
      return;
    }
    if (room.gameState !== 'waiting') {
      socket.emit('error', { message: 'Game already started!' });
      return;
    }
    room.players.push({
      id: socket.id,
      name: data.playerName,
      hintsLeft: room.settings.hintsEnabled ? room.settings.maxHints : 0,
      isBot: false,
      isAlive: true
    });
    socket.join(data.roomId);
    socket.emit('room-joined', { roomId: data.roomId, room });
    io.to(data.roomId).emit('room-update', room);
    io.to(data.roomId).emit('chat-message', {
      playerName: 'System',
      text: `${data.playerName} joined the game!`,
      isSystem: true
    });
  });

  socket.on('start-game', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.gameState = 'playing';
    room.currentPlayerIndex = 0;
    room.currentWordIndex = 0;
    io.to(roomId).emit('game-started', room);
    io.to(roomId).emit('chat-message', {
      playerName: 'System',
      text: '🎮 Game Started! Theme: ' + room.theme,
      isSystem: true
    });
    startTurn(roomId);
  });

  socket.on('submit-word', (data) => {
    const room = rooms[data.roomId];
    if (!room || room.gameState !== 'playing') return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) return;

    clearTimeout(room.turnTimer);
    const word = data.word.trim().toLowerCase();
    const expectedPosition = room.currentWordIndex;

    if (expectedPosition < room.sequence.length) {
      // must repeat an existing word
      if (word === room.sequence[expectedPosition]) {
        room.currentWordIndex++;
        io.to(data.roomId).emit('word-result', {
          playerName: currentPlayer.name,
          position: expectedPosition,
          word: word,
          correct: true,
          final: false
        });

        if (room.currentWordIndex >= room.sequence.length) {
          // now the player must add a new word
          io.to(data.roomId).emit('next-word-new', {
            playerName: currentPlayer.name
          });
        }
      } else {
        eliminatePlayer(room, currentPlayer, `Wrong word! Expected something else.`);
      }
    } else {
      // adding a new word
      if (room.usedWords.includes(word)) {
        eliminatePlayer(room, currentPlayer, `"${word}" was already used!`);
      } else if (!themes[room.theme].includes(word)) {
        eliminatePlayer(room, currentPlayer, `"${word}" is not a ${room.theme}!`);
      } else {
        room.sequence.push(word);
        room.usedWords.push(word);
        room.currentWordIndex = 0;

        io.to(data.roomId).emit('word-result', {
          playerName: currentPlayer.name,
          position: expectedPosition,
          word: word,
          correct: true,
          final: true
        });

        io.to(data.roomId).emit('chat-message', {
          playerName: 'System',
          text: `${currentPlayer.name} added a new word.`,
          isSystem: true
        });

        setTimeout(() => {
          moveToNextPlayer(room);
          startTurn(data.roomId);
        }, 2500);
      }
    }
  });

  socket.on('word-timeout', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'playing') return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    eliminatePlayer(room, currentPlayer, '⏰ Time ran out for this word!');
  });

  socket.on('use-hint', (roomId) => {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'playing') return;
    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== socket.id || currentPlayer.hintsLeft <= 0) return;
    currentPlayer.hintsLeft--;

    let hintLetter = '';
    if (room.currentWordIndex < room.sequence.length) {
      hintLetter = room.sequence[room.currentWordIndex][0].toUpperCase();
    } else {
      const unused = themes[room.theme].filter(w => !room.usedWords.includes(w));
      if (unused.length > 0) hintLetter = unused[0][0].toUpperCase();
    }
    socket.emit('hint-revealed', { letter: hintLetter, hintsLeft: currentPlayer.hintsLeft });
  });

  socket.on('send-message', (data) => {
    const room = rooms[data.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    io.to(data.roomId).emit('chat-message', {
      playerName: player ? player.name : 'Unknown',
      text: data.text,
      isSystem: false,
      timestamp: Date.now()
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (let roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        const name = room.players[idx].name;
        room.players.splice(idx, 1);
        io.to(roomId).emit('chat-message', {
          playerName: 'System',
          text: `${name} left the game`,
          isSystem: true
        });
        io.to(roomId).emit('room-update', room);
        if (room.players.filter(p => !p.isBot).length === 0) delete rooms[roomId];
      }
    }
  });
});

function eliminatePlayer(room, player, reason) {
  player.isAlive = false;
  io.to(room.id).emit('word-result', {
    playerName: player.name,
    correct: false,
    error: reason
  });
  io.to(room.id).emit('chat-message', {
    playerName: 'System',
    text: `❌ ${player.name} eliminated: ${reason}`,
    isSystem: true
  });

  const alivePlayers = room.players.filter(p => p.isAlive);
  if (alivePlayers.length === 1) {
    room.gameState = 'finished';
    io.to(room.id).emit('game-over', { winner: alivePlayers[0].name });
    clearTimeout(room.turnTimer);
  } else {
    moveToNextPlayer(room);
    startTurn(room.id);
  }
}

function moveToNextPlayer(room) {
  do {
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  } while (!room.players[room.currentPlayerIndex].isAlive);
}

function startTurn(roomId) {
  const room = rooms[roomId];
  if (!room || room.gameState !== 'playing') return;
  room.currentWordIndex = 0;
  clearTimeout(room.turnTimer);

  const currentPlayer = room.players[room.currentPlayerIndex];
  io.to(roomId).emit('turn-start', {
    playerId: currentPlayer.id,
    playerName: currentPlayer.name,
    totalWords: room.sequence.length + 1
  });

  if (currentPlayer.isBot) {
    const bot = new BotPlayer(currentPlayer.name, room.theme);
    const fullMove = bot.makeMove(room.sequence, room.usedWords);
    if (fullMove) {
      let i = 0;
      const interval = setInterval(() => {
        if (i < fullMove.length) {
          const word = fullMove[i];
          const isLast = (i === fullMove.length - 1);
          io.to(roomId).emit('word-result', {
            playerName: currentPlayer.name,
            position: i,
            word: word,
            correct: true,
            final: isLast
          });
          i++;
          if (isLast) {
            clearInterval(interval);
            room.sequence.push(word);
            room.usedWords.push(word);
            room.currentWordIndex = 0;
            io.to(roomId).emit('chat-message', {
              playerName: 'System',
              text: `${currentPlayer.name} added a new word.`,
              isSystem: true
            });
            setTimeout(() => {
              moveToNextPlayer(room);
              startTurn(roomId);
            }, 2500);
          }
        }
      }, 800);
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));