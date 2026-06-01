const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const users = { 'HridaanD': { password: 'securePassword123', admin: true } };

const defaultQuestions = [
    { question: "What is the square root of 64?", answers: ["8", "6", "9", "4"], correct: 0 },
    { question: "Which core element keeps stars burning?", answers: ["Hydrogen", "Carbon", "Iron", "Gold"], correct: 0 }
];

app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (users[username]) return res.status(400).json({ error: 'Account already configured.' });
    users[username] = { password, admin: username === 'HridaanD' };
    res.json({ success: true, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (users[username] && users[username].password === password) {
        return res.json({ success: true, username });
    }
    res.status(401).json({ error: 'Bad verification parameters.' });
});

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('registerAdminFeed', () => {
        socket.join('admin-stream');
        socket.emit('adminTelemetryUpdate', getTelemetry());
    });

    socket.on('hostCreateRoom', ({ hostName, customPack }) => {
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        rooms[pin] = {
            pin,
            hostId: socket.id,
            hostName,
            state: 'LOBBY',
            players: {},
            questions: customPack || defaultQuestions,
            currentQuestionIndex: 0
        };
        currentRoom = pin;
        socket.join(pin);
        socket.emit('roomCreated', rooms[pin]);
        io.to('admin-stream').emit('adminTelemetryUpdate', getTelemetry());
    });

    socket.on('playerJoinRoom', ({ pin, playerName }) => {
        const room = rooms[pin];
        if (!room) return socket.emit('joinError', 'Room does not exist.');
        
        room.players[socket.id] = { name: playerName, score: 0 };
        currentRoom = pin;
        socket.join(pin);
        io.to(pin).emit('playerListUpdate', Object.values(room.players));
        io.to('admin-stream').emit('adminTelemetryUpdate', getTelemetry());
    });

    socket.on('startGame', () => {
        const room = rooms[currentRoom];
        if (room && room.hostId === socket.id) {
            room.state = 'PLAYING';
            sendQuestion(currentRoom);
            io.to('admin-stream').emit('adminTelemetryUpdate', getTelemetry());
        }
    });

    socket.on('submitAnswer', ({ answerIndex }) => {
        const room = rooms[currentRoom];
        if (!room || room.state !== 'PLAYING') return;

        const player = room.players[socket.id];
        const targetQ = room.questions[room.currentQuestionIndex];

        if (player && targetQ) {
            const isCorrect = answerIndex === targetQ.correct;
            if (isCorrect) player.score += 100;
            socket.emit('answerResult', { correct: isCorrect });

            // Automatically move down questions when players answer
            room.currentQuestionIndex++;
            setTimeout(() => sendQuestion(currentRoom), 2000);
        }
    });

    socket.on('disconnect', () => {
        if (rooms[currentRoom]) {
            if (rooms[currentRoom].hostId === socket.id) {
                io.to(currentRoom).emit('gameTerminated', 'Host severed thread.');
                delete rooms[currentRoom];
            } else {
                delete rooms[currentRoom].players[socket.id];
                io.to(currentRoom).emit('playerListUpdate', Object.values(rooms[currentRoom].players));
            }
            io.to('admin-stream').emit('adminTelemetryUpdate', getTelemetry());
        }
    });
});

function sendQuestion(pin) {
    const room = rooms[pin];
    if (!room) return;

    if (room.currentQuestionIndex >= room.questions.length) {
        room.state = 'ENDED';
        io.to(pin).emit('gameOver', Object.values(room.players).sort((a, b) => b.score - a.score));
        return;
    }

    const activeQ = room.questions[room.currentQuestionIndex];
    io.to(pin).emit('nextQuestion', {
        question: activeQ.question,
        answers: activeQ.answers,
        index: room.currentQuestionIndex
    });
}

function getTelemetry() {
    const data = {};
    Object.keys(rooms).forEach(p => {
        data[p] = { pin: p, hostName: rooms[p].hostName, state: rooms[p].state, activeCount: Object.keys(rooms[p].players).length };
    });
    return data;
}

server.listen(process.env.PORT || 3000);
