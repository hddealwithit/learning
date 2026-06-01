const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./quizverse.db", (err) => {
    if (err) {
        console.error("Database error:", err);
    } else {
        console.log("Connected to SQLite.");
    }
});

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roomCode TEXT UNIQUE NOT NULL,
            host TEXT NOT NULL,
            gameName TEXT NOT NULL,
            status TEXT DEFAULT 'waiting',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS gamePlayers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roomCode TEXT NOT NULL,
            username TEXT NOT NULL,
            joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            score INTEGER DEFAULT 0
        )
    `);

});

function isAdmin(username) {
    return username === "HridaanD";
}

/* ================= USERS ================= */

function createUser(username, password) {
    return new Promise((resolve, reject) => {

        db.run(
            `INSERT INTO users(username,password) VALUES(?,?)`,
            [username, password],
            function(err) {

                if (err) reject(err);
                else resolve(this.lastID);

            }
        );

    });
}

function getUser(username) {
    return new Promise((resolve, reject) => {

        db.get(
            `SELECT * FROM users WHERE username=?`,
            [username],
            (err, row) => {

                if (err) reject(err);
                else resolve(row);

            }
        );

    });
}

/* ================= GAMES ================= */

function createGame(roomCode, host, gameName) {
    return new Promise((resolve, reject) => {

        db.run(
            `INSERT INTO games(roomCode,host,gameName)
             VALUES(?,?,?)`,
            [roomCode, host, gameName],
            function(err) {

                if (err) reject(err);
                else resolve(this.lastID);

            }
        );

    });
}

function getGame(roomCode) {
    return new Promise((resolve, reject) => {

        db.get(
            `SELECT * FROM games WHERE roomCode=?`,
            [roomCode],
            (err, row) => {

                if (err) reject(err);
                else resolve(row);

            }
        );

    });
}

function getAllGames() {
    return new Promise((resolve, reject) => {

        db.all(
            `SELECT * FROM games ORDER BY id DESC`,
            [],
            (err, rows) => {

                if (err) reject(err);
                else resolve(rows);

            }
        );

    });
}

function joinGame(roomCode, username) {
    return new Promise((resolve, reject) => {

        db.run(
            `INSERT INTO gamePlayers(roomCode,username)
             VALUES(?,?)`,
            [roomCode, username],
            function(err) {

                if (err) reject(err);
                else resolve(true);

            }
        );

    });
}

function getPlayers(roomCode) {
    return new Promise((resolve, reject) => {

        db.all(
            `SELECT * FROM gamePlayers
             WHERE roomCode=?`,
            [roomCode],
            (err, rows) => {

                if (err) reject(err);
                else resolve(rows);

            }
        );

    });
}

/* ================= SCORES ================= */

function updateScore(username, score) {
    return new Promise((resolve, reject) => {

        db.run(
            `
            INSERT INTO scores(username,score)
            VALUES(?,?)
            ON CONFLICT(username)
            DO UPDATE SET score=excluded.score
            `,
            [username, score],
            function(err) {

                if (err) reject(err);
                else resolve(true);

            }
        );

    });
}

function getLeaderboard() {
    return new Promise((resolve, reject) => {

        db.all(
            `
            SELECT *
            FROM scores
            ORDER BY score DESC
            LIMIT 100
            `,
            [],
            (err, rows) => {

                if (err) reject(err);
                else resolve(rows);

            }
        );

    });
}

module.exports = {
    db,
    isAdmin,
    createUser,
    getUser,
    createGame,
    getGame,
    getAllGames,
    joinGame,
    getPlayers,
    updateScore,
    getLeaderboard
};
