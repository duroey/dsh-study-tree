import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AtomicTreeStore } from '../src/persistence.ts';
import { attachSession, emptyTree } from '../src/tree.ts';

test('persisted tree survives a fresh store instance and stale writes are refused', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'study-tree-test-'));
  try {
    const file = join(directory, 'tree.json');
    const first = new AtomicTreeStore(file);
    assert.deepEqual(await first.read(), { revision: 0, tree: emptyTree() });
    const tree = attachSession(emptyTree(), { id: 'root', title: '声音采集', parentId: null, createdAt: 1 });
    const saved = await first.write(tree, 0);
    assert.equal(saved.revision, 1);
    assert.deepEqual(await new AtomicTreeStore(file).read(), saved);
    await assert.rejects(first.write(emptyTree(), 0), /conflict/i);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), saved);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('concurrent writes with the same revision produce one accepted update', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'study-tree-test-'));
  try {
    const store = new AtomicTreeStore(join(directory, 'tree.json'));
    const results = await Promise.allSettled([store.write(emptyTree(), 0), store.write(emptyTree(), 0)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await store.read()).revision, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('independent store instances cannot overwrite the same revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'study-tree-test-'));
  try {
    const file = join(directory, 'tree.json');
    const results = await Promise.allSettled([
      new AtomicTreeStore(file).write(emptyTree(), 0), new AtomicTreeStore(file).write(emptyTree(), 0),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await new AtomicTreeStore(file).read()).revision, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt persistence fails visibly and is never silently reset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'study-tree-test-'));
  try {
    const file = join(directory, 'tree.json');
    await writeFile(file, '{broken', 'utf8');
    await assert.rejects(new AtomicTreeStore(file).read(), /JSON|parse|Unexpected|property/i);
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
