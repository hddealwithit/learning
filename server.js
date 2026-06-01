const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------
// DATABASE SCHEMAS & MODELS (Persistent Data Layer)
// ---------------------------------------------------------
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isBanned: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const QuizSchema = new mongoose.Schema({
    title: { type: String, required: true },
    creator: { type: String, required: true },
    questions: [{
        question: String,
        answers: [String],
        correctIndex: Number
    }]
});
const Quiz = mongoose.model('Quiz', QuizSchema);

// In-Memory Live Game States
const activeRooms = {};

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || 'FALLBACK_SECRET', (err, user) => {
        if (err) return res.status(403).json({ error: 'Session invalid' });
        req.user = user;
        next();
    });
};

// ---------------------------------------------------------
// HTTP API ROUTING (Authentication & Quizzes)
// ---------------------------------------------------------
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
        
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ error: 'Username taken' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: 'User not found' });
        if (user.isBanned) return res.status(403).json({ error: 'This account has been terminated.' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ error: 'Incorrect password' });

        const token = jwt.sign({ username: user.username }, process.env.ACCESS_TOKEN_SECRET || 'FALLBACK_SECRET');
        res.json({ success: true, token, username: user.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Quiz Operations
app.post('/api/quizzes', authenticateToken, async (req, res) => {
    try {
        const { title, questions } = req.body;
        const newQuiz = new Quiz({ title, creator: req.user.username, questions });
        await newQuiz.save();
        res.json({ success: true, quiz: newQuiz });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/quizzes', authenticateToken, async (req, res) => {
    const quizzes = await Quiz.find({});
    res.json(quizzes);
});

// ---------------------------------------------------------
// REAL-TIME MULTIPLAYER ORCHESTRATION & ADMIN CONTROL
// ---------------------------------------------------------
function pushTelemetryToAdmin() {
    const dataSummary = Object.keys(activeRooms).map(pin => ({
        pin,
        host: activeRooms[pin].host,
        title: activeRooms[pin].title,
        mode: activeRooms[pin].mode,
        playerCount: Object.keys(activeRooms[pin].players).length,
        state: activeRooms[pin].state
    }));
    io.to('admin-stream').emit('telemetryUpdate', dataSummary);
}

io.on('connection', (socket) => {
    let internalPin = null;

    // Secure Admin Socket Connection Request
    socket.on('requestAdminAuth', ({ username }) => {
        if (username === 'HridaanD') {
            socket.join('admin-stream');
            pushTelemetryToAdmin();
        }
    });

    // Terminate User Account (HridaanD System Command Override)
    socket.on('adminActionBanUser', async ({ adminUser, targetUser }) => {
        if (adminUser !== 'HridaanD') return;
        await User.findOneAndUpdate({ username: targetUser }, { isBanned: true });
        
        // Boot player out if they are currently online in an active game
        Object.keys(activeRooms).forEach(pin => {
            Object.keys(activeRooms[pin].players).forEach(sId => {
                if (activeRooms[pin].players[sId].name === targetUser) {
                    io.to(sId).emit('forceDisconnectBoot', 'Your account has been terminated.');
                }
            });
        });
        socket.emit('adminActionSuccess', `Account ${targetUser} successfully terminated.`);
    });

    // Close Game Instance (HridaanD System Command Override)
    socket.on('adminActionKillGame', ({ adminUser, pin }) => {
        if (adminUser !== 'HridaanD') return;
        if (activeRooms[pin]) {
            io.to(pin).emit('gameTerminated', 'This room was terminated by an administrator.');
            delete activeRooms[pin];
            pushTelemetryToAdmin();
        }
    });

    // Host establishes a room instance using a custom quiz
    socket.on('hostCreateRoom', async ({ hostName, quizId, gameMode }) => {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return socket.emit('errorNotification', 'Selected Quiz not found');

        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        activeRooms[pin] = {
            host: hostName,
            hostSocketId: socket.id,
            title: quiz.title,
            questions: quiz.questions,
            mode: gameMode,
            state: 'LOBBY',
            players: {},
            currentQuestionIndex: 0
        };

        internalPin = pin;
        socket.join(pin);
        socket.emit('roomCreatedSuccess', activeRooms[pin]);
        pushTelemetryToAdmin();
    });

    // Client join request
    socket.on('playerJoinRoom', ({ pin, playerName }) => {
        const room = activeRooms[pin];
        if (!room) return socket.emit('errorNotification', 'Game Room not found.');
        if (room.state !== 'LOBBY') return socket.emit('errorNotification', 'Game already in progress.');

        room.players[socket.id] = { name: playerName, score: 0, resources: 100 };
        internalPin = pin;
        socket.join(pin);

        io.to(pin).emit('lobbyPlayerUpdate', Object.values(room.players));
        pushTelemetryToAdmin();
    });

    // Host initiates gameplay sequence
    socket.on('hostStartGame', () => {
        const room = activeRooms[internalPin];
        if (room && room.hostSocketId === socket.id) {
            room.state = 'PLAYING';
            sendQuestionCycle(internalPin);
            pushTelemetryToAdmin();
        }
    });

    // Process submitted choices
    socket.on('submitClientAnswer', ({ answerIndex }) => {
        const room = activeRooms[internalPin];
        if (!room || room.state !== 'PLAYING') return;

        const pData = room.players[socket.id];
        const qData = room.questions[room.currentQuestionIndex];

        if (pData && qData) {
            const isCorrect = answerIndex === qData.correctIndex;
            if (isCorrect) {
                pData.score += 100;
                pData.resources += Math.floor(Math.random() * 60) + 15; // Dynamic resource gain
            }
            socket.emit('answerFeedback', { isCorrect, currentResources: pData.resources });
            io.to(room.hostSocketId).emit('hostScoreboardUpdate', Object.values(room.players));
        }
    });

    socket.on('disconnect', () => {
        if (activeRooms[internalPin]) {
            const room = activeRooms[internalPin];
            if (room.hostSocketId === socket.id) {
                io.to(internalPin).emit('gameTerminated', 'The game host disconnected.');
                delete activeRooms[internalPin];
            } else if (room.players[socket.id]) {
                delete room.players[socket.id];
                io.to(internalPin).emit('lobbyPlayerUpdate', Object.values(room.players));
            }
            pushTelemetryToAdmin();
        }
    });
});

function sendQuestionCycle(pin) {
    const room = activeRooms[pin];
    if (!room) return;

    if (room.currentQuestionIndex >= room.questions.length) {
        room.state = 'FINISHED';
        io.to(pin).emit('gameFinishedSummary', Object.values(room.players).sort((a, b) => b.score - a.score));
        return;
    }

    const currentQ = room.questions[room.currentQuestionIndex];
    io.to(pin).emit('nextGameQuestion', {
        question: currentQ.question,
        answers: currentQ.answers,
        index: room.currentQuestionIndex
    });
}

// DB Connection + Server Spin-Up
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/blooketRemake";
mongoose.connect(MONGO_URI)
    .then(() => console.log('Database Cluster Online.'))
    .catch((err) => console.error('Database connection failed:', err));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server executing safely on port ${PORT}`));
