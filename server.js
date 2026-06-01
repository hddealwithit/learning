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

// Global State Engines
const activeRooms = {};
const userDatabase = {
    'HridaanD': { password: 'adminPassword123', tokens: 1000, blooks: ['Gold Astronaut'], isAdmin: true }
};

// Rich Question Bank
const questionPacks = {
    general: [
        { q: "What is the capital of France?", a: ["Paris", "London", "Berlin", "Rome"], c: 0 },
        { q: "Which planet is closest to the Sun?", a: ["Earth", "Mars", "Mercury", "Venus"], c: 2 },
        { q: "What is 7 multiplied by 8?", a: ["54", "56", "62", "64"], c: 1 },
        { q: "Which gas do plants absorb from the atmosphere?", a: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], c: 2 },
        { q: "How many bones are in an adult human body?", a: ["186", "206", "216", "296"], c: 1 }
    ],
    crypto: [
        { q: "What does Blockchain secure?", a: ["Data Records", "Physical Gold", "Internet Cables", "Software Licenses"], c: 0 },
        { q: "What was the first decentralized cryptocurrency?", a: ["Ethereum", "Litecoin", "Bitcoin", "Dogecoin"], c: 2 }
    ]
};

// REST APIs for Auth & User Saves
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, msg: "Missing fields" });
    if (userDatabase[username]) return res.status(400).json({ success: false, msg: "User exists" });

    userDatabase[username] = {
        password,
        tokens: 50,
        blooks: ['Default Blook'],
        isAdmin: username === 'HridaanD'
    };
    res.json({ success: true, username, isAdmin: userDatabase[username].isAdmin });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = userDatabase[username];
    if (!user || user.password !== password) {
        return res.status(401).json({ success: false, msg: "Invalid credentials" });
    }
    res.json({ success: true, username, isAdmin: user.isAdmin, tokens: user.tokens, blooks: user.blooks });
});

// Socket.io Real-time Game State Machine
io.on('connection', (socket) => {
    let trackingRoom = null;
    let registeredIdentity = null;

    // Secure Admin Stream Verification for HridaanD
    socket.on('requestAdminTelemetry', ({ username }) => {
        if (username === 'HridaanD') {
            socket.join('admin-telemetry-stream');
            socket.emit('telemetryPacket', compileGlobalTelemetry());
        }
    });

    // Room Initialization (Host side)
    socket.on('initiateRoom', ({ hostName, selectedPack, gameMode }) => {
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        
        activeRooms[pin] = {
            pin,
            hostId: socket.id,
            hostName,
            pack: selectedPack || 'general',
            mode: gameMode || 'Classic',
            status: 'LOBBY', // LOBBY, RUNNING, REVEAL, LEADERBOARD
            players: {},
            questionIndex: 0,
            timer: 0,
            timerInterval: null
        };

        trackingRoom = pin;
        registeredIdentity = hostName;
        socket.join(pin);
        
        socket.emit('roomCreated', activeRooms[pin]);
        io.to('admin-telemetry-stream').emit('telemetryPacket', compileGlobalTelemetry());
    });

    // Player Client Joining
    socket.on('joinRoomRequest', ({ pin, playerName }) => {
        const room = activeRooms[pin];
        if (!room) return socket.emit('joinError', 'Room does not exist!');
        if (room.status !== 'LOBBY') return socket.emit('joinError', 'Game already in progress!');
        
        room.players[socket.id] = {
            name: playerName,
            score: 0,
            gold: 100,
            crypto: 0,
            multiplier: 1.0,
            lastAnswerCorrect: false
        };

        trackingRoom = pin;
        registeredIdentity = playerName;
        socket.join(pin);

        io.to(pin).emit('lobbyUpdate', Object.values(room.players));
        io.to('admin-telemetry-stream').emit('telemetryPacket', compileGlobalTelemetry());
    });

    // Live Game Engine Loop Execution
    socket.on('executeGameStart', () => {
        const room = activeRooms[trackingRoom];
        if (room && room.hostId === socket.id) {
            room.status = 'RUNNING';
            runNextQuestionCycle(trackingRoom);
            io.to('admin-telemetry-stream').emit('telemetryPacket', compileGlobalTelemetry());
        }
    });

    // Live Evaluation Engine
    socket.on('submitClientAnswer', ({ answerIndex }) => {
        const room = activeRooms[trackingRoom];
        if (!room || room.status !== 'RUNNING') return;

        const player = room.players[socket.id];
        const pack = questionPacks[room.pack];
        const currentQ = pack[room.questionIndex];

        if (player && currentQ) {
            if (parseInt(answerIndex) === currentQ.c) {
                const baseReward = 100;
                player.score += Math.floor(baseReward * player.multiplier);
                
                // Mode specific modifiers
                if (room.mode === 'GoldQuest') {
                    const stolenGold = Math.floor(Math.random() * 80) + 20;
                    player.gold += stolenGold;
                } else if (room.mode === 'CryptoHack') {
                    player.crypto += Math.floor(Math.random() * 15) + 5;
                }
                
                player.lastAnswerCorrect = true;
                socket.emit('evaluationResult', { correct: true, score: player.score, gold: player.gold, crypto: player.crypto });
            } else {
                player.lastAnswerCorrect = false;
                socket.emit('evaluationResult', { correct: false, score: player.score, gold: player.gold, crypto: player.crypto });
            }
            io.to(room.hostId).emit('hostLeaderboardUpdate', Object.values(room.players));
        }
    });

    socket.on('disconnect', () => {
        if (activeRooms[trackingRoom]) {
            if (activeRooms[trackingRoom].hostId === socket.id) {
                io.to(trackingRoom).emit('sessionTerminated', 'The Host left the session.');
                clearInterval(activeRooms[trackingRoom].timerInterval);
                delete activeRooms[trackingRoom];
            } else if (activeRooms[trackingRoom].players[socket.id]) {
                delete activeRooms[trackingRoom].players[socket.id];
                io.to(trackingRoom).emit('lobbyUpdate', Object.values(activeRooms[trackingRoom].players));
            }
            io.to('admin-telemetry-stream').emit('telemetryPacket', compileGlobalTelemetry());
        }
    });
});

function runNextQuestionCycle(pin) {
    const room = activeRooms[pin];
    if (!room) return;

    const pack = questionPacks[room.pack];
    if (room.questionIndex >= pack.length) {
        room.status = 'LEADERBOARD';
        const finalStandings = Object.values(room.players).sort((a, b) => b.score - a.score);
        io.to(pin).emit('gameFinished', finalStandings);
        return;
    }

    const currentQuestionData = pack[room.questionIndex];
    io.to(pin).emit('deliverQuestion', {
        question: currentQuestionData.q,
        answers: currentQuestionData.a,
        index: room.questionIndex
    });

    room.timer = 15; // 15 seconds per question
    clearInterval(room.timerInterval);
    
    room.timerInterval = setInterval(() => {
        room.timer--;
        io.to(pin).emit('timerTick', room.timer);
        
        if (room.timer <= 0) {
            clearInterval(room.timerInterval);
            room.questionIndex++;
            runNextQuestionCycle(pin);
        }
    }, 1000);
}

function compileGlobalTelemetry() {
    const telemetry = {};
    Object.keys(activeRooms).forEach(pin => {
        telemetry[pin] = {
            pin: activeRooms[pin].pin,
            hostName: activeRooms[pin].hostName,
            mode: activeRooms[pin].mode,
            status: activeRooms[pin].status,
            clientCount: Object.keys(activeRooms[pin].players).length
        };
    });
    return telemetry;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Blooket Remake Core Cluster Live on Port ${PORT}`));
