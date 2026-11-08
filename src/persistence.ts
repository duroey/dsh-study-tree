import { mkdir, readFile, rename, writeFile, unlink, stat, open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG } from './config.ts';
import { emptyTree, parseTree } from './tree.ts';
import type { StudyTree } from './tree.ts';

export interface SavedTree { revision: number; tree: StudyTree }

/** An optimistic update attempted to overwrite a newer saved tree. */
export class TreeConflictError extends Error {
  constructor() { super('Tree revision conflict: reload the saved tree before editing again.'); }
}

/** Persist validated navigation data without rewriting any DSH Session. */
export class AtomicTreeStore {
  readonly file: string;
  private pending: Promise<unknown> = Promise.resolve();

  /** Args: file: Absolute destination owned by this plugin. */
  constructor(file: string) { this.file = file; }

  /** Returns: The validated last revision, or the empty initial state. */
  async read(): Promise<SavedTree> {
    try {
      if ((await stat(this.file)).size > CONFIG.maxStateBytes) throw new Error('Saved study tree exceeds the size limit.');
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!value || typeof value !== 'object') throw new Error('Invalid saved tree envelope.');
      const data = value as Record<string, unknown>;
      if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 0) throw new Error('Invalid tree revision.');
      return { revision: data.revision as number, tree: parseTree(data.tree) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, tree: emptyTree() };
      throw error;
    }
  }

  /**
   * Atomically save one edit after checking its starting revision.
   *
   * Args:
   *   tree: Complete validated navigation snapshot.
   *   expectedRevision: Revision the editor actually read.
   * Returns:
   *   The newly committed snapshot.
   */
  write(tree: unknown, expectedRevision: number): Promise<SavedTree> {
    const validated = parseTree(tree);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return Promise.reject(new Error('Invalid expected revision.'));
    const operation = this.pending.then(async () => {
      const release = await this.acquireLock();
      try {
      const current = await this.read();
      if (current.revision !== expectedRevision) throw new TreeConflictError();
      const next = { revision: current.revision + 1, tree: validated };
      const encoded = JSON.stringify(next);
      if (Buffer.byteLength(encoded) > CONFIG.maxStateBytes) throw new Error('Study tree exceeds the size limit.');
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, this.file);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
      return next;
      } finally { await release(); }
    });
    // Keep the serialization queue usable after a rejected caller; that caller still sees its error.
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  /** Returns: A release callback after bounded, exclusive cross-process acquisition. */
  private async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + CONFIG.lockTimeoutMs;
    const token = randomUUID();
    while (true) {
      try {
        const handle = await open(lock, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); }
        catch (error) { await handle.close(); await unlink(lock); throw error; }
        return async () => {
          await handle.close();
          const owner = JSON.parse(await readFile(lock, 'utf8'));
          if (owner.token !== token) throw new Error('Study tree lock ownership changed unexpectedly.');
          await unlink(lock);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await this.removeDeadLock(lock);
        if (Date.now() >= deadline) throw new Error('Study tree is busy in another host process; retry the edit.');
        await delay(CONFIG.lockRetryMs);
      }
    }
  }

  /** Args: lock: Our lock path. Remove only an old lease whose process is proven absent. */
  private async removeDeadLock(lock: string): Promise<void> {
    try {
      if (Date.now() - (await stat(lock)).mtimeMs < CONFIG.lockStaleMs) return;
      const owner = JSON.parse(await readFile(lock, 'utf8'));
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return;
      try { process.kill(owner.pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') await unlink(lock); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
}
