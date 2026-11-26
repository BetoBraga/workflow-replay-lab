const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ledger = require('../replay-ledger.js');

const html = fs.readFileSync(new URL('../index.html', 'file://' + __filename), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const { fixtures, run } = vm.runInNewContext(
  scripts[0] + '\n;({fixtures, run})',
  { ReplayLedger: ledger, window: { localStorage: null } },
);

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) { assert.equal(key, ledger.STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, ledger.STORAGE_KEY); value = next; },
    removeItem(key) { assert.equal(key, ledger.STORAGE_KEY); value = null; },
  };
}

function fileStorage(directory) {
  const file = path.join(directory, 'ledger.json');
  return {
    getItem() { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; },
    setItem(_key, value) { fs.writeFileSync(file, value, 'utf8'); },
  };
}

for (const [name, decision, writes, reviews] of [
  ['valid', 'registered', 1, 0],
  ['duplicate', 'registered', 1, 0],
  ['missing', 'review', 0, 1],
  ['unreadable', 'review', 0, 1],
  ['recovery', 'registered', 1, 0],
]) {
  test(name + ' event decision', () => {
    const result = run(name, memoryStorage());
    assert.equal(result.result, decision);
    assert.equal(result.writes, writes);
    assert.equal(result.reviews, reviews);
    assert.match(html, new RegExp('data-scenario="' + name + '"'));
  });
}

test('a different delivery ID cannot write the same document revision twice', () => {
  const storage = memoryStorage();
  assert.equal(run('valid', storage).result, 'registered');
  const replay = run('duplicate', storage);
  assert.equal(ledger.businessKey(fixtures.valid), ledger.businessKey(fixtures.duplicate));
  assert.notEqual(fixtures.valid.eventId, fixtures.duplicate.eventId);
  assert.equal(replay.result, 'duplicate');
  assert.equal(replay.writes, 0);
  assert.equal(replay.records[0].eventId, fixtures.valid.eventId);
});

test('saved record survives a process restart and the replay is a no-op', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-ledger-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(run('valid', fileStorage(directory)).result, 'registered');
  const afterRestart = run('duplicate', fileStorage(directory));
  assert.equal(afterRestart.result, 'duplicate');
  assert.equal(afterRestart.writes, 0);
  assert.equal(afterRestart.records.length, 1);
});

test('a committed write with a lost acknowledgement recovers by replay', () => {
  const storage = memoryStorage();
  assert.throws(
    () => ledger.processEvent(storage, fixtures.interrupted, { interruptAfterCommit: true }),
    ledger.InterruptedAfterCommit,
  );
  const retry = ledger.processEvent(storage, fixtures.recovery);
  assert.equal(retry.result, 'duplicate');
  assert.equal(retry.writes, 0);
  assert.equal(retry.records.length, 1);
});

test('unreadable ledger data fails closed and is not overwritten', () => {
  const storage = memoryStorage('{not-json');
  assert.throws(() => ledger.processEvent(storage, fixtures.valid), /left untouched/);
  assert.equal(storage.getItem(ledger.STORAGE_KEY), '{not-json');
});

test('both inline scripts parse and no remote assets or automatic requests are used', () => {
  assert.equal(scripts.length, 2);
  scripts.forEach(source => new vm.Script(source));
  assert.match(html, /<script src="replay-ledger\.js"><\/script>/);
  assert.doesNotMatch(html, /<img\b[^>]*\bsrc="https?:|<link\b[^>]*href="https?:|\bfetch\s*\(/);
});
