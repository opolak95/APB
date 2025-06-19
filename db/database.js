const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database('/tmp/eventHistory.db');


db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    created_by TEXT,
    created_at INTEGER,
    archived_at INTEGER,
    data TEXT
  )`);
});

function saveEvent(event) {
  const stmt = db.prepare(`INSERT INTO events (type, created_by, created_at, archived_at, data) VALUES (?, ?, ?, ?, ?)`);
  stmt.run(event.type, event.createdBy, event.createdAt, null, JSON.stringify(event.registrations));
  stmt.finalize();
}

function archiveEvent(event) {
  return new Promise((resolve, reject) => {
    const archivedAt = Date.now();
    db.run(
      `UPDATE events SET archived_at = ? WHERE created_at = ? AND type = ?`,
      [archivedAt, event.createdAt, event.type],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

module.exports = { saveEvent, archiveEvent };
