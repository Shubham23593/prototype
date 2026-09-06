import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseFirmsCsv, makeObservation } from '../server/src/firms';
import { Store } from '../server/src/store';
import { app, csvCell } from '../server/src/index';

const realCsv = gunzipSync(awaitFile()).toString('utf8');
function awaitFile() { return require('node:fs').readFileSync(path.resolve('data/replay/india-2025-q1.csv.gz')); }
const firstRows = realCsv.split('\n').slice(0, 6).join('\n');

test('genuine historical CSV parses with source dates, stable IDs and no fake predictions', () => {
  const parsed = parseFirmsCsv(firstRows, 'archive');
  assert.equal(parsed.observations.length, 5);
  assert.equal(parsed.rejected, 0);
  assert.equal(parsed.observations[0].event.mode, 'archive');
  assert.match(parsed.observations[0].event.acquiredAt, /^2025-03-25T/);
  assert.equal(parsed.observations[0].event.prediction.score, null);
  assert.equal(parsed.observations[0].event.prediction.classKey, 'unclassified');
  assert.equal(parseFirmsCsv(firstRows, 'live').observations[0].event.id, parsed.observations[0].event.id);
});

test('archive replay exactly matches the pinned manifest', async () => {
  const bytes = await readFile('data/replay/india-2025-q1.csv.gz');
  const manifest = JSON.parse(await readFile('data/replay/manifest.json', 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.replay_sha256);
  const parsed = parseFirmsCsv(realCsv, 'archive');
  assert.equal(parsed.observations.length, manifest.rows);
  assert.equal(parsed.duplicates, 0);
  assert.equal(parsed.rejected, 0);
});

test('NASA API error pages are not misread as datasets', () => {
  assert.throws(() => parseFirmsCsv('Invalid MAP_KEY.', 'live'), /valid FIRMS CSV/);
  assert.throws(() => parseFirmsCsv('<html>Please sign in</html>', 'live'), /valid FIRMS CSV/);
});

test('rejects impossible UTC time, coordinates, MODIS and negative radiative power', () => {
  const raw = parseFirmsCsv(firstRows, 'archive').observations[0].raw;
  assert.equal(makeObservation({...raw, latitude: 1000}, 'live'), null);
  assert.equal(makeObservation({...raw, acq_time: '2460'}, 'live'), null);
  assert.equal(makeObservation({...raw, acq_date: '2025-02-30'}, 'live'), null);
  assert.equal(makeObservation({...raw, frp: -3}, 'live'), null);
  assert.equal(makeObservation({...raw, instrument: 'MODIS'}, 'live'), null);
});

test('repeat source pixels are deduplicated rather than counted as extra incidents', () => {
  const lines = firstRows.split('\n');
  const parsed = parseFirmsCsv([...lines, lines[1]].join('\n'), 'archive');
  assert.equal(parsed.duplicates, 1);
  assert.equal(parsed.observations.length, 5);
});

test('spreadsheet formula injection is escaped while real numeric coordinates remain numeric', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.com")').startsWith('"\''), true);
  assert.equal(csvCell(-72.5), '-72.5');
  assert.equal(csvCell('source, with comma'), '"source, with comma"');
});

test('analyst notes and a genuine observation snapshot survive a local-store restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'thermoscan-test-'));
  const previous = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  try {
    const store = new Store(dir); await store.initialize();
    const event = parseFirmsCsv(firstRows, 'archive').observations[0].event;
    await store.setReview(event.id, 'watching', 'Test-only analyst note on a real source pixel', event);
    const restarted = new Store(dir); await restarted.initialize();
    assert.equal(restarted.getReview(event.id)?.state, 'watching');
    assert.equal(restarted.snapshots.get(event.id)?.acquiredAt, event.acquiredAt);
    assert.equal(restarted.status.status, 'local');
    await restarted.setReview(event.id, 'clear');
    const cleared = new Store(dir); await cleared.initialize();
    assert.equal(cleared.getReview(event.id), null);
    assert.equal(cleared.snapshots.has(event.id), false);
  } finally { if(previous)process.env.MONGODB_URI=previous; await rm(dir,{recursive:true,force:true}); }
});

test('API validates unknown regions, invalid dates and unbounded windows before querying data', async () => {
  const server = app.listen(0, '0.0.0.0');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const port=(server.address() as {port:number}).port;
  try {
    for(const query of ['region=unknown','from=2025-02-30&to=2025-03-02','from=2025-01-01&to=2025-12-31','window=999d','mode=simulated']) {
      const response=await fetch(`http://127.0.0.1:${port}/api/overview?${query}`);
      assert.equal(response.status,400,query);
      assert.equal((await response.json()).error,'Invalid request');
    }
  } finally { server.closeAllConnections(); await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});

test('API overview supports new industrial and non-industrial classKey filters', async () => {
  const server = app.listen(0, '0.0.0.0');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const port=(server.address() as {port:number}).port;
  try {
    for (const validClass of ['industrial', 'major_industrial', 'normal_industrial', 'gas_flare', 'persistent', 'forest', 'agriculture', 'waste', 'offshore', 'uncertain']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/overview?region=india&classKey=${validClass}&mode=archive`);
      assert.equal(response.status, 200, `Expected 200 for valid classKey ${validClass}`);
      const data = await response.json() as { distribution: Array<{ key: string }> };
      assert.ok(Array.isArray(data.distribution));
      assert.ok(data.distribution.some(d => d.key === validClass));
    }
  } finally { server.closeAllConnections(); await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});
