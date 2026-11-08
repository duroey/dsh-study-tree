import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BranchTitles } from '../src/title.ts';
import { initialBranchTitle, titleFromResponse } from '../src/naming.ts';
import type { StudyTree } from '../src/tree.ts';

/** Args: helper: Official helper substitute. Returns: A host-owned title fixture with inherited and local messages. */
function titleHost(helper: any) {
  let snapshot = { title: initialBranchTitle('采样频率为什么影响细节？'), eventSeq: 5 };
  const renamed: string[] = [];
  let flushes = 0;
  const session = { requestHeader: () => ({ config: { provider: 'example', model: 'light' } }) };
  const events = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '父话题：声音采集' }] } },
    { seq: 3, type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '系统环境' }] } },
    { seq: 4, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '采样频率为什么影响细节？' }] } },
  ];
  const services: Record<string, any> = {
    sessions: { get: () => session, flush: async () => { flushes += 1; } },
    sessionQuery: { readSession: async () => ({ events }) },
    sessionTitle: { get: () => snapshot, rename: (_session: unknown, title: string) => { renamed.push(title); snapshot = { title, eventSeq: snapshot.eventSeq + 1 }; return snapshot; } },
  };
  const tree: StudyTree = { schemaVersion: 1, nodes: [
    { id: 'sound', parentId: null, title: '声音采集', createdAt: 1 },
    { id: 'sampling', parentId: 'sound', title: snapshot.title, createdAt: 2, origin: { sessionId: 'sound', seq: 2 } },
  ] };
  const service = new BranchTitles({ get: name => services[name] }, { read: async () => ({ tree }) }, async () => helper);
  return { service, events, renamed, services, flushes: () => flushes,
    userRename(title: string) { snapshot = { title, eventSeq: snapshot.eventSeq + 1 }; } };
}

test('modern titles use only the first local human message and persist through native title service', async () => {
  const host = titleHost({
    resolveSessionTitleLlmConfig: (value: any) => value,
    executeSessionTitleLlm: async (_ctx: unknown, config: any, request: any, _provider: string, prepared: any) => {
      assert.equal(config.targetCjkCharacters, undefined, 'new helpers reject obsolete policy fields');
      assert.deepEqual(request.messages, [{ seq: 4, text: '采样频率为什么影响细节？' }]);
      assert.deepEqual(prepared.messageSeqs, [4]);
      assert.ok(!prepared.input.includes('父话题'));
      return { finish: { kind: 'stop' }, blocks: [{ type: 'text', text: '采样频率与声音细节' }] };
    },
  });
  assert.deepEqual(await host.service.generate('sampling'), { ready: true, title: '采样频率与声音细节' });
  assert.deepEqual(host.renamed, ['采样频率与声音细节']);
  assert.equal(host.flushes(), 1);
});

test('legacy titles use their official generator and legacy length policy', async () => {
  const host = titleHost({ resolveSessionTitleLlmConfig: (value: any) => value,
    generateSessionTitleWithLlm: async (_ctx: unknown, config: any, _request: unknown, messages: any[]) => {
      assert.ok(config.targetCjkCharacters > 0);
      assert.deepEqual(messages, [{ seq: 4, text: '采样频率为什么影响细节？' }]);
      return { title: '采样频率与细节' };
    } });
  assert.equal((await host.service.generate('sampling')).title, '采样频率与细节');
});

test('modern native ownership excludes inherited messages after an older display anchor', async () => {
  const host = titleHost({ resolveSessionTitleLlmConfig: (value: any) => value,
    executeSessionTitleLlm: async (_ctx: unknown, _config: unknown, request: any) => {
      assert.deepEqual(request.messages, [{ seq: 7, text: '声音如何变成数字？' }]);
      return { finish: { kind: 'stop' }, blocks: [{ type: 'text', text: '声音的数字化过程' }] };
    } });
  host.services.sessions.get().isOwnSeq = (seq: number) => seq >= 6;
  host.events.push({ seq: 7, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '声音如何变成数字？' }] } });
  assert.equal((await host.service.generate('sampling')).title, '声音的数字化过程');
});

test('a manual rename during generation supersedes the model result', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const host = titleHost({ resolveSessionTitleLlmConfig: (value: any) => value,
    executeSessionTitleLlm: async () => { entered(); await gate; return { finish: { kind: 'stop' }, blocks: [{ type: 'text', text: '自动标题' }] }; } });
  const result = host.service.generate('sampling');
  await started;
  host.userRename('我自己起的标题'); release();
  assert.deepEqual(await result, { ready: true, title: '我自己起的标题', superseded: true });
  assert.deepEqual(host.renamed, []);
});

test('an existing custom title is respected without making an auxiliary model call', async () => {
  const host = titleHost({ resolveSessionTitleLlmConfig: () => assert.fail('must not load a model policy') });
  host.userRename('我自己的声音课程');
  assert.equal((await host.service.generate('sampling')).superseded, true);
  assert.deepEqual(host.renamed, []);
});

test('empty local history waits and unrelated session identities are rejected', async () => {
  const host = titleHost({});
  host.events.splice(2);
  assert.deepEqual(await host.service.generate('sampling'), { ready: false });
  await assert.rejects(host.service.generate('sound'), /继承边界/);
  await assert.rejects(host.service.generate('unrelated'), /继承边界/);
  assert.deepEqual(host.renamed, []);
});

test('cold sessions are skipped without restoring agents or reporting a missing title service', async () => {
  const host = titleHost({});
  host.services.sessions.get = () => undefined;
  host.services.sessionQuery.readSession = () => assert.fail('cold history must not be restored just for a title');
  assert.deepEqual(await host.service.generate('sampling'), { ready: true, superseded: true });
});

test('title parsing rejects tool calls, truncation and empty answers while preserving Unicode', () => {
  for (const response of [
    { finish: { kind: 'tool-calls' }, blocks: [] },
    { finish: { kind: 'max-tokens' }, blocks: [{ type: 'text', text: '半个标题' }] },
    { finish: { kind: 'stop' }, blocks: [{ type: 'tool-call' }] },
    { finish: { kind: 'stop' }, blocks: [{ type: 'text', text: ' ' }] },
  ]) assert.throws(() => titleFromResponse(response));
  assert.equal(titleFromResponse({ finish: { kind: 'stop' }, blocks: [{ type: 'text', text: '**采样与频率**\n解释' }] }), '采样与频率');
  assert.ok(!initialBranchTitle('🎵'.repeat(40)).includes('\ufffd'));
});
