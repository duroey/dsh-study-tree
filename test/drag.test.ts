import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG } from '../src/config.ts';
import { dragActivated, scrollVelocity, siblingDrop } from '../src/drag.ts';
import type { StudyNode } from '../src/tree.ts';

const source: StudyNode = { id: 'sampling', parentId: 'sound', title: '采样', createdAt: 1 };
const sibling: StudyNode = { id: 'microphone', parentId: 'sound', title: '麦克风', createdAt: 2 };

test('a short deliberate row movement starts dragging while click jitter remains a click', () => {
  assert.equal(dragActivated({ x: 100, y: 200 }, { x: 103, y: 200 }), false);
  assert.equal(dragActivated({ x: 100, y: 200 }, { x: 100 + CONFIG.dragThresholdPx, y: 200 }), true);
  assert.equal(dragActivated({ x: 100, y: 200 }, { x: 103, y: 203 }), true);
});

test('the complete row is a sibling sorting target with no inside zone', () => {
  for (const y of [200, 208, 216]) {
    assert.deepEqual(siblingDrop(source, sibling, y, { top: 200, height: 35 }), { id: sibling.id, position: 'before' });
  }
  for (const y of [218, 226, 234]) {
    assert.deepEqual(siblingDrop(source, sibling, y, { top: 200, height: 35 }), { id: sibling.id, position: 'after' });
  }
});

test('equal indentation under another parent, descendants, self and missing rows cannot become targets', () => {
  const rect = { top: 200, height: 35 };
  assert.equal(siblingDrop(source, { ...sibling, parentId: 'other-topic' }, 220, rect), undefined);
  assert.equal(siblingDrop(source, { ...sibling, parentId: source.id }, 220, rect), undefined);
  assert.equal(siblingDrop(source, source, 220, rect), undefined);
  assert.equal(siblingDrop(source, undefined, 220, rect), undefined);
  assert.deepEqual(siblingDrop({ ...source, parentId: null }, { ...sibling, parentId: null }, 220, rect), { id: sibling.id, position: 'after' });
});

test('edge scrolling is bounded, increases toward the edge and stops in the center or outside', () => {
  assert.equal(scrollVelocity(400, 100, 700), 0);
  assert.equal(scrollVelocity(99, 100, 700), 0);
  assert.equal(scrollVelocity(701, 100, 700), 0);
  assert.equal(scrollVelocity(100, 100, 700), -CONFIG.dragScrollPxPerSecond);
  assert.equal(scrollVelocity(700, 100, 700), CONFIG.dragScrollPxPerSecond);
  assert.ok(scrollVelocity(680, 100, 700) > scrollVelocity(670, 100, 700));
});
