import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { StudyController } from '../src/controller.ts';
import { CONFIG } from '../src/config.ts';
import { attachSession, type StudyTree } from '../src/tree.ts';
import type { PluginContext } from '../src/contracts.ts';

const PARENT_ID = 'session-sound-capture';
const CHILD_ID = 'session-sampling';
const QUESTION = '采样和连续录制有什么区别？';

interface HarnessOptions {
  conflictOnFirstWrite?: boolean;
  uncertainPrompt?: boolean;
  forkBarrier?: Promise<string>;
  nativeSidebarPresent?: boolean;
  forkFailsAfterCreation?: boolean;
  generatedTitle?: string;
  nativeRenameFails?: boolean;
}

interface HostState {
  revision: number;
  tree: StudyTree;
}

/**
 * Installs isolated transport and DOM seams without running browser automation.
 *
 * Args:
 *   context: Node test lifecycle and clock owner.
 *   options: One intentional host failure or delayed fork.
 *
 * Returns:
 *   A real controller plus recorded host operations and an owned fake clock.
 */
function harness(context: TestContext, options: HarnessOptions = {}) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const values = new Map<string, string>();
  const events: string[] = [];
  const prompts: Array<{ sessionId: string; text: string }> = [];
  const opened: string[] = [];
  const state: HostState = {
    revision: 0,
    tree: {
      schemaVersion: 1,
      nodes: [{ id: PARENT_ID, parentId: null, title: '声音采集', createdAt: 1 }],
    },
  };
  let currentId = PARENT_ID;
  let forkCalls = 0;
  let writeCalls = 0;
  let readCalls = 0;
  let retained = 0;
  const catalogListeners = new Set<() => void>();
  const forks: Array<{ atSeq?: number }> = [];
  const classNames = new Set<string>();
  let nativeSidebarCollapsed = false;
  const documentElement = {
    scrollTop: 0,
    classList: {
      toggle(name: string, force: boolean) {
        if (force) classNames.add(name);
        else classNames.delete(name);
        return force;
      },
      remove(...names: string[]) { for (const name of names) classNames.delete(name); },
    },
  };
  const documentStub = {
    documentElement,
    scrollingElement: documentElement,
    body: {},
    getElementById() { return null; },
    querySelector(selector: string) {
      return options.nativeSidebarPresent && selector === '[data-shell-overlay]'
        ? { parentElement: { hasAttribute() { return nativeSidebarCollapsed; } } } : null;
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-study-session-id]') {
        return [{ dataset: { studySessionId: currentId } }];
      }
      if (selector === '[data-study-turn-end]') {
        return [{
          dataset: { studySessionId: currentId, studyTurnEnd: '12' },
          closest() { return null; },
        }];
      }
      return [];
    },
  };
  const globals: Record<string, unknown> = {
    document: documentStub,
    window: {
      innerWidth: 1280,
      addEventListener() {}, removeEventListener() {},
      getSelection() { return { removeAllRanges() {} }; },
    },
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage: {
      getItem(key: string) { return values.get(key) ?? null; },
      setItem(key: string, value: string) { values.set(key, value); },
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  context.after(() => {
    context.mock.timers.reset();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  const catalog: Record<string, { title: string }> = {
    [PARENT_ID]: { title: '声音采集' },
  };
  const services: Record<string, unknown> = {
    layout: {
      selectPanel(id: string | null) { events.push(`panel:${id}`); },
      toggleSidebar() {
        nativeSidebarCollapsed = !nativeSidebarCollapsed;
        events.push('native-sidebar-toggle');
      },
    },
    sessions: {
      list: {
        getSnapshot() { return { ids: Object.keys(catalog), byId: catalog }; },
        subscribe(listener: () => void) { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; },
      },
      async fork(forkOptions: { atSeq?: number; onCreated?: (id: string) => void }) {
        forks.push(forkOptions);
        forkCalls += 1;
        events.push('fork');
        const id = options.forkBarrier ? await options.forkBarrier : CHILD_ID;
        catalog[id] = { title: '采样' };
        forkOptions.onCreated?.(id);
        if (options.forkFailsAfterCreation) throw new Error('Workspace attachment failed after the child was created.');
        return id;
      },
      retain(id: string) {
        retained += 1;
        return {
          ready: Promise.resolve({
            session: {
              getSnapshot() { return { turnEnds: new Map([[1, 12]]) }; },
              subscribe() { return () => {}; },
              async rename(title: string) {
                if (options.nativeRenameFails) throw new Error('Native rename failed.');
                events.push(`rename:${id}`);
                catalog[id] = { title };
                for (const listener of catalogListeners) listener();
                return { ok: true, value: { title } };
              },
              async prompt(content: Array<{ type: 'text'; text: string }>) {
                prompts.push({ sessionId: id, text: content[0]!.text });
                events.push(`prompt:${id}`);
                if (options.uncertainPrompt) {
                  throw new Error('Connection closed after request admission; delivery status is unknown.');
                }
                return { ok: true, value: { accepted: true } };
              },
            },
          }),
          release() { retained -= 1; },
        };
      },
    },
    uiWorkspace: {
      openSession(id: string) { currentId = id; opened.push(id); events.push(`open:${id}`); },
    },
    connection: {
      rpc: { call() { throw new Error('Unexpected legacy transport fallback.'); } },
    },
  };
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    if (String(input).endsWith('/read')) {
      readCalls += 1;
      events.push('read');
      return Response.json({ ok: true, value: structuredClone(state) });
    }
    if (String(input).endsWith('/title')) {
      events.push('title');
      const { id } = JSON.parse(String(init?.body));
      if (options.generatedTitle) catalog[id] = { title: options.generatedTitle };
      for (const listener of catalogListeners) listener();
      return Response.json({ ok: true, value: { ready: true } });
    }
    assert.equal(String(input), './api/study-tree/write');
    writeCalls += 1;
    events.push('write');
    const request = JSON.parse(String(init?.body)) as HostState;
    if (options.conflictOnFirstWrite && writeCalls === 1) {
      state.tree = attachSession(state.tree, {
        id: 'session-another-topic', parentId: null, title: '另一窗口新增的主题', createdAt: 2,
      });
      state.revision += 1;
      return Response.json({ ok: false, error: { code: 'conflict', message: 'Tree revision conflict.' } });
    }
    assert.equal(request.revision, state.revision);
    state.revision += 1;
    state.tree = request.tree;
    return Response.json({ ok: true, value: structuredClone(state) });
  });
  const ctx: PluginContext = {
    get(name) { return services[name]; },
    slots: { inject() {}, register() {} },
    effect() {},
    inject(_services, callback) { callback(ctx); },
  };
  const controller = new StudyController(ctx);
  return {
    controller,
    restart: () => new StudyController(ctx),
    events,
    prompts,
    opened,
    forks,
    renameNative(id: string, title: string) { catalog[id] = { title }; for (const listener of catalogListeners) listener(); },
    host: state,
    counts: () => ({ forkCalls, writeCalls, readCalls, retained }),
    preferences: () => JSON.parse(values.get(CONFIG.browserKey) ?? '{}'),
    flushTimers() { context.mock.timers.tick(CONFIG.positionDelayMs); },
  };
}

/**
 * Loads state and records the same safe completed-turn selection as the UI.
 *
 * Args:
 *   controller: Real controller backed by this test's isolated host.
 */
async function prepareFork(controller: StudyController): Promise<void> {
  await controller.reload();
  controller.setCurrent(PARENT_ID);
  controller.setSelection({
    source: { sessionId: PARENT_ID, seq: 12, quote: '采样', prefix: '模拟电信号经过', suffix: '变成数字音频' },
    rect: { left: 100, top: 80, bottom: 100, width: 40, height: 20 },
  }, false);
}

test('learning navigation toggles leave the native sidebar state and animation untouched', async (context) => {
  const { controller, events } = harness(context, { nativeSidebarPresent: true });
  await controller.reload();

  controller.toggleEnabled();
  assert.equal(controller.getSnapshot().enabled, false);
  controller.toggleEnabled();
  assert.equal(controller.getSnapshot().enabled, true);

  assert.equal(events.includes('native-sidebar-toggle'), false);
});

test('ordinary editor mouseup and keyup preserve its caret without publishing study state', (context) => {
  const { controller } = harness(context);
  const before = controller.getSnapshot();
  let notifications = 0;
  controller.subscribe(() => { notifications += 1; });
  context.mock.method(window, 'getSelection', () => {
    throw new Error('Study dismissal must not read or clear the native editor selection.');
  });

  controller.dismissSelection();
  controller.dismissSelection();

  assert.equal(controller.getSnapshot(), before);
  assert.equal(notifications, 0);
});

test('closing an expanded study form preserves a new editor selection and dismisses once', async (context) => {
  const { controller } = harness(context);
  await prepareFork(controller);
  controller.expandSelection();
  let notifications = 0;
  controller.subscribe(() => { notifications += 1; });
  context.mock.method(window, 'getSelection', () => {
    throw new Error('Closing a study form must preserve selections in other controls.');
  });

  controller.dismissSelection();

  const dismissed = controller.getSnapshot();
  assert.equal(dismissed.selection, undefined);
  assert.equal(dismissed.selectionExpanded, false);
  assert.equal(notifications, 1);
  controller.dismissSelection();
  assert.equal(controller.getSnapshot(), dismissed);
  assert.equal(notifications, 1);
});

test('recovering a fork after a tree conflict reuses the child and preserves the concurrent edit', async (context) => {
  const environment = harness(context, { conflictOnFirstWrite: true });
  const { controller } = environment;
  await prepareFork(controller);

  await assert.rejects(controller.fork(QUESTION, '采样'), /另一窗口更新/);
  assert.equal(environment.counts().forkCalls, 1);
  assert.equal(environment.counts().readCalls, 2, 'a conflict reloads the authoritative tree');
  assert.equal(environment.prompts.length, 0);
  assert.deepEqual(controller.getSnapshot().pendingFork, { id: CHILD_ID, title: '采样' });
  assert.equal(environment.preferences().pendingFork.id, CHILD_ID);
  assert.equal(environment.preferences().pendingFork.promptAttempted, false);

  await controller.recoverFork();
  assert.equal(environment.counts().forkCalls, 1, 'recovery must never call host fork again');
  assert.deepEqual(environment.prompts, [{
    sessionId: CHILD_ID,
    text: `关于刚才回答中的「采样」：\n\n${QUESTION}`,
  }]);
  assert.ok(environment.host.tree.nodes.some((node) => node.id === 'session-another-topic'));
  assert.equal(environment.host.tree.nodes.find((node) => node.id === CHILD_ID)?.parentId, PARENT_ID);
  assert.equal(controller.getSnapshot().pendingFork, undefined);
  assert.equal(environment.preferences().pendingFork, undefined);
  assert.equal(environment.counts().retained, 0);
  assert.ok(environment.events.indexOf('fork') < environment.events.indexOf('write'));
  assert.ok(environment.events.lastIndexOf('read') < environment.events.lastIndexOf('write'));
  environment.flushTimers();
});

test('recovering an uncertain prompt opens the existing child without submitting the question twice', async (context) => {
  const environment = harness(context, { uncertainPrompt: true });
  const { controller } = environment;
  await prepareFork(controller);

  await assert.rejects(controller.fork(QUESTION, '采样'), /delivery status is unknown/);
  assert.equal(environment.counts().forkCalls, 1);
  assert.equal(environment.prompts.length, 1);
  assert.equal(environment.prompts[0]?.sessionId, CHILD_ID);
  assert.equal(environment.preferences().pendingFork.promptAttempted, true);
  assert.equal(environment.counts().retained, 0, 'failed prompt releases its borrowed reference');

  await controller.recoverFork();
  assert.equal(environment.counts().forkCalls, 1);
  assert.equal(environment.prompts.length, 1, 'an uncertain admission is not safe to automatically repeat');
  assert.equal(controller.getSnapshot().currentId, CHILD_ID);
  assert.match(controller.getSnapshot().error ?? '', /确认上一条问题是否已发送/);
  assert.equal(controller.getSnapshot().pendingFork, undefined);
  assert.equal(environment.counts().retained, 0);
  environment.flushTimers();
});

test('tree edits and detachment are refused while a host fork is in flight', async (context) => {
  let resolveFork!: (id: string) => void;
  const forkBarrier = new Promise<string>((resolve) => { resolveFork = resolve; });
  const environment = harness(context, { forkBarrier });
  const { controller } = environment;
  await prepareFork(controller);

  const pending = controller.fork(QUESTION, '采样');
  assert.equal(controller.getSnapshot().busy, true);
  await assert.rejects(controller.editNode(PARENT_ID, '改名', null), /正在创建学习分支/);
  await assert.rejects(controller.detach(PARENT_ID), /正在创建学习分支/);
  await assert.rejects(controller.toggleNode(PARENT_ID), /正在创建学习分支/);
  await assert.rejects(controller.relocate(PARENT_ID, { position: 'root' }), /正在创建学习分支/);
  controller.run(() => controller.relocate(PARENT_ID, { position: 'root' }));
  await Promise.resolve();
  assert.equal(controller.getSnapshot().busy, true, 'a rejected second action must not unlock the first operation');
  assert.equal(environment.counts().writeCalls, 0);

  resolveFork(CHILD_ID);
  await pending;
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(environment.counts().forkCalls, 1);
  assert.equal(environment.prompts.length, 1);
  assert.equal(environment.prompts[0]?.sessionId, CHILD_ID);
  assert.equal(environment.counts().retained, 0);
  environment.flushTimers();
});

test('dragging saves the navigation subtree without opening or forking any native session', async (context) => {
  const environment = harness(context);
  const source = { sessionId: PARENT_ID, seq: 12, quote: '采样' };
  environment.host.tree.nodes.push(
    { id: CHILD_ID, parentId: PARENT_ID, title: '采样', createdAt: 2, source },
    { id: 'frequency', parentId: CHILD_ID, title: '频率', createdAt: 3 },
    { id: 'microphone', parentId: PARENT_ID, title: '麦克风', createdAt: 4 },
  );
  await environment.controller.reload();
  environment.controller.setCurrent('frequency');
  await environment.controller.relocate(CHILD_ID, { position: 'after', id: 'microphone' });
  assert.equal(environment.controller.getSnapshot().currentId, 'frequency');
  assert.equal(environment.host.tree.nodes.find((node) => node.id === CHILD_ID)?.parentId, PARENT_ID);
  assert.deepEqual(environment.host.tree.nodes.map(node => node.id), [PARENT_ID, 'microphone', CHILD_ID, 'frequency']);
  assert.equal(environment.host.tree.nodes.find((node) => node.id === 'frequency')?.parentId, CHILD_ID);
  assert.deepEqual(environment.host.tree.nodes.find((node) => node.id === CHILD_ID)?.source, source);
  assert.equal(environment.counts().forkCalls, 0);
  assert.equal(environment.counts().retained, 0);
  assert.deepEqual(environment.opened, []);
  assert.deepEqual(environment.prompts, []);
  await environment.controller.reload();
  assert.equal(environment.controller.getSnapshot().tree.nodes.find((node) => node.id === CHILD_ID)?.parentId, PARENT_ID);
  await assert.rejects(environment.controller.relocate(CHILD_ID, { position: 'inside', id: 'frequency' }), /同一父节点/);
  await assert.rejects(environment.controller.relocate(CHILD_ID, { position: 'before', id: 'frequency' }), /同一父节点/);
  await assert.rejects(environment.controller.relocate(CHILD_ID, { position: 'root' }), /同一父节点/);
  await environment.controller.relocate(CHILD_ID, { position: 'after', id: 'microphone' });
  assert.equal(environment.counts().writeCalls, 1, 'invalid drops never reach durable storage');
});

test('sending the first draft message forks once at the frozen completed prefix and continues native chat', async (context) => {
  const environment = harness(context);
  const { controller } = environment;
  await controller.reload();
  controller.setCurrent(PARENT_ID);
  await controller.newBranch();
  assert.equal(environment.counts().forkCalls, 0);
  controller.setDraftQuestion(QUESTION);
  await controller.submitDraft();
  assert.equal(environment.counts().forkCalls, 1);
  assert.equal(environment.forks[0]?.atSeq, 12);
  assert.equal(controller.getSnapshot().currentId, CHILD_ID);
  const child = environment.host.tree.nodes.find((node) => node.id === CHILD_ID);
  assert.equal(child?.parentId, PARENT_ID);
  assert.deepEqual(child?.origin, { sessionId: PARENT_ID, scrollTop: 0, seq: 12 });
  assert.equal(child?.source, undefined, 'a whole-session fork never fabricates selected text');
  assert.deepEqual(environment.prompts, [{ sessionId: CHILD_ID, text: QUESTION }], 'send exactly the question the user submitted');
  assert.ok(environment.events.includes(`rename:${CHILD_ID}`), 'give the new native conversation its own initial title');
  assert.equal(environment.preferences().pendingFork, undefined);
  assert.equal(environment.counts().retained, 0);
  await controller.editNode(CHILD_ID, child!.title, null);
  await controller.returnToSource();
  assert.equal(controller.getSnapshot().currentId, PARENT_ID, 'source navigation ignores later tree parent changes');
  assert.equal(environment.counts().forkCalls, 1);
  environment.flushTimers();
});

test('opening and abandoning a new conversation creates neither a host session nor a persisted node', async (context) => {
  const environment = harness(context);
  await environment.controller.reload();
  environment.controller.setCurrent(PARENT_ID);
  await environment.controller.newBranch();
  assert.equal(environment.counts().forkCalls, 0);
  assert.equal(environment.counts().writeCalls, 0);
  assert.equal(environment.host.tree.nodes.length, 1);
  assert.equal(environment.controller.getSnapshot().draft?.parentId, PARENT_ID);
  environment.controller.setDraftQuestion('还没有发送的问题');
  assert.equal(environment.preferences().draft, undefined);
  environment.controller.cancelDraft();
  assert.equal(environment.controller.getSnapshot().draft, undefined);
  assert.equal(environment.restart().getSnapshot().draft, undefined);
  assert.deepEqual(environment.prompts, []);
});

test('a submitted draft can recover after reload without reforking or duplicating its first message', async (context) => {
  const environment = harness(context, { conflictOnFirstWrite: true });
  await environment.controller.reload();
  environment.controller.setCurrent(PARENT_ID);
  await environment.controller.newBranch();
  environment.controller.setDraftQuestion(QUESTION);
  await assert.rejects(environment.controller.submitDraft(), /另一窗口更新/);
  assert.equal(environment.preferences().pendingFork.id, CHILD_ID);
  const recovered = environment.restart();
  await recovered.reload();
  await recovered.recoverFork();
  assert.equal(environment.counts().forkCalls, 1);
  assert.equal(recovered.getSnapshot().currentId, CHILD_ID);
  assert.equal(recovered.getSnapshot().pendingFork, undefined);
  assert.equal(environment.preferences().pendingFork, undefined);
  assert.deepEqual(environment.prompts, [{ sessionId: CHILD_ID, text: QUESTION }]);
  assert.ok(environment.host.tree.nodes.some((node) => node.id === 'session-another-topic'));
  assert.deepEqual(environment.host.tree.nodes.find((node) => node.id === CHILD_ID)?.origin,
    { sessionId: PARENT_ID, scrollTop: 0, seq: 12 });
  environment.flushTimers();
});

test('a receipt delivered before host failure remains recoverable without creating another child', async (context) => {
  const environment = harness(context, { forkFailsAfterCreation: true });
  await environment.controller.reload();
  environment.controller.setCurrent(PARENT_ID);
  await environment.controller.newBranch();
  environment.controller.setDraftQuestion(QUESTION);
  await assert.rejects(environment.controller.submitDraft(), /attachment failed/);
  assert.equal(environment.preferences().pendingFork.id, CHILD_ID);
  await environment.controller.recoverFork();
  assert.equal(environment.counts().forkCalls, 1);
  assert.equal(environment.controller.getSnapshot().currentId, CHILD_ID);
  assert.equal(environment.host.tree.nodes.find((node) => node.id === CHILD_ID)?.origin?.seq, 12,
    'the original draft boundary remains frozen during recovery');
  assert.deepEqual(environment.prompts, [{ sessionId: CHILD_ID, text: QUESTION }]);
  environment.flushTimers();
});

test('native catalog renames immediately update tree labels without writing a second title record', async (context) => {
  const environment = harness(context);
  const stop = environment.controller.start();
  await environment.controller.reload();
  environment.renameNative(PARENT_ID, '声音采集原理');
  assert.equal(environment.controller.getSnapshot().tree.nodes[0]?.title, '声音采集原理');
  assert.equal(environment.counts().writeCalls, 0);
  stop();
});

test('a tree rename writes the same title to the native session', async (context) => {
  const environment = harness(context);
  await environment.controller.reload();
  await environment.controller.editNode(PARENT_ID, '声音采集原理', null);
  assert.equal(environment.controller.adapter.catalog()[0]?.title, '声音采集原理');
  assert.equal(environment.controller.getSnapshot().tree.nodes[0]?.title, '声音采集原理');
});

test('a failed native rename preserves the prior tree title and relationships', async (context) => {
  const environment = harness(context, { nativeRenameFails: true });
  await environment.controller.reload();
  await assert.rejects(environment.controller.editNode(PARENT_ID, '声音采集原理', null), /Native rename failed/);
  assert.equal(environment.controller.getSnapshot().tree.nodes[0]?.title, '声音采集');
  assert.equal(environment.counts().writeCalls, 0);
});

test('leaving an unsent draft through navigation discards it without materializing a session', async (context) => {
  const environment = harness(context);
  await environment.controller.reload();
  environment.controller.setCurrent(PARENT_ID);
  await environment.controller.newBranch();
  environment.controller.setDraftQuestion(QUESTION);
  await environment.controller.navigate(PARENT_ID);
  assert.equal(environment.controller.getSnapshot().draft, undefined);
  assert.equal(environment.counts().forkCalls, 0);
  assert.equal(environment.counts().writeCalls, 0);
  assert.deepEqual(environment.prompts, []);
  environment.flushTimers();
});
