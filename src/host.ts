import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AtomicTreeStore, TreeConflictError } from './persistence.ts';
import { CONFIG } from './config.ts';
import { BranchTitles } from './title.ts';

export const name = 'dsh-study-tree';
export const inject = ['connection', 'webServer', 'sessions', 'sessionTitle', 'sessionQuery', 'llm'];

interface HostContext {
  get(name: string): any;
  effect(callback: () => (() => void), label?: string): void;
}

interface HostConnection {
    rpc: { handle(channel: string, handler: (...args: any[]) => Promise<unknown>, options?: unknown): () => void };
    fetch?: { register(route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): () => void };
}

/**
 * Register authenticated, owner-scoped persistence on the DSH connection.
 *
 * Args:
 *   ctx: Host Cordis context. The connection RPC is shared by old and new DSH.
 */
export function apply(ctx: HostContext): void {
  const configured = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  const home = configured === '~' ? homedir() : configured.startsWith('~/') ? join(homedir(), configured.slice(2)) : configured;
  const store = new AtomicTreeStore(join(resolve(home), CONFIG.stateDirectory, CONFIG.treeFile));
  const connection = ctx.get('connection') as HostConnection;
  const titles = new BranchTitles(ctx, store);
  const handler = async (endpoint: string, payload: any, signal?: AbortSignal, peer?: any) => {
    if (peer && peer.principal?.kind !== 'owner') return { ok: false, error: { code: 'forbidden', message: 'Study trees belong to the host owner.', details: {} } };
    if (signal?.aborted) return { ok: false, error: { code: 'cancelled', message: 'Request cancelled.', details: {} } };
    try {
      if (endpoint === 'read') return { ok: true, value: await store.read() };
      if (endpoint === 'title') return { ok: true, value: await titles.generate(payload?.id, signal) };
      if (endpoint === 'write') {
        if (!payload || typeof payload !== 'object') throw new Error('Missing tree update.');
        return { ok: true, value: await store.write(payload.tree, payload.revision) };
      }
      return { ok: false, error: { code: 'not-found', message: 'Unknown study-tree operation.', details: {} } };
    } catch (error) {
      return { ok: false, error: { code: error instanceof TreeConflictError ? 'conflict' : 'study-tree-error', message: error instanceof Error ? error.message : String(error), details: {} } };
    }
  };
  // Current Connection owns authentication, Host/Origin checks, and owner-only Fetch routes.
  // Legacy Connection has no Fetch registry; its RPC registration uses the old scope contract.
  if (typeof connection.fetch?.register === 'function') {
    for (const endpoint of ['read', 'write', 'title']) {
      connection.fetch.register({
        path: `/api/study-tree/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
        async fetch(request) {
          let payload: unknown;
          try { payload = await request.json(); }
          catch { return Response.json({ ok: false, error: { code: 'invalid-json', message: 'Expected a JSON request.', details: {} } }, { status: 400 }); }
          return Response.json(await handler(endpoint, payload, request.signal));
        },
      });
    }
  } else {
    connection.rpc.handle(CONFIG.rpcNamespace, handler, { authority: 'trusted-host' });
  }
}
