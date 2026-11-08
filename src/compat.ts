import type { StudyOrigin, StudySource } from './tree.ts';
import { CONFIG } from './config.ts';

/** The minimum observable contract shared by old and current DSH clients. */
interface ObservableSource<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/** Host-owned session metadata; conversation content is deliberately absent. */
interface CatalogSnapshot {
  ids?: readonly string[];
  byId: Record<string, {
    id?: string;
    title?: string;
    displayTitle?: string;
    cwd?: string;
  }>;
}

/** A result returned by DSH's existing authenticated transport. */
interface OperationResult {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string };
}

/** Session capabilities used by the plugin without importing a DSH runtime. */
export interface DshSession {
  getSnapshot(): unknown;
  subscribe(listener: () => void): () => void;
  open?(): Promise<void> | void;
  prompt?(
    content: Array<{ type: 'text'; text: string }>,
    mode: 'queue',
  ): Promise<OperationResult>;
  rename?(title: string): Promise<OperationResult>;
}

/** A borrowed DSH binding whose lifetime remains owned by its client. */
export interface DshBinding {
  session: DshSession;
  [key: string]: unknown;
}

/** A current-client reference must be released even when opening fails. */
interface SessionReference {
  ready: Promise<DshBinding>;
  release(): void;
}

/** Only public service capabilities are checked, never package versions. */
interface SessionsService {
  list?: ObservableSource<CatalogSnapshot>;
  open?(id: string): Promise<void> | void;
  binding?(id: string): DshBinding | undefined;
  retain?(id: string, options: { source: string }): SessionReference;
  fork?(options: {
    sessionId: string;
    atSeq?: number;
    increaseTitle: false;
    onCreated?: (id: string) => void;
  }): Promise<string>;
}

/** A metadata projection suitable for choosing an existing session. */
export interface DshCatalogEntry {
  id: string;
  title: string;
  cwd?: string;
}

/** Capability diagnostics can be shown without guessing future version support. */
export interface DshCompatibility {
  navigation: string;
  ownership: string;
  fork: boolean;
}

/**
 * Adapts public DSH services across the runtime split and reference lifecycle.
 *
 * Args:
 *   ctx: The plugin's injected Cordis context or a structural test double.
 *
 * Throws:
 *   Error: If the context has no sessions service.
 */
export class DshAdapter {
  private readonly context: Record<string, unknown>;

  constructor(ctx: unknown) {
    if (!isRecord(ctx)) throw new Error('DSH adapter requires a plugin context.');
    this.context = ctx;
    this.sessions();
  }

  /**
   * Projects the host catalog without materializing session histories.
   *
   * Returns:
   *   Session identities and human-readable titles in host catalog order.
   *
   * Throws:
   *   Error: If the running DSH exposes no readable session catalog.
   */
  catalog(): DshCatalogEntry[] {
    const list = this.sessions().list;
    if (typeof list?.getSnapshot !== 'function') {
      throw new Error('DSH session catalog is unavailable: sessions.list.getSnapshot is required.');
    }
    const snapshot = list.getSnapshot();
    if (!isRecord(snapshot) || !isRecord(snapshot.byId)) {
      throw new Error('DSH session catalog is invalid: expected a byId metadata map.');
    }
    const ids = Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(snapshot.byId);
    const entries: DshCatalogEntry[] = [];
    for (const id of ids) {
      const row = snapshot.byId[id];
      if (!row) continue;
      const title = nonblank(row.title) ?? nonblank(row.displayTitle) ?? id;
      entries.push({ id, title, ...(typeof row.cwd === 'string' ? { cwd: row.cwd } : {}) });
    }
    return entries;
  }

  /**
   * Subscribes to host catalog changes without opening any conversation.
   *
   * Args:
   *   listener: Callback invoked when host session metadata changes.
   *
   * Returns:
   *   The host-owned subscription disposer.
   */
  subscribe(listener: () => void): () => void {
    const list = this.sessions().list;
    if (typeof list?.subscribe !== 'function') {
      throw new Error('DSH session catalog is not observable: sessions.list.subscribe is required.');
    }
    return list.subscribe(listener);
  }

  /**
   * Opens a real session in DSH's normal conversation surface.
   *
   * Args:
   *   id: A known host session identity.
   *
   * Throws:
   *   Error: If neither current nor legacy navigation is available.
   */
  async open(id: string): Promise<void> {
    requireText(id, 'session id');
    const workspace = this.service('uiWorkspace');
    if (isRecord(workspace) && typeof workspace.openSession === 'function') {
      await workspace.openSession(id);
      return;
    }
    const sessions = this.sessions();
    if (typeof sessions.open !== 'function') {
      throw new Error(`Cannot open DSH session "${id}": uiWorkspace.openSession or sessions.open is required.`);
    }
    await sessions.open(id);
    const layout = this.service('layout');
    if (isRecord(layout) && typeof layout.selectPanel === 'function') {
      layout.selectPanel(null);
    }
  }

  /** Args: open: Select the registered temporary page, or return to native chat. */
  showDraft(open: boolean): void {
    const layout = this.service('layout');
    if (isRecord(layout) && typeof layout.selectPanel === 'function') layout.selectPanel(open ? CONFIG.draftPanel : null);
  }

  /** Returns: The public main-panel path, or the legacy root overlay fallback. */
  draftPresentation(): 'panel' | 'overlay' {
    const layout = this.service('layout');
    return isRecord(layout) && typeof layout.selectPanel === 'function' ? 'panel' : 'overlay';
  }

  /** Args: id: Parent session. Returns: Latest available completed-turn anchor for a draft. */
  async completedTurnEnd(id: string): Promise<number | undefined> {
    return this.usingSession(id, (binding) => {
      const source = binding.eventSource;
      if (isRecord(source) && typeof source.getSnapshot === 'function') {
        const window = source.getSnapshot();
        if (!isRecord(window) || !Array.isArray(window.entries)) return undefined;
        let end: number | undefined;
        for (const entry of window.entries) {
          const event = isRecord(entry) && entry.type === 'event' && isRecord(entry.event) ? entry.event : undefined;
          if (event?.type === 'turn/end' && Number.isSafeInteger(event.seq) && (event.seq as number) >= 0) end = event.seq as number;
        }
        return end;
      }
      const snapshot = binding.session.getSnapshot();
      let end: number | undefined;
      if (isRecord(snapshot) && snapshot.turnEnds instanceof Map) for (const seq of snapshot.turnEnds.values()) {
        if (Number.isSafeInteger(seq) && seq >= 0 && (end === undefined || seq > end)) end = seq;
      }
      return end;
    });
  }

  /**
   * Borrows a session only for the duration of one operation.
   *
   * Args:
   *   id: Session identity to borrow.
   *   operation: Work that settles before the borrowed reference is released.
   *
   * Returns:
   *   The operation's result.
   *
   * Throws:
   *   Error: If the host cannot supply a usable session binding.
   */
  async usingSession<T>(id: string, operation: (binding: DshBinding) => T | Promise<T>): Promise<T> {
    requireText(id, 'session id');
    const sessions = this.sessions();
    if (typeof sessions.retain === 'function') {
      const reference = sessions.retain(id, { source: 'studyTreeOperation' });
      if (!reference || typeof reference.release !== 'function') {
        throw new Error(`Cannot retain DSH session "${id}": invalid session reference.`);
      }
      try {
        const binding = await reference.ready;
        requireBinding(binding, id);
        return await operation(binding);
      } finally {
        reference.release();
      }
    }
    if (typeof sessions.binding !== 'function') {
      throw new Error(`Cannot borrow DSH session "${id}": sessions.retain or sessions.binding is required.`);
    }
    let binding = sessions.binding(id);
    if (!binding && typeof sessions.open === 'function') {
      await sessions.open(id);
      binding = sessions.binding(id);
    }
    requireBinding(binding, id);
    if (typeof binding.session.open === 'function') await binding.session.open();
    return await operation(binding);
  }

  /**
   * Forks inherited history through the host's own session API.
   *
   * Args:
   *   source: Parent session; omit seq to use the host's completed-prefix default.
   *   onCreated: Optional receipt persisted as soon as the host exposes the identity.
   *
   * Returns:
   *   The real child session identity supplied by DSH.
   *
   * Throws:
   *   Error: If fork is unavailable or the host rejects the selected boundary.
   */
  async fork(source: StudyOrigin | StudySource, onCreated?: (id: string) => void): Promise<string> {
    requireText(source.sessionId, 'source session id');
    if (source.seq !== undefined && (!Number.isSafeInteger(source.seq) || source.seq < 0)) {
      throw new Error('Cannot fork DSH session: source sequence must be a nonnegative safe integer.');
    }
    const sessions = this.sessions();
    if (typeof sessions.fork !== 'function') {
      throw new Error('This DSH version does not expose sessions.fork; a history-preserving branch cannot be created.');
    }
    let received: string | undefined;
    const record = (id: string): void => {
      requireText(id, 'forked session id');
      if (received === id) return;
      if (received) throw new Error('DSH returned inconsistent fork identities.');
      received = id; onCreated?.(id);
    };
    let id: string;
    try {
      id = await sessions.fork({ sessionId: source.sessionId, atSeq: source.seq,
        increaseTitle: false, ...(onCreated ? { onCreated: record } : {}) });
    } catch (error) {
      // A workspace attachment failure can occur after the real child was committed.
      const failure = isRecord(error) && isRecord(error.rpcError) ? error.rpcError : undefined;
      if (onCreated && failure?.code === 'workspace-attach-failed' && isRecord(failure.details)
        && typeof failure.details.sessionId === 'string') record(failure.details.sessionId);
      throw error;
    }
    requireText(id, 'forked session id');
    record(id);
    return id;
  }

  /**
   * Reads the last completed inherited turn for presentation, never for fork truncation.
   *
   * Args:
   *   id: Newly forked child whose local prompt has not been sent yet.
   *   allowLegacySnapshot: False during recovery, when child-local turns may exist.
   *
   * Returns:
   *   An available completed-turn anchor, or undefined for an unknown public shape.
   */
  async inheritedTurnEnd(id: string, allowLegacySnapshot = true): Promise<number | undefined> {
    return this.usingSession(id, (binding) => {
      const source = binding.eventSource;
      if (isRecord(source) && typeof source.getSnapshot === 'function') {
        const window = source.getSnapshot();
        if (!isRecord(window) || !Array.isArray(window.entries)) return undefined;
        let end: number | undefined;
        let inherited: number | undefined;
        for (const entry of window.entries) {
          if (!isRecord(entry) || entry.type !== 'event' || !isRecord(entry.event)) continue;
          const event = entry.event;
          if (!Number.isSafeInteger(event.seq) || (event.seq as number) < 0) continue;
          if (event.type === 'turn/end') end = event.seq as number;
          if (event.type === 'session/end-seed' && isRecord(event.data) && event.data.inherited === true) inherited = end;
        }
        return inherited;
      }
      if (!allowLegacySnapshot) return undefined;
      const snapshot = binding.session.getSnapshot();
      if (!isRecord(snapshot) || !(snapshot.turnEnds instanceof Map)) return undefined;
      let end: number | undefined;
      for (const value of snapshot.turnEnds.values()) {
        if (Number.isSafeInteger(value) && value >= 0 && (end === undefined || value > end)) end = value;
      }
      return end;
    });
  }

  /**
   * Renames the real session so ordinary DSH navigation shares its title.
   *
   * Args:
   *   id: Session identity to rename.
   *   title: Nonempty user-facing title.
   */
  async rename(id: string, title: string): Promise<void> {
    requireText(title, 'session title');
    await this.usingSession(id, async ({ session }) => {
      if (typeof session.rename !== 'function') {
        throw new Error(`Cannot rename DSH session "${id}": session.rename is unavailable.`);
      }
      assertSuccess(await session.rename(title), `Rename DSH session "${id}"`);
    });
  }

  /**
   * Submits a branch question to its persistent real session.
   *
   * Args:
   *   id: Session receiving the question.
   *   text: User question to append without rewriting inherited history.
   *
   * Throws:
   *   Error: If the host refuses admission or exposes no prompt capability.
   */
  async prompt(id: string, text: string): Promise<void> {
    requireText(text, 'question');
    await this.usingSession(id, async ({ session }) => {
      if (typeof session.prompt !== 'function') {
        throw new Error(`Cannot prompt DSH session "${id}": session.prompt is unavailable.`);
      }
      const result = await session.prompt([{ type: 'text', text }], 'queue');
      assertSuccess(result, `Prompt DSH session "${id}"`);
      if (!isRecord(result.value) || result.value.accepted !== true) {
        throw new Error(`Prompt DSH session "${id}" returned no admission receipt.`);
      }
    });
  }

  /**
   * Describes detected capabilities instead of claiming untested compatibility.
   *
   * Returns:
   *   The public navigation, ownership, and fork capabilities currently present.
   */
  describe(): DshCompatibility {
    const sessions = this.sessions();
    const workspace = this.service('uiWorkspace');
    return {
      navigation: isRecord(workspace) && typeof workspace.openSession === 'function'
        ? 'uiWorkspace.openSession'
        : typeof sessions.open === 'function' ? 'sessions.open' : 'unavailable',
      ownership: typeof sessions.retain === 'function'
        ? 'sessions.retain'
        : typeof sessions.binding === 'function' ? 'sessions.binding' : 'unavailable',
      fork: typeof sessions.fork === 'function',
    };
  }

  /**
   * Resolves live services through either Cordis context access shape.
   *
   * Args:
   *   name: Public service key.
   *
   * Returns:
   *   The currently injected service, or undefined when unavailable.
   */
  private service(name: string): unknown {
    // Optional, version-specific services must not trigger Cordis' required-inject getter.
    if (typeof this.context.get === 'function') return this.context.get(name);
    return this.context[name];
  }

  /**
   * Resolves the live sessions service without holding a stale HMR instance.
   *
   * Returns:
   *   The running client's public sessions face.
   *
   * Throws:
   *   Error: If the sessions service is not injected.
   */
  private sessions(): SessionsService {
    const service = this.service('sessions');
    if (!isRecord(service)) throw new Error('DSH sessions service is unavailable; enable the plugin in a Web profile.');
    return service as SessionsService;
  }
}

/**
 * Checks object presence while permitting real service class instances.
 *
 * Args:
 *   value: A context, service, result, or snapshot to inspect.
 *
 * Returns:
 *   Whether property access is valid on an object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Selects a nonempty host title without changing its spelling.
 *
 * Args:
 *   value: Optional catalog title.
 *
 * Returns:
 *   The original nonempty string or undefined.
 */
function nonblank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Rejects invalid identities and questions before making a host call.
 *
 * Args:
 *   value: Required string.
 *   name: User-facing field name for diagnostics.
 */
function requireText(value: unknown, name: string): asserts value is string {
  if (nonblank(value) === undefined) throw new Error(`DSH ${name} must be a nonempty string.`);
}

/**
 * Checks that a borrowed binding contains its host-owned session.
 *
 * Args:
 *   binding: Candidate binding supplied by the running client.
 *   id: Identity included in an unavailable-binding diagnostic.
 */
function requireBinding(binding: unknown, id: string): asserts binding is DshBinding {
  if (!isRecord(binding) || !isRecord(binding.session)) {
    throw new Error(`DSH session "${id}" has no live binding after opening.`);
  }
}

/**
 * Preserves host refusal codes instead of reporting false completion.
 *
 * Args:
 *   result: RPC result returned by a session operation.
 *   operation: Operation and session identity for diagnostics.
 *
 * Throws:
 *   Error: If the result is missing or reports failure.
 */
function assertSuccess(result: unknown, operation: string): asserts result is OperationResult {
  if (!isRecord(result) || typeof result.ok !== 'boolean') {
    throw new Error(`${operation} returned an invalid DSH result.`);
  }
  if (result.ok) return;
  const error = isRecord(result.error) ? result.error : {};
  const code = nonblank(error.code) ?? 'unknown';
  const message = nonblank(error.message) ?? 'The host rejected the operation.';
  throw new Error(`${operation} failed (${code}): ${message}`);
}
