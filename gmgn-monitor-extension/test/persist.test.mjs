import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
createContext(sandbox);
runInContext(readFileSync(new URL('../src/persist.js', import.meta.url), 'utf8'), sandbox);
const api = sandbox.GmgnPersist;

const file = { savedAt: 10, settings: { botToken: 'x' }, pool: [], alertLog: [], seen: {} };

test('empty local storage restores from the data file', () => {
  assert.equal(api.localEmpty(null), true);
  assert.equal(api.localEmpty({ savedAt: 0, pool: [], seen: {}, alertLog: [], cursor: { chain: 'sol', scanId: 0 } }), true);
  assert.equal(api.shouldRestore(null, file), true);
  assert.equal(api.shouldRestore({ pool: [], seen: {}, alertLog: [] }, file), true);
});

test('a newer file restores and an older file does not', () => {
  assert.equal(api.shouldRestore({ savedAt: 5, settings: { botToken: 'y' } }, file), true);
  assert.equal(api.shouldRestore({ savedAt: 10, settings: { botToken: 'y' } }, file), false);
  assert.equal(api.shouldRestore({ savedAt: 20, settings: { botToken: 'y' }, pool: [{}] }, file), false);
  assert.equal(api.shouldRestore({ savedAt: 0, settings: { botToken: 'y' } }, null), false);
});

test('pool, alert log, seen, and cursor count as stored data', () => {
  assert.equal(api.localEmpty({ pool: [{}] }), false);
  assert.equal(api.localEmpty({ alertLog: [{}] }), false);
  assert.equal(api.localEmpty({ seen: { 'sol:abc': 'skip' } }), false);
  assert.equal(api.localEmpty({ alertsSent: 2 }), false);
  assert.equal(api.localEmpty({ rwaIndex: { fetchedAt: 1 } }), false);
  assert.equal(api.localEmpty({ cursor: { running: true } }), false);
});
