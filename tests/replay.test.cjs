const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../index.html', 'file://' + __filename), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const {run, fixtures} = vm.runInNewContext(scripts[0] + '\n;({run, fixtures})');

for (const [name, decision, writes, reviews] of [
  ['valid', 'registered', 1, 0],
  ['duplicate', 'duplicate', 0, 0],
  ['missing', 'review', 0, 1],
  ['unreadable', 'review', 0, 1],
]) {
  test(name, () => {
    const result = run(name);
    assert.equal(result.result, decision);
    assert.equal(result.writes, writes);
    assert.equal(result.reviews, reviews);
    assert.match(html, new RegExp('data-scenario="' + name + '"'));
  });
}

test('duplicate replay retains original despite a different event id', () => {
  assert.equal(run('valid').key, run('duplicate').key);
  assert.notEqual(fixtures.valid.eventId, fixtures.duplicate.eventId);
  assert.equal(run('duplicate').before, run('duplicate').after);
});

test('parse failure is distinguishable from missing evidence', () => {
  assert.equal(run('unreadable').trace[2][2], 'Unreadable');
  assert.equal(run('missing').trace[2][2], 'Missing');
});

test('both scripts parse; no external assets or automatic requests', () => {
  assert.equal(scripts.length, 2);
  scripts.forEach(source => new vm.Script(source));
  assert.doesNotMatch(html, /<(script|img)\b[^>]*\bsrc=|<link\b|\bfetch\s*\(/);
});
