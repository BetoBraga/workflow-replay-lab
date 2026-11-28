const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { openLedger } = require('../sqlite-replay.cjs');

const fixture = {
  documentId: 'DOC-042', revision: 1, eventId: 'evt-1',
  evidence: { page: 2, span: 'Synthetic evidence' },
};

function database(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'replay-sqlite-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'ledger.sqlite');
}

function worker(file, event, crash = false) {
  const source = `
    const [modulePath, file, json, crash] = process.argv.slice(1);
    const db = require(modulePath).openLedger(file);
    process.stdin.once('data', () => {
      console.log(db.deliver(JSON.parse(json), {
        afterCommit() { if (crash === 'true') process.exit(23); },
      }));
      db.close();
    });
    console.log('ready');
  `;
  const child = spawn(process.execPath, [
    '-e', source, require.resolve('../sqlite-replay.cjs'), file, JSON.stringify(event), String(crash),
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  let markReady, failReady, finish, fail;
  const ready = new Promise((resolve, reject) => { markReady = resolve; failReady = reject; });
  const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  // Attach immediately so a startup failure isn't an unhandled rejection
  // before the caller has reached the delivery barrier.
  done.catch(() => {});
  child.stdin.on('error', fail);
  child.stdout.on('data', chunk => {
    stdout += chunk;
    if (stdout.includes('ready')) markReady();
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => { failReady(error); fail(error); });
  child.on('close', code => {
    failReady(new Error(`Worker exited before the barrier (${code}): ${stderr}`));
    finish({ code, decision: stdout.trim().split(/\r?\n/)[1], stderr });
  });
  return { ready, done, start: () => child.stdin.end('go'), stop: () => child.kill() };
}

test('independent writers released together yield one row; a new revision adds another', { timeout: 15000 }, async t => {
  const file = database(t);
  const db = openLedger(file);
  try {
    const workers = [worker(file, fixture), worker(file, { ...fixture, eventId: 'evt-2' })];
    try {
      await Promise.all(workers.map(w => w.ready));
      workers.forEach(w => w.start());
      const results = await Promise.all(workers.map(w => w.done));
      results.forEach(result => assert.equal(result.code, 0, result.stderr));
      assert.deepEqual(results.map(r => r.decision).sort(), ['duplicate', 'registered']);
    } finally {
      workers.forEach(w => w.stop());
    }
    assert.equal(db.records().length, 1);
    const firstId = db.records()[0].event_id;
    assert.equal(db.deliver({ ...fixture, revision: 2, eventId: 'evt-3' }), 'registered');
    assert.deepEqual(db.records().map(r => [r.revision, r.event_id]), [[1, firstId], [2, 'evt-3']]);
    assert.equal(db.deliver({ ...fixture, revision: 3, evidence: undefined }), 'review');
    assert.equal(db.records().length, 2);
  } finally {
    db.close();
  }
});

test('process exits after commit without ACK; another process safely retries', { timeout: 15000 }, async t => {
  const file = database(t);
  const first = worker(file, fixture, true);
  let retry;
  try {
    await first.ready;
    first.start();
    const lost = await first.done;
    assert.equal(lost.code, 23, lost.stderr);
    assert.equal(lost.decision, undefined);

    retry = worker(file, { ...fixture, eventId: 'evt-retry' });
    await retry.ready;
    retry.start();
    const replayed = await retry.done;
    assert.equal(replayed.code, 0, replayed.stderr);
    assert.equal(replayed.decision, 'duplicate');
    const db = openLedger(file);
    try {
      assert.deepEqual(db.records().map(r => r.event_id), ['evt-1']);
    } finally {
      db.close();
    }
  } finally {
    first.stop();
    retry?.stop();
  }
});

test('a retry with changed valid evidence is a conflict and never overwrites the first row', t => {
  const db = openLedger(database(t));
  try {
    assert.equal(db.deliver(fixture), 'registered');
    const retry = { ...fixture, eventId: 'evt-retry' };
    assert.equal(db.deliver(retry), 'duplicate');
    assert.equal(db.deliver({ ...retry, evidence: { ...fixture.evidence, page: 3 } }), 'conflict');
    assert.equal(db.deliver({ ...retry, evidence: { ...fixture.evidence, span: 'Changed evidence' } }), 'conflict');
    assert.deepEqual(db.records().map(r => [r.event_id, r.page, r.span]), [
      [fixture.eventId, fixture.evidence.page, fixture.evidence.span],
    ]);
  } finally {
    db.close();
  }
});
