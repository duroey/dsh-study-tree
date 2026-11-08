import assert from 'node:assert/strict';
import test from 'node:test';
import { DshAdapter, type DshBinding, type DshSession } from '../src/compat.ts';

/**
 * Supplies only the structural session capabilities the adapter borrows.
 *
 * Args:
 *   overrides: Behaviors relevant to one regression case.
 *
 * Returns:
 *   An independent real-session stand-in with safe no-op observables.
 */
function session(overrides: Partial<DshSession> = {}): DshSession {
  return {
    getSnapshot: () => ({}),
    subscribe: () => () => {},
    prompt: async () => ({ ok: true, value: { accepted: true } }),
    rename: async (title) => ({ ok: true, value: { title } }),
    ...overrides,
  };
}

test('a host without public main-panel navigation uses the legacy draft overlay without mutation', () => {
  const adapter = new DshAdapter({ sessions: {}, layout: { toggleSidebar: () => assert.fail('must not change native sidebar') } });
  assert.equal(adapter.draftPresentation(), 'overlay');
  adapter.showDraft(true);
  adapter.showDraft(false);
});

test('current navigation selects the normal DSH conversation through uiWorkspace', async () => {
  const calls: string[] = [];
  const adapter = new DshAdapter({
    sessions: { open: () => calls.push('legacy') },
    uiWorkspace: { openSession: (id: string) => calls.push(id) },
  });
  await adapter.open('frequency');
  assert.deepEqual(calls, ['frequency']);
  assert.equal(adapter.describe().navigation, 'uiWorkspace.openSession');
});

test('legacy navigation opens the session and returns the layout to normal chat', async () => {
  const calls: unknown[] = [];
  const services = {
    sessions: { open: (id: string) => calls.push(id) },
    layout: { selectPanel: (panel: unknown) => calls.push(panel) },
  };
  const adapter = new DshAdapter({ get: (key: keyof typeof services) => services[key] });
  await adapter.open('sampling');
  assert.deepEqual(calls, ['sampling', null]);
  assert.equal(adapter.describe().navigation, 'sessions.open');
});

test('current ownership retains through settlement and releases after success', async () => {
  const calls: string[] = [];
  const binding = { session: session() };
  const adapter = new DshAdapter({
    sessions: {
      retain: (id: string, options: { source: string }) => {
        calls.push(`retain:${id}:${options.source}`);
        return { ready: Promise.resolve(binding), release: () => calls.push('release') };
      },
    },
  });
  const result = await adapter.usingSession('frequency', async (borrowed) => {
    assert.equal(borrowed, binding);
    calls.push('operation');
    return 'kept';
  });
  assert.equal(result, 'kept');
  assert.deepEqual(calls, ['retain:frequency:studyTreeOperation', 'operation', 'release']);
});

test('a failed initial history open still releases the retained reference', async () => {
  let released = 0;
  const failure = new Error('history unavailable');
  const adapter = new DshAdapter({
    sessions: {
      retain: () => ({ ready: Promise.reject(failure), release: () => { released += 1; } }),
    },
  });
  await assert.rejects(adapter.usingSession('frequency', () => assert.fail('must not run')), failure);
  assert.equal(released, 1);
});

test('an operation failure still releases its borrowed reference', async () => {
  let released = 0;
  const failure = new Error('render operation failed');
  const adapter = new DshAdapter({
    sessions: {
      retain: () => ({
        ready: Promise.resolve({ session: session() }),
        release: () => { released += 1; },
      }),
    },
  });
  await assert.rejects(adapter.usingSession('sampling', () => { throw failure; }), failure);
  assert.equal(released, 1);
});

test('legacy borrowing opens an unmaterialized binding and its history once', async () => {
  const calls: string[] = [];
  let binding: DshBinding | undefined;
  const adapter = new DshAdapter({
    sessions: {
      binding: () => binding,
      open: (id: string) => {
        calls.push(`open:${id}`);
        binding = { session: session({ open: () => { calls.push('history'); } }) };
      },
    },
  });
  await adapter.usingSession('sampling', () => { calls.push('operation'); });
  assert.deepEqual(calls, ['open:sampling', 'history', 'operation']);
});

test('fork forwards the exact selected source sequence without synthesizing a model prompt', async () => {
  const calls: unknown[] = [];
  const adapter = new DshAdapter({
    sessions: { fork: async (options: unknown) => { calls.push(options); return 'frequency'; } },
  });
  assert.equal(await adapter.fork({ sessionId: 'sampling', seq: 17, quote: '频率' }), 'frequency');
  assert.deepEqual(calls, [{ sessionId: 'sampling', atSeq: 17, increaseTitle: false }]);
});

test('fork refuses an invalid sequence before calling the host', async () => {
  let called = false;
  const adapter = new DshAdapter({
    sessions: { fork: async () => { called = true; return 'unexpected'; } },
  });
  await assert.rejects(adapter.fork({ sessionId: 'sampling', seq: -1, quote: '频率' }), /sequence/);
  assert.equal(called, false);
});

test('a no-selection fork omits the cutoff and records one child receipt on either host shape', async () => {
  for (const callbackSupported of [false, true]) {
    const receipts: string[] = [];
    const adapter = new DshAdapter({ sessions: { fork: async (options: { atSeq?: number; increaseTitle: boolean; onCreated(id: string): void }) => {
      assert.equal(options.atSeq, undefined, 'let DSH choose the completed-prefix default');
      assert.equal(options.increaseTitle, false);
      if (callbackSupported) options.onCreated('new-idea');
      return 'new-idea';
    } } });
    assert.equal(await adapter.fork({ sessionId: 'sampling' }, (id) => receipts.push(id)), 'new-idea');
    assert.deepEqual(receipts, ['new-idea']);
  }
});

test('a committed child in a workspace attachment failure is still recorded for recovery', async () => {
  const receipts: string[] = [];
  const failure = Object.assign(new Error('attachment failed'), {
    rpcError: { code: 'workspace-attach-failed', details: { sessionId: 'new-idea' } },
  });
  const adapter = new DshAdapter({ sessions: { fork: async () => { throw failure; } } });
  await assert.rejects(adapter.fork({ sessionId: 'sampling' }, (id) => receipts.push(id)), failure);
  assert.deepEqual(receipts, ['new-idea']);
});

test('modern inherited presentation uses the last seed marker and excludes child-local turns', async () => {
  let released = false;
  const events = [
    { type: 'turn/end', seq: 12 },
    { type: 'session/end-seed', seq: 14, data: { inherited: true } },
    { type: 'turn/end', seq: 24 },
    { type: 'session/end-seed', seq: 26, data: { inherited: true } },
    { type: 'turn/end', seq: 40 },
  ];
  const adapter = new DshAdapter({ sessions: { retain: () => ({
    ready: Promise.resolve({ session: session(), eventSource: { getSnapshot: () => ({ entries: events.map((event) => ({ type: 'event', event })) }) } }),
    release: () => { released = true; },
  }) } });
  assert.equal(await adapter.inheritedTurnEnd('frequency'), 24);
  assert.equal(released, true);
});

test('legacy inherited presentation reads a completed-turn anchor without assuming an exact seed length', async () => {
  const adapter = new DshAdapter({ sessions: { binding: () => ({
    session: session({ getSnapshot: () => ({ turnEnds: new Map([[1, 12], [2, 24]]) }) }),
  }) } });
  assert.equal(await adapter.inheritedTurnEnd('frequency'), 24);
});

test('recovery never treats a legacy child-local turn as inherited history', async () => {
  const adapter = new DshAdapter({ sessions: { binding: () => ({
    session: session({ getSnapshot: () => ({ turnEnds: new Map([[1, 12], [2, 240]]) }) }),
  }) } });
  assert.equal(await adapter.inheritedTurnEnd('frequency', false), undefined);
});

test('unknown history shapes leave inherited presentation available instead of guessing a cutoff', async () => {
  const adapter = new DshAdapter({ sessions: { binding: () => ({ session: session() }) } });
  assert.equal(await adapter.inheritedTurnEnd('frequency'), undefined);
});

test('prompt sends the question only to its real child session', async () => {
  const received: unknown[] = [];
  const adapter = new DshAdapter({
    sessions: {
      binding: (id: string) => {
        assert.equal(id, 'frequency');
        return { session: session({ prompt: async (...args) => {
          received.push(args);
          return { ok: true, value: { accepted: true } };
        } }) };
      },
    },
  });
  await adapter.prompt('frequency', '频率是什么意思？');
  assert.deepEqual(received, [[[{ type: 'text', text: '频率是什么意思？' }], 'queue']]);
});

test('a prompt refusal preserves the host code and does not claim acceptance', async () => {
  let released = 0;
  const adapter = new DshAdapter({
    sessions: {
      retain: () => ({
        ready: Promise.resolve({ session: session({ prompt: async () => ({
          ok: false,
          error: { code: 'permission-denied', message: 'The session is read-only.' },
        }) }) }),
        release: () => { released += 1; },
      }),
    },
  });
  await assert.rejects(adapter.prompt('frequency', '解释频率'), /frequency.*permission-denied.*read-only/);
  assert.equal(released, 1);
});

test('a missing prompt admission receipt is surfaced as a protocol failure', async () => {
  const adapter = new DshAdapter({
    sessions: { binding: () => ({ session: session({ prompt: async () => ({ ok: true, value: {} }) }) }) },
  });
  await assert.rejects(adapter.prompt('frequency', '解释频率'), /admission receipt/);
});

test('catalog metadata and its subscription never open session histories', () => {
  let calls = 0;
  let notified = 0;
  const adapter = new DshAdapter({
    sessions: {
      list: {
        getSnapshot: () => ({
          ids: ['sound', 'sampling'],
          byId: {
            sampling: { id: 'sampling', title: '', displayTitle: '采样' },
            sound: { id: 'sound', title: '声音采集', cwd: '/workspace' },
          },
        }),
        subscribe: (listener: () => void) => { listener(); return () => { notified += 1; }; },
      },
      open: () => { calls += 1; },
    },
  });
  assert.deepEqual(adapter.catalog(), [
    { id: 'sound', title: '声音采集', cwd: '/workspace' },
    { id: 'sampling', title: '采样' },
  ]);
  const dispose = adapter.subscribe(() => { notified += 1; });
  dispose();
  assert.equal(notified, 2);
  assert.equal(calls, 0);
});
