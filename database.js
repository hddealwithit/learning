const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./quizverse.db", (err) => {
    if (err) {
        console.error("Database connection failed:", err);
    } else {
        console.log("SQLite connected.");
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
            username TEXT NOT NULL,
            score INTEGER DEFAULT 0,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

});

function isAdmin(username) {
    return username === "HridaanD";
}

module.exports = {
    db,
    isAdmin
};
