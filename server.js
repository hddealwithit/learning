const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state tracking
const rooms = {}; 
const users = {
    'HridaanD': { password: 'securePassword123', admin: true } 
};

// Question bank data structure
const sampleQuestionSet = [
    { question: "What is the capital of France?", answers: ["Paris", "London", "Berlin", "Madrid"], correct: 0 },
    { question: "Which planet is known as the Red Planet?", answers: ["Earth", "Mars", "Jupiter", "Saturn"], correct: 1 },
    { question: "What is 5 + 7?", answers: ["10", "11", "12", "13"], correct: 2 }
];

// HTTP Authentication API Routing
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    if (users[username]) return res.status(400).json({ error: 'User already exists' });
    
    users[username] = { password, admin: username === 'HridaanD' };
    res.json({ success: true, username, isAdmin: users[username].admin });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ success: true, username, isAdmin: user.admin });
});

// Socket Engine Management
io.on('connection', (socket) => {
    let currentRoom = null;
    let userSessionName = null;

    // Triggered when an Admin connection initializes
    socket.on('registerAdminFeed', ({ username }) => {
        if (username === 'HridaanD') {
            socket.join('admin-stream');
            socket.emit('adminTelemetryUpdate', getSanitizedRoomData());
        }
    });

    // Host initializes a new multiplayer instance
    socket.on('hostCreateRoom', ({ hostName, gameMode }) => {
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        rooms[pin] = {
            pin,
            hostId: socket.id,
            hostName,
            gameMode: gameMode || 'classic',
            state: 'LOBBY', // LOBBY, PLAYING, ENDED
            players: {},
            currentQuestionIndex: 0,
            timer: 20
        };
        
        currentRoom = pin;
        userSessionName = hostName;
        socket.join(pin);
        socket.emit('roomCreated', rooms[pin]);
        
        // Push live structural updates to HridaanD
        io.to('admin-stream').emit('adminTelemetryUpdate', getSanitizedRoomData());
    });

    // Player attempts to join via pin
    socket.on('playerJoinRoom', ({ pin, playerName }) => {
        const room = rooms[pin];
        if (!room) return socket.emit('joinError', 'Room not found!');
        if (room.state !== 'LOBBY') return socket.emit('joinError', 'Game already started!');
        
        room.players[socket.id] = {
            name: playerName,
            score: 0,
            gold: 100, // Gold quest mechanics base value
            lastAnswerCorrect: false
        };

        currentRoom = pin;
        userSessionName = playerName;
        socket.join(pin);

        // Notify room host and players
        io.to(pin).emit('playerListUpdate', Object.values(room.players));
        io.to('admin-stream').emit('adminTelemetryUpdate', getSanitizedRoomData());
    });

    // Host triggers game start loop
    socket.on('startGame', () => {
        const room = rooms[currentRoom];
        if (room && room.hostId === socket.id) {
            room.state = 'PLAYING';
            sendQuestion(currentRoom);
            io.to('admin-stream').emit('adminTelemetryUpdate', getSanitizedRoomData());
        }
    });

    // Handle incoming answer choices from client applications
    socket.on('submitAnswer', ({ answerIndex }) => {
        const room = rooms[currentRoom];
        if (!room || room.state !== 'PLAYING') return;

        const player = room.players[socket.id];
        const currentQuestion = sampleQuestionSet[room.currentQuestionIndex];

        if (player && currentQuestion) {
            if (answerIndex === currentQuestion.correct) {
                player.score += 100;
                player.gold += Math.floor(Math.random() * 50) + 20; // Dynamic gold rewards
                player.lastAnswerCorrect = true;
                socket.emit('answerResult', { correct: true, pointsGained: 100, currentGold: player.gold });
            } else {
                player.lastAnswerCorrect = false;
                socket.emit('answerResult', { correct: false, pointsGained: 0, currentGold: player.gold });
            }
            io.to(room.hostId).emit('hostStatsUpdate', Object.values(room.players));
        }
    });

    socket.on('disconnect', () => {
        if (rooms[currentRoom]) {
            if (rooms[currentRoom].hostId === socket.id) {
                io.to(currentRoom).emit('gameTerminated', 'Host disconnected');
                delete rooms[currentRoom];
            } else if (rooms[currentRoom].players[socket.id]) {
                delete rooms[currentRoom].players[socket.id];
                io.to(currentRoom).emit('playerListUpdate', Object.values(rooms[currentRoom].players));
            }
            io.to('admin-stream').emit('adminTelemetryUpdate', getSanitizedRoomData());
        }
    });
});

function sendQuestion(pin) {
    const room = rooms[pin];
    if (!room) return;

    if (room.currentQuestionIndex >= sampleQuestionSet.length) {
        room.state = 'ENDED';
        io.to(pin).emit('gameOver', Object.values(room.players).sort((a,b) => b.score - a.score));
        return;
    }

    const fullQuestion = sampleQuestionSet[room.currentQuestionIndex];
    // Strip out the correct index answer for safety when sending to client screens
    const clientQuestion = {
        question: fullQuestion.question,
        answers: fullQuestion.answers,
        index: room.currentQuestionIndex
    };

    io.to(pin).emit('nextQuestion', clientQuestion);
}

function getSanitizedRoomData() {
    const summary = {};
    Object.keys(rooms).forEach(pin => {
        summary[pin] = {
            pin: rooms[pin].pin,
            hostName: rooms[pin].hostName,
            gameMode: rooms[pin].gameMode,
            state: rooms[pin].state,
            activeCount: Object.keys(rooms[pin].players).length
        };
    });
    return summary;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Blooket architecture platform live on port ${PORT}`));
