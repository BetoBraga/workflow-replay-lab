const { DatabaseSync } = require('node:sqlite');

function openLedger(filename) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS records (
        document_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        page INTEGER NOT NULL CHECK (page > 0),
        span TEXT NOT NULL,
        PRIMARY KEY (document_id, revision)
      ) STRICT;
    `);
    const find = db.prepare('SELECT page, span FROM records WHERE document_id = ? AND revision = ?');
    const insert = db.prepare(`
      INSERT INTO records (document_id, revision, event_id, page, span)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (document_id, revision) DO NOTHING
    `);
    return {
      deliver(event, { afterCommit = () => {} } = {}) {
        const { documentId, revision, eventId, evidence } = event;
        if (typeof documentId !== 'string' || !documentId.trim() ||
            !Number.isSafeInteger(revision) || revision < 1 ||
            typeof eventId !== 'string' || !eventId.trim()) {
          throw new TypeError('Expected a document ID, positive revision, and event ID.');
        }
        if (event.parseStatus === 'unreadable' || !evidence ||
            !Number.isSafeInteger(evidence.page) || evidence.page < 1 ||
            typeof evidence.span !== 'string' || !evidence.span.trim()) {
          return find.get(documentId, revision) ? 'duplicate' : 'review';
        }

        // This statement is its own transaction. The database, not a preflight
        // lookup, arbitrates simultaneous writes from independent processes.
        if (insert.run(documentId, revision, eventId, evidence.page, evidence.span).changes === 0) {
          // The row already exists and this adapter never mutates stored evidence.
          const saved = find.get(documentId, revision);
          if (!saved) throw new Error('Conflicting ledger row was not found.');
          return saved.page === evidence.page && saved.span === evidence.span
            ? 'duplicate'
            : 'conflict';
        }
        afterCommit();
        return 'registered';
      },
      records() {
        return db.prepare('SELECT * FROM records ORDER BY document_id, revision').all();
      },
      close() { db.close(); },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openLedger };
