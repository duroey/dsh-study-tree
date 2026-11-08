import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_TREE_NODES,
  ancestors,
  attachSession,
  detachBranch,
  emptyTree,
  moveNode,
  parseTree,
  relocateBranch,
  visibleRows,
  type StudyNode,
  type StudyTree,
} from '../src/tree.ts';

/** Creates a compact session fixture with an explicit navigation parent. */
function node(id: string, parentId: string | null = null): StudyNode {
  return { id, parentId, title: id, createdAt: 1 };
}

/** Creates the sound-capture learning tree and an independent root. */
function learningTree(): StudyTree {
  return {
    schemaVersion: 1,
    nodes: [
      node('声音采集'),
      node('采样', '声音采集'),
      node('频率', '采样'),
      node('麦克风', '声音采集'),
      node('其他主题'),
    ],
  };
}

test('new trees are independent and attach one real session per node', () => {
  const before = emptyTree();
  const after = attachSession(before, node('声音采集'));
  assert.deepEqual(before, { schemaVersion: 1, nodes: [] });
  assert.deepEqual(after.nodes.map((item) => item.id), ['声音采集']);
  assert.notEqual(emptyTree().nodes, emptyTree().nodes);
});

test('whole-session provenance survives moves and persistence without pretending to be selected text', () => {
  const origin = { sessionId: '声音采集', seq: 12, scrollTop: 25 };
  const tree = attachSession(learningTree(), { ...node('新想法', '声音采集'), origin });
  const moved = relocateBranch(tree, '新想法', { position: 'before', id: '采样' });
  const restored = parseTree(JSON.parse(JSON.stringify(moved)));
  assert.deepEqual(restored.nodes.find((item) => item.id === '新想法')?.origin, origin);
  assert.equal(restored.nodes.find((item) => item.id === '新想法')?.source, undefined);
  assert.notEqual(restored.nodes.find((item) => item.id === '新想法')?.origin, origin);
  for (const invalid of [{ sessionId: '' }, { sessionId: '声音采集', seq: -1 }, { sessionId: '声音采集', scrollTop: -1 }]) {
    assert.throws(() => parseTree({ schemaVersion: 1, nodes: [{ ...node('invalid'), origin: invalid }] }), /Invalid/);
  }
});

test('updating a session retains its order and omitted source metadata', () => {
  const source = { sessionId: '声音采集', quote: '采样', seq: 8 };
  const tree = attachSession(learningTree(), {
    ...node('采样', '声音采集'),
    source,
    collapsed: true,
  });
  const updated = attachSession(tree, {
    ...node('采样', '声音采集'),
    title: '理解采样',
    source: undefined,
  });
  assert.equal(updated.nodes.length, tree.nodes.length);
  assert.equal(updated.nodes[1]?.title, '理解采样');
  assert.deepEqual(updated.nodes[1]?.source, source);
  assert.equal(updated.nodes[1]?.collapsed, true);
  assert.equal(tree.nodes[1]?.title, '采样');
});

test('recursive navigation produces the full root-to-current path', () => {
  assert.deepEqual(
    ancestors(learningTree(), '频率').map((item) => item.id),
    ['声音采集', '采样', '频率'],
  );
});

test('collapsing a parent hides its subtree without losing data or other roots', () => {
  const tree = attachSession(learningTree(), {
    ...node('采样', '声音采集'),
    collapsed: true,
  });
  assert.deepEqual(
    visibleRows(tree).map(({ node: item, depth, hasChildren }) => [
      item.id, depth, hasChildren,
    ]),
    [
      ['声音采集', 0, true],
      ['采样', 1, true],
      ['麦克风', 1, false],
      ['其他主题', 0, false],
    ],
  );
  assert.equal(tree.nodes.length, 5);
  assert.equal(ancestors(tree, '频率').length, 3);
});

test('moving a branch changes navigation without rewriting fork provenance', () => {
  const original = attachSession(learningTree(), {
    ...node('采样', '声音采集'),
    source: { sessionId: '声音采集', quote: '采样', seq: 8 },
  });
  const moved = moveNode(original, '采样', '其他主题');
  assert.deepEqual(
    ancestors(moved, '频率').map((item) => item.id),
    ['其他主题', '采样', '频率'],
  );
  assert.equal(moved.nodes[1]?.source?.sessionId, '声音采集');
  assert.equal(original.nodes[1]?.parentId, '声音采集');
  assert.equal(moveNode(moved, '采样', null).nodes[1]?.parentId, null);
});

test('moving below a descendant, self-parenting, and missing parents are rejected', () => {
  const tree = learningTree();
  assert.throws(() => moveNode(tree, '声音采集', '频率'), /cycle/i);
  assert.throws(() => moveNode(tree, '声音采集', '声音采集'), /cycle/i);
  assert.throws(() => moveNode(tree, '采样', 'missing'), /parent.*missing/i);
  assert.throws(() => attachSession(tree, node('新概念', 'missing')), /parent.*missing/i);
  assert.equal(tree.nodes[0]?.parentId, null);
});

test('sibling sorting carries the complete branch while every parent and fork source stays unchanged', () => {
  const original = attachSession(learningTree(), {
    ...node('采样', '声音采集'), source: { sessionId: '声音采集', quote: '采样', seq: 8 },
  });
  const moved = relocateBranch(original, '采样', { position: 'after', id: '麦克风' });
  assert.deepEqual(visibleRows(moved).map(row => row.node.id), ['声音采集', '麦克风', '采样', '频率', '其他主题']);
  for (const entry of original.nodes) assert.deepEqual(moved.nodes.find(item => item.id === entry.id), entry);
  assert.deepEqual(ancestors(moved, '频率').map(item => item.id), ['声音采集', '采样', '频率']);
  assert.deepEqual(parseTree(JSON.parse(JSON.stringify(moved))), moved);
});

test('before and after drops reorder siblings around the complete target branch', () => {
  const before = relocateBranch(learningTree(), '麦克风', { position: 'before', id: '采样' });
  assert.deepEqual(visibleRows(before).map(row => row.node.id), ['声音采集', '麦克风', '采样', '频率', '其他主题']);
  const after = relocateBranch(before, '麦克风', { position: 'after', id: '采样' });
  assert.deepEqual(visibleRows(after).map(row => row.node.id), ['声音采集', '采样', '频率', '麦克风', '其他主题']);
});

test('root topics sort as siblings without detaching or reparenting any descendants', () => {
  const moved = relocateBranch(learningTree(), '声音采集', { position: 'after', id: '其他主题' });
  assert.deepEqual(visibleRows(moved).map(row => [row.node.id, row.depth]), [
    ['其他主题', 0], ['声音采集', 0], ['采样', 1], ['频率', 2], ['麦克风', 1],
  ]);
});

test('cross-parent sorting including equal-depth cousins and legacy reparent targets is refused', () => {
  const tree = attachSession(learningTree(), node('其他话题的分支', '其他主题'));
  assert.throws(() => relocateBranch(tree, '采样', { position: 'before', id: '其他话题的分支' }), /同一父节点/);
  assert.throws(() => relocateBranch(tree, '频率', { position: 'before', id: '麦克风' }), /同一父节点/);
  assert.throws(() => relocateBranch(tree, '采样', { position: 'inside', id: '其他主题' }), /同一父节点/);
  assert.throws(() => relocateBranch(tree, '采样', { position: 'root' }), /同一父节点/);
  assert.equal(tree.nodes.find(item => item.id === '采样')?.parentId, '声音采集');
});

test('sorting preserves collapsed state, treats self ordering as a no-op and reports missing identities', () => {
  const tree = attachSession(learningTree(), { ...node('采样', '声音采集'), collapsed: true });
  const moved = relocateBranch(tree, '采样', { position: 'after', id: '麦克风' });
  assert.equal(moved.nodes.find(item => item.id === '采样')?.collapsed, true);
  assert.deepEqual(relocateBranch(tree, '采样', { position: 'before', id: '采样' }), tree);
  assert.throws(() => relocateBranch(tree, 'missing', { position: 'before', id: '采样' }), /missing/i);
  assert.throws(() => relocateBranch(tree, '采样', { position: 'after', id: 'missing' }), /missing/i);
});

test('detaching removes only the requested navigation subtree', () => {
  const original = learningTree();
  const detached = detachBranch(original, '采样');
  assert.deepEqual(detached.nodes.map((item) => item.id), ['声音采集', '麦克风', '其他主题']);
  assert.equal(original.nodes.length, 5);
});

test('operations report unknown session ids instead of silently losing user actions', () => {
  const tree = learningTree();
  assert.throws(() => ancestors(tree, 'missing'), /session.*missing/i);
  assert.throws(() => moveNode(tree, 'missing', null), /session.*missing/i);
  assert.throws(() => detachBranch(tree, 'missing'), /session.*missing/i);
});

test('persisted trees round-trip while breaking references to external data', () => {
  const original = attachSession(learningTree(), {
    ...node('频率', '采样'),
    source: {
      sessionId: '采样', seq: 13, quote: '频率', prefix: '采样', suffix: '决定', scrollTop: 210,
    },
  });
  const encoded = JSON.parse(JSON.stringify(original));
  const parsed = parseTree(encoded);
  assert.deepEqual(parsed, original);
  encoded.nodes[0].title = 'changed outside';
  encoded.nodes[2].source.quote = 'changed outside';
  assert.equal(parsed.nodes[0]?.title, '声音采集');
  assert.equal(parsed.nodes[2]?.source?.quote, '频率');
});

test('parsing rejects incompatible schemas, duplicate identities, or broken topology', () => {
  assert.throws(() => parseTree({ schemaVersion: 2, nodes: [] }), /schemaVersion/);
  assert.throws(() => parseTree({ schemaVersion: 1, nodes: [node('a'), node('a')] }), /duplicate/i);
  assert.throws(() => parseTree({ schemaVersion: 1, nodes: [node('a', 'missing')] }), /parent.*missing/i);
  assert.throws(() => parseTree({ schemaVersion: 1, nodes: [node('a', 'b'), node('b', 'a')] }), /cycle/i);
});

test('parsing rejects malformed node and source fields with their location', () => {
  const invalid = [
    { ...node('a'), title: '' },
    { ...node('a'), id: ' ' },
    { ...node('a'), createdAt: Number.NaN },
    { ...node('a'), parentId: 5 },
    { ...node('a'), collapsed: 'yes' },
    { ...node('a'), source: { sessionId: 'x', quote: 'q', seq: -1 } },
    { ...node('a'), source: { sessionId: 'x', quote: 'q', scrollTop: Infinity } },
    { ...node('a'), source: { sessionId: 'x', quote: 'q', prefix: 1 } },
  ];
  for (const item of invalid) {
    assert.throws(() => parseTree({ schemaVersion: 1, nodes: [item] }), /nodes\[0\]/);
  }
});

test('tree limits reject oversized imports and growth before publication', () => {
  const nodes = Array.from({ length: MAX_TREE_NODES }, (_, index) => node(`s-${index}`));
  const full = parseTree({ schemaVersion: 1, nodes });
  assert.equal(full.nodes.length, MAX_TREE_NODES);
  assert.throws(() => attachSession(full, node('overflow')), /limit/i);
  assert.throws(() => parseTree({ schemaVersion: 1, nodes: [...nodes, node('overflow')] }), /limit/i);
});
