import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = 'http://localhost:3000';

function App() {
  const [socket, setSocket] = useState(null);
  const [screen, setScreen] = useState('home');
  const [room, setRoom] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [theme, setTheme] = useState('fruits');
  const [hintsEnabled, setHintsEnabled] = useState(false);
  const [maxHints, setMaxHints] = useState(2);
  const [botCount, setBotCount] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(10);
  const [error, setError] = useState('');

  // Game state
  const [players, setPlayers] = useState([]);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [gameResult, setGameResult] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [myHintsLeft, setMyHintsLeft] = useState(0);

  // Word-by-word feedback visible to ALL players
  const [turnWords, setTurnWords] = useState([]);
  const [turnComplete, setTurnComplete] = useState(false);

  // Current player input
  const [currentWordInput, setCurrentWordInput] = useState('');
  const [perWordTimer, setPerWordTimer] = useState(10);

  const chatRef = useRef(null);

  useEffect(() => {
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    newSocket.on('room-created', (data) => {
      setRoom(data.room);
      setRoomId(data.roomId);
      setInviteLink(data.inviteLink);
      setScreen('lobby');
      setPlayers(data.room.players);
    });

    newSocket.on('room-joined', (data) => {
      setRoom(data.room);
      setRoomId(data.roomId);
      setScreen('lobby');
      setPlayers(data.room.players);
    });

    newSocket.on('room-update', (updatedRoom) => {
      setRoom(updatedRoom);
      setPlayers(updatedRoom.players);
    });

    newSocket.on('game-started', (gameRoom) => {
      setRoom(gameRoom);
      setScreen('game');
      setGameResult(null);
      setTurnWords([]);
      setTurnComplete(false);
    });

    newSocket.on('turn-start', (data) => {
      setCurrentTurn(data);
      setTurnWords([]);
      setTurnComplete(false);
      setPerWordTimer(timerSeconds);
      setCurrentWordInput('');
      const me = players.find(p => p.id === newSocket.id);
      if (me) setMyHintsLeft(me.hintsLeft || 0);
    });

    newSocket.on('word-result', (data) => {
      if (data.correct === false) {
        // elimination
        setTurnWords(prev => [...prev, { word: data.error || '?', correct: false }]);
        setTurnComplete(true);
      } else if (data.correct) {
        setTurnWords(prev => [...prev, { word: data.word, correct: true }]);
        if (data.final) {
          setTurnComplete(true);
        }
      }
    });

    newSocket.on('next-word-new', () => {
      // no action needed, just continue
    });

    newSocket.on('hint-revealed', (data) => {
      setMyHintsLeft(data.hintsLeft);
      // Show hint letter somewhere (we'll use a hint display)
    });

    newSocket.on('chat-message', (message) => {
      setChatMessages(prev => [...prev, message]);
    });

    newSocket.on('game-over', (data) => {
      setGameResult(data);
    });

    newSocket.on('error', (data) => {
      setError(data.message);
      setTimeout(() => setError(''), 3000);
    });

    return () => newSocket.close();
  }, [timerSeconds]);
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/join/')) {
        const code = path.split('/join/')[1];
        if (code) {
            setRoomId(code.toUpperCase());
            setScreen('join');
        }
    }
}, []);

  // Per-word timer for current player
  useEffect(() => {
    if (!currentTurn || currentTurn.playerId !== socket?.id || turnComplete) return;
    const timer = setInterval(() => {
      setPerWordTimer(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          socket.emit('word-timeout', roomId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [currentTurn, turnComplete, socket, roomId]);

  const createRoom = () => {
    if (!playerName.trim()) { setError('Please enter your name'); return; }
    socket.emit('create-room', { playerName, theme, hintsEnabled, maxHints, timerSeconds, bots: parseInt(botCount) });
  };

  const joinRoom = () => {
    if (!playerName.trim() || !roomId.trim()) { setError('Please fill all fields'); return; }
    socket.emit('join-room', { playerName, roomId: roomId.toUpperCase() });
  };

  const startGame = () => socket.emit('start-game', roomId);

  const submitWord = () => {
    const word = currentWordInput.trim();
    if (!word) return;
    socket.emit('submit-word', { roomId, word });
    setCurrentWordInput('');
    setPerWordTimer(timerSeconds);
  };

  const useHint = () => socket.emit('use-hint', roomId);

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    socket.emit('send-message', { roomId, text: chatInput });
    setChatInput('');
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    alert('Invite link copied!');
  };

  // Screens rendering
  if (screen === 'home') {
    return (
      <div className="container">
        <div className="home-screen">
          <h1 className="title">🧠 Memory Chain</h1>
          <p className="subtitle">The ultimate memory test with friends!</p>
          <input type="text" placeholder="Enter your name" value={playerName} onChange={e => setPlayerName(e.target.value)} className="input" />
          <button onClick={() => setScreen('create')} className="btn btn-primary">Create New Game</button>
          <button onClick={() => setScreen('join')} className="btn btn-secondary">Join Game</button>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  if (screen === 'create') {
    return (
      <div className="container">
        <div className="create-screen">
          <h2>Create Game Room</h2>
          <label>Theme:</label>
          <select value={theme} onChange={e => setTheme(e.target.value)} className="input">
            <option value="fruits">🍎 Fruits</option>
            <option value="animals">🐘 Animals</option>
            <option value="countries">🌍 Countries</option>
            <option value="movies">🎬 Movies</option>
          </select>
          <label>Timer per word (seconds):</label>
          <input type="number" value={timerSeconds} onChange={e => setTimerSeconds(e.target.value)} className="input" min="5" max="30" />
          <label>Number of Bots:</label>
          <input type="number" value={botCount} onChange={e => setBotCount(e.target.value)} className="input" min="0" max="5" />
          <label><input type="checkbox" checked={hintsEnabled} onChange={e => setHintsEnabled(e.target.checked)} /> Enable Hints</label>
          {hintsEnabled && (
            <>
              <label>Max Hints per Player:</label>
              <select value={maxHints} onChange={e => setMaxHints(e.target.value)} className="input">
                <option value="1">1 Hint</option>
                <option value="2">2 Hints</option>
              </select>
            </>
          )}
          <button onClick={createRoom} className="btn btn-primary">Create Room</button>
          <button onClick={() => setScreen('home')} className="btn btn-secondary">Back</button>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

 if (screen === 'join') {
    return (
      <div className="container">
        <div className="join-screen">
          <h2>Join Game</h2>
          
          <label>Your Name:</label>
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="input"
          />
          
          <label>Room Code:</label>
          <input
            type="text"
            placeholder="Enter room code"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            className="input"
            maxLength="6"
          />
          
          <button onClick={joinRoom} className="btn btn-primary">Join Room</button>
          <button onClick={() => setScreen('home')} className="btn btn-secondary">Back</button>
          
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  if (screen === 'lobby') {
    return (
      <div className="container">
        <div className="lobby-screen">
          <h2>Game Lobby</h2>
          <div className="room-code">Room Code: <strong>{roomId}</strong></div>
          <button onClick={copyInviteLink} className="btn btn-secondary">📋 Copy Invite Link</button>
          <div className="players-list">
            <h3>Players ({players.length}):</h3>
            {players.map((p, i) => (
              <div key={i} className="player-item">
                {p.isBot ? '🤖' : '👤'} {p.name} {p.id === socket?.id && ' (You)'} {p.id === room?.host && ' 👑'}
              </div>
            ))}
          </div>
          <div className="game-info">
            <p>Theme: {theme}</p>
            <p>Timer: {timerSeconds}s per word</p>
            <p>Hints: {hintsEnabled ? `${maxHints} hints` : 'Disabled'}</p>
            <p>Bots: {botCount}</p>
          </div>
          {room?.host === socket?.id && (
            <button onClick={startGame} className="btn btn-primary btn-large">🎮 Start Game</button>
          )}
          <div className="chat-section">
            <h3>💬 Chat</h3>
            <div className="chat-messages">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.isSystem ? 'system' : ''}`}>
                  <strong>{msg.playerName}:</strong> {msg.text}
                </div>
              ))}
            </div>
            <div className="chat-input-area">
              <input type="text" placeholder="Type a message..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendMessage()} className="input" />
              <button onClick={sendMessage} className="btn btn-small">Send</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'game') {
    const isMyTurn = currentTurn?.playerId === socket?.id;
    const totalWords = currentTurn?.totalWords || 0;

    if (gameResult) {
      return (
        <div className="container">
          <div className="game-screen">
            <div className="game-over">
              <h2>🎉 Game Over!</h2>
              <p className="winner">Winner: {gameResult.winner}</p>
              <button onClick={() => window.location.reload()} className="btn btn-primary">Play Again</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="container">
        <div className="game-screen">
          <div className="game-header">
            <div className="theme-badge">Theme: {room?.theme || theme}</div>
            {isMyTurn && !turnComplete && (
              <div className={`timer ${perWordTimer <= 3 ? 'timer-danger' : ''}`}>
                ⏱️ {perWordTimer}s
              </div>
            )}
          </div>

          {/* Word feedback visible to all */}
          <div className="sequence-display">
            <h3>Live Turn: {currentTurn?.playerName || '...'}</h3>
            <div className="word-chain">
              {turnWords.length === 0 && !isMyTurn && <p>Waiting for first word...</p>}
              {turnWords.map((tw, i) => (
                <span key={i} className={`word-badge ${tw.correct ? 'word-correct' : 'word-wrong'}`}>
                  {tw.word}
                </span>
              ))}
              {turnComplete && turnWords.length > 0 && turnWords[turnWords.length-1].correct && (
                <span className="word-badge word-next">?</span>
              )}
              {!turnComplete && turnWords.length < totalWords && (
                <span className="word-badge word-next">?</span>
              )}
            </div>
          </div>

          {/* Input area for current player */}
          {isMyTurn && !turnComplete && (
            <div className="turn-section">
              <p>Word {turnWords.length + 1} of {totalWords}</p>
              <input
                type="text"
                placeholder="Type word here..."
                value={currentWordInput}
                onChange={e => setCurrentWordInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && submitWord()}
                className="input input-large"
                autoFocus
              />
              <div className="action-buttons">
                <button onClick={submitWord} className="btn btn-primary">Submit</button>
                {hintsEnabled && myHintsLeft > 0 && (
                  <button onClick={useHint} className="btn btn-hint">💡 Hint ({myHintsLeft})</button>
                )}
              </div>
            </div>
          )}

          {isMyTurn && turnComplete && (
            <div className="waiting-turn">
              <p>Turn finished. Waiting for next player...</p>
            </div>
          )}

          {!isMyTurn && currentTurn && (
            <div className="waiting-turn">
              <p>Waiting for {currentTurn.playerName}...</p>
              <div className="spinner"></div>
            </div>
          )}

          <div className="players-status">
            <h3>Players:</h3>
            {players.map((p, i) => (
              <div key={i} className={`player-status ${!p.isAlive ? 'eliminated' : ''}`}>
                <span>{p.isBot ? '🤖' : '👤'} {p.name}</span>
                {p.id === currentTurn?.playerId && ' ⬅️'}
                {!p.isAlive && ' ❌'}
                <span className="status-badge">{p.isAlive ? 'Alive' : 'Eliminated'}</span>
              </div>
            ))}
          </div>

          <div className="chat-section">
            <div className="chat-messages" ref={chatRef}>
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-message ${msg.isSystem ? 'system' : ''}`}>
                  <strong>{msg.playerName}:</strong> {msg.text}
                </div>
              ))}
            </div>
            <div className="chat-input-area">
              <input type="text" placeholder="Chat..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendMessage()} className="input" />
              <button onClick={sendMessage} className="btn btn-small">Send</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default App;