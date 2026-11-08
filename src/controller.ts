import { DshAdapter } from './compat.ts';
import { CONFIG } from './config.ts';
import { attachSession, detachBranch, emptyTree, moveNode, parseTree, relocateBranch } from './tree.ts';
import type { StudyDropTarget, StudyNode, StudyOrigin, StudySource, StudyTree } from './tree.ts';
import { captureScrollPosition, restoreScrollPosition, restoreSource } from './selection.ts';
import type { CapturedStudySelection } from './selection.ts';
import type { PluginContext, StudyViewSnapshot } from './contracts.ts';
import { initialBranchTitle } from './naming.ts';

type PendingFork = { id: string; title: string; promptAttempted: boolean } & (
  { source: StudySource; question: string; origin?: never }
  | { origin: StudyOrigin; source?: never; question?: string }
);
interface ViewPreferences { enabled?: boolean; currentId?: string; positions?: Record<string, number>; pendingFork?: PendingFork }
interface RpcResult<T> { ok: boolean; value?: T; error?: { code: string; message: string } }

/** Coordinate a navigation index while all conversation execution stays in DSH. */
export class StudyController {
  readonly adapter: DshAdapter;
  private readonly ctx: PluginContext;
  private readonly listeners = new Set<() => void>();
  private state: StudyViewSnapshot;
  private revision = 0;
  private positions: Record<string, number> = {};
  private pendingFork?: PendingFork;
  private disposed = false;
  private mutationTimer: ReturnType<typeof setTimeout> | undefined;
  private restoring = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private draftVersion = 0;
  private readonly titleRequests = new Set<string>();

  /** Args: ctx: Public injected host/client services for this plugin instance. */
  constructor(ctx: PluginContext) {
    this.ctx = ctx;
    this.adapter = new DshAdapter(ctx);
    const preferences = this.readPreferences();
    this.positions = preferences.positions ?? {};
    this.pendingFork = preferences.pendingFork;
    this.state = { tree: emptyTree(), catalog: [], loaded: false, busy: false, enabled: preferences.enabled ?? true,
      currentId: preferences.currentId, selectionExpanded: false, nativeSelection: false, historyOpen: false, runningIds: [],
      pendingFork: this.pendingFork ? { id: this.pendingFork.id, title: this.pendingFork.title } : undefined };
  }

  /** Returns: The identity-stable snapshot used by React external-store hooks. */
  getSnapshot = (): StudyViewSnapshot => this.state;

  /** Args: listener: React invalidation callback. Returns: Its independent cleanup. */
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  /** Start observations and restore the host-owned navigation snapshot. */
  start(): () => void {
    const unsubscribe = this.adapter.subscribe(() => this.refreshCatalog());
    const observer = new MutationObserver(() => this.scheduleDisplay());
    observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
    const onUnload = (): void => this.savePosition();
    window.addEventListener('pagehide', onUnload);
    this.applyDisplay();
    this.run(() => this.reload());
    return () => {
      this.savePosition(); this.disposed = true; unsubscribe(); observer.disconnect();
      window.removeEventListener('pagehide', onUnload);
      for (const timer of this.timers) clearTimeout(timer);
      if (this.mutationTimer) clearTimeout(this.mutationTimer);
      document.documentElement.classList.remove('dsh-study-tree-selection');
      this.clearInheritedPresentation(); this.listeners.clear();
    };
  }

  /** Args: task: One user action whose failure must remain visible. */
  run(task: () => Promise<unknown>): void {
    void task().catch(error => { if (!this.disposed) this.update({ error: error instanceof Error ? error.message : String(error) }); });
  }

  /** Re-read persistent relationships without creating or opening conversations. */
  async reload(): Promise<void> {
    const saved = await this.rpc('read', {});
    this.revision = saved.revision;
    this.update({ tree: parseTree(saved.tree), loaded: true, error: undefined });
    this.refreshCatalog();
    this.applyDisplay();
  }

  /** Clear an acknowledged error without modifying saved navigation. */
  clearError(): void { this.update({ error: undefined }); }

  /** Toggle only the navigation pane; selection and conversation state stay usable. */
  toggleEnabled(): void {
    this.savePosition();
    this.update({ enabled: !this.state.enabled, selection: undefined });
    this.persistPreferences(); this.applyDisplay();
  }

  /** Args: id: Main Conversation identity. running: Host-reported execution state. */
  setCurrent(id: string, running?: boolean): void {
    if (this.disposed) return;
    const changed = this.state.currentId !== id;
    const runningIds = running === undefined ? this.state.runningIds : running
      ? [...new Set([...this.state.runningIds, id])] : this.state.runningIds.filter(item => item !== id);
    if (changed || runningIds.join() !== this.state.runningIds.join()) {
      this.update({ currentId: id, runningIds, ...(changed ? { selection: undefined, historyOpen: false, draft: undefined } : {}) });
      this.persistPreferences(); this.scheduleDisplay();
      if (changed) { this.titleRequests.delete(id); this.refreshCatalog(); }
    }
  }

  /** Args: selection: A safely captured completed-turn source. native: Use the host popover. */
  setSelection(selection: CapturedStudySelection, native: boolean): void {
    if (!this.state.loaded || this.state.busy) return;
    this.update({ selection, nativeSelection: native, selectionExpanded: false });
  }

  /** Show the question editor for a captured source. */
  expandSelection(): void { this.update({ selectionExpanded: true }); }

  /**
   * Closes study UI while preserving selections and carets owned by host editors.
   *
   * Repeated native mouseup/keyup events are no-ops when no study UI is active.
   * Browser selection consumption belongs to the host's explicit fork action.
   */
  dismissSelection(): void {
    if (!this.state.selection && !this.state.selectionExpanded) return;
    this.update({ selection: undefined, selectionExpanded: false });
  }

  /** Args: dialog: Existing-session picker or one navigation node to manage. */
  setDialog(dialog?: string): void { this.refreshCatalog(); this.update({ dialog }); }

  /** Add the current host Conversation as a new learning root. */
  async addCurrent(): Promise<void> {
    const id = this.state.currentId;
    if (!id) throw new Error('先打开一个会话，再加入学习树。');
    if (this.state.tree.nodes.some(node => node.id === id)) return;
    await this.attachExisting(id, null);
  }

  /** Args: id: Existing DSH Session. parentId: Navigation parent or a new root. */
  async attachExisting(id: string, parentId: string | null): Promise<void> {
    this.assertAvailable();
    const item = this.adapter.catalog().find(entry => entry.id === id);
    if (!item) throw new Error('这个会话暂时不可用，请刷新会话列表。');
    await this.saveTree(attachSession(this.state.tree, { id, parentId, title: item.title, createdAt: Date.now() }));
    this.update({ dialog: undefined });
  }

  /** Args: id: Node to edit. title: Display title. parentId: Its chosen navigation parent. */
  async editNode(id: string, title: string, parentId: string | null): Promise<void> {
    this.assertAvailable();
    const node = this.state.tree.nodes.find(entry => entry.id === id);
    if (!node) throw new Error('找不到这个学习分支。');
    const normalized = title.trim().slice(0, CONFIG.titleLength);
    if (!normalized) throw new Error('请填写分支名称。');
    const moved = moveNode(this.state.tree, id, parentId);
    if (normalized !== node.title) { await this.adapter.rename(id, normalized); this.refreshCatalog(); }
    await this.saveTree(attachSession(moved, { ...node, title: this.adapter.catalog().find(item => item.id === id)?.title ?? normalized, parentId }));
    this.update({ dialog: undefined });
  }

  /** Args: id: Branch to sort. drop: Same-parent edge, revalidated before writing. */
  async relocate(id: string, drop: StudyDropTarget): Promise<void> {
    this.assertAvailable();
    const tree = relocateBranch(this.state.tree, id, drop);
    if (tree.nodes.every((node, index) => node.id === this.state.tree.nodes[index]?.id)) return;
    this.update({ busy: true, error: undefined });
    try { await this.saveTree(tree); }
    finally { this.update({ busy: false }); }
  }

  /** Args: id: Navigation branch to detach. Recorded DSH Sessions are retained. */
  async detach(id: string): Promise<void> {
    this.assertAvailable();
    await this.saveTree(detachBranch(this.state.tree, id));
    this.update({ dialog: undefined });
  }

  /** Args: id: Node whose descendants should expand or collapse. */
  async toggleNode(id: string): Promise<void> {
    this.assertAvailable();
    const node = this.state.tree.nodes.find(entry => entry.id === id);
    if (node) await this.saveTree(attachSession(this.state.tree, { ...node, collapsed: !node.collapsed }));
  }

  /** Args: id: Real host Session to display in its normal chat surface. */
  async navigate(id: string): Promise<void> {
    if (this.state.draft) this.cancelDraft(false);
    this.savePosition();
    const generation = ++this.restoring;
    await this.adapter.open(id);
    this.setCurrent(id);
    const top = this.positions[id];
    if (top !== undefined) this.afterHistory(id, generation, () => { restoreScrollPosition(top); return true; });
  }

  /**
   * Create a contextual child and send the user's question to its normal Agent.
   *
   * Args:
   *   question: New user turn, appended after the inherited prefix.
   *   title: Optional short navigation label.
   */
  async fork(question: string, title?: string): Promise<void> {
    const capture = this.state.selection;
    if (!capture) throw new Error('请重新选中一段已完成的回答。');
    if (!question.trim()) throw new Error('请写下想进一步了解的问题。');
    if (this.state.busy) throw new Error('正在创建分支，请稍候。');
    if (this.pendingFork) throw new Error('还有一个已创建的分支等待恢复，请先点击「恢复这个分支」。');
    this.update({ busy: true, error: undefined });
    const parentId = capture.source.sessionId;
    this.savePosition();
    let childId: string | undefined;
    try {
      if (!this.state.tree.nodes.some(node => node.id === parentId)) {
        const item = this.adapter.catalog().find(entry => entry.id === parentId);
        await this.saveTree(attachSession(this.state.tree, { id: parentId, parentId: null, title: item?.title ?? '学习主题', createdAt: Date.now() }));
      }
      childId = await this.adapter.fork(capture.source);
      const label = (title?.trim() || capture.source.quote).replace(/\s+/g, ' ').slice(0, CONFIG.titleLength);
      this.pendingFork = { id: childId, title: label, source: capture.source, question: question.trim(), promptAttempted: false };
      this.update({ pendingFork: { id: childId, title: label } }); this.persistPreferences();
      await this.finishPendingFork();
    } catch (error) {
      // A successful Host fork remains a real, recoverable Session even if a later step fails.
      if (childId) {
        await this.adapter.open(childId).catch(() => undefined);
        this.setCurrent(childId);
      }
      throw error;
    } finally { this.update({ busy: false }); }
  }

  /**
   * Opens an in-memory draft without creating a host session or a navigation node.
   * The completed source boundary is frozen before the first message is sent.
   */
  async newBranch(): Promise<void> {
    this.assertAvailable();
    if (this.state.draft) return;
    const parentId = this.state.currentId;
    if (!parentId) throw new Error('先打开一个会话，再新开学习分支。');
    if (this.pendingFork) throw new Error('还有一个已创建的分支等待恢复，请先点击「恢复这个分支」。');
    this.update({ busy: true, error: undefined });
    this.savePosition();
    const origin: StudyOrigin = { sessionId: parentId, scrollTop: this.positions[parentId] };
    const token = ++this.draftVersion;
    try {
      origin.seq = await this.adapter.completedTurnEnd(parentId);
      if (token !== this.draftVersion || this.state.currentId !== parentId) return;
      this.update({ draft: { token, parentId, origin, question: '', presentation: this.adapter.draftPresentation() },
        enabled: window.innerWidth < CONFIG.narrowWidth ? false : this.state.enabled, selection: undefined });
      this.persistPreferences();
      this.adapter.showDraft(true);
    } finally { this.update({ busy: false }); }
  }

  /** Args: question: Unsent text, held only in the temporary page's memory. */
  setDraftQuestion(question: string): void {
    if (this.state.draft) this.update({ draft: { ...this.state.draft, question } });
  }

  /** Args: returnToChat: Restore native chat on explicit cancellation. token: Ignore stale page cleanup. */
  cancelDraft(returnToChat = true, token?: number): void {
    if (token !== undefined && this.state.draft?.token !== token) return;
    this.draftVersion += 1;
    this.update({ draft: undefined });
    if (returnToChat) {
      this.adapter.showDraft(false);
      const id = this.state.currentId;
      const top = id ? this.positions[id] : undefined;
      if (id && top !== undefined) this.afterHistory(id, ++this.restoring, () => { restoreScrollPosition(top); return true; });
    }
  }

  /** Materialize the draft once the user explicitly sends its first question. */
  async submitDraft(): Promise<void> {
    this.assertAvailable();
    const draft = this.state.draft;
    if (!draft?.question.trim()) throw new Error('请先写下想了解的问题。');
    if (this.pendingFork) throw new Error('请先恢复已经创建的学习分支。');
    const question = draft.question.trim();
    const title = initialBranchTitle(question);
    this.update({ busy: true, error: undefined });
    let childId: string | undefined;
    try {
      await this.adapter.fork(draft.origin, (id) => {
        childId = id;
        this.pendingFork = { id, title, origin: draft.origin, question, promptAttempted: false };
        this.update({ draft: undefined, pendingFork: { id, title } }); this.persistPreferences();
      });
      await this.finishPendingFork();
    } catch (error) {
      if (childId) {
        await this.adapter.open(childId).catch(() => undefined);
        this.setCurrent(childId);
      }
      throw error;
    } finally { this.update({ busy: false }); }
  }

  /** Resume an already created child after an interrupted navigation/save operation. */
  async recoverFork(): Promise<void> {
    this.assertAvailable();
    if (!this.pendingFork) return;
    this.update({ busy: true, error: undefined });
    try { await this.finishPendingFork(true); }
    finally { this.update({ busy: false }); }
  }

  /** Args: recovering: Reuse the existing child without guessing legacy inherited boundaries. */
  private async finishPendingFork(recovering = false): Promise<void> {
    const pending = this.pendingFork;
    if (!pending) return;
    const provenance = pending.source ?? pending.origin;
    const parentId = provenance.sessionId;
    if (pending.origin && pending.origin.seq === undefined) {
      pending.origin.seq = await this.adapter.inheritedTurnEnd(pending.id, !recovering);
      this.persistPreferences();
    }
    let tree = this.state.tree;
    const parent = tree.nodes.find(node => node.id === parentId);
    tree = attachSession(tree, parent ? { ...parent, collapsed: false } : {
      id: parentId, parentId: null, title: this.adapter.catalog().find(entry => entry.id === parentId)?.title ?? '学习主题', createdAt: Date.now(),
    });
    tree = attachSession(tree, { id: pending.id, parentId, title: pending.title,
      ...(pending.source ? { source: pending.source } : { origin: pending.origin }), createdAt: Date.now() });
    await this.saveTree(tree);
    this.dismissSelection();
    await this.adapter.open(pending.id); this.setCurrent(pending.id);
    await this.adapter.rename(pending.id, pending.title);
    if (pending.source || pending.question) {
      if (!pending.promptAttempted) {
        pending.promptAttempted = true; this.persistPreferences();
        await this.adapter.prompt(pending.id, pending.source ? `关于刚才回答中的「${pending.source.quote}」：\n\n${pending.question}` : pending.question!);
        if (pending.origin) this.requestTitle(pending.id);
      } else {
        this.update({ error: '已恢复这个分支。请在聊天中确认上一条问题是否已发送，再继续提问。' });
      }
    }
    this.pendingFork = undefined; this.update({ pendingFork: undefined }); this.persistPreferences();
    this.afterHistory(pending.id, ++this.restoring, () => { this.applyDisplay(); return true; });
  }

  /** Return to the saved parent passage and visibly locate the selected text. */
  async returnToSource(): Promise<void> {
    const node = this.currentNode();
    const source = node?.source ?? node?.origin;
    if (!source) return;
    await this.navigate(source.sessionId);
    this.update({ historyOpen: true });
    this.applyDisplay();
    if (node?.source) this.afterHistory(source.sessionId, ++this.restoring, () => restoreSource(node.source!), true);
    else if (source.scrollTop !== undefined) this.afterHistory(source.sessionId, ++this.restoring, () => { restoreScrollPosition(source.scrollTop!); return true; });
  }

  /** Reversibly show or fold the history inherited by the current fork. */
  toggleHistory(): void { this.update({ historyOpen: !this.state.historyOpen }); this.applyDisplay(); }

  /** Returns: The selected learning node, if this Session belongs to the index. */
  private currentNode(): StudyNode | undefined { return this.state.tree.nodes.find(node => node.id === this.state.currentId); }

  /** Reject a conflicting edit while a host operation is being completed. */
  private assertAvailable(): void { if (this.state.busy) throw new Error('正在创建学习分支或保存位置，请稍后再操作。'); }

  /** Args: partial: Changed view fields. Publish exactly one new stable snapshot. */
  private update(partial: Partial<StudyViewSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...partial };
    document.documentElement.classList.toggle('dsh-study-tree-selection', Boolean(this.state.selection && !this.state.nativeSelection));
    for (const listener of this.listeners) listener();
  }

  /** Refresh titles and identities without retaining conversation histories. */
  private refreshCatalog(): void {
    try {
      const catalog = this.adapter.catalog();
      this.update({ catalog, tree: this.projectTitles(this.state.tree, catalog) });
      const byId = new Map(catalog.map(item => [item.id, item]));
      for (const node of this.state.tree.nodes) {
        const native = byId.get(node.id);
        const parent = node.origin ? byId.get(node.origin.sessionId) : undefined;
        if (node.origin && native && (native.title === '新想法' || native.title === parent?.title)) this.requestTitle(node.id);
      }
    }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); }
  }

  /** Args: tree: Complete new relationships. Save before reporting the edit accepted. */
  private async saveTree(tree: StudyTree): Promise<void> {
    if (!this.state.loaded) throw new Error('学习树还在载入，请稍候。');
    try {
      const saved = await this.rpc('write', { tree, revision: this.revision });
      this.revision = saved.revision;
      this.update({ tree: this.projectTitles(parseTree(saved.tree), this.state.catalog) }); this.applyDisplay();
    } catch (error) {
      if (error instanceof Error && error.message.includes('conflict')) {
        await this.reload();
        throw new Error('另一窗口更新了学习树，已载入最新版本，请再试一次。');
      }
      throw error;
    }
  }

  /** Args: endpoint: Read/write operation. payload: JSON-only validated navigation. */
  private async rpc<T = { revision: number; tree: unknown }>(endpoint: string, payload: unknown): Promise<T> {
    const connection = this.ctx.get('connection');
    const signal = AbortSignal.timeout(CONFIG.requestTimeoutMs);
    const response = await fetch(`./api/study-tree/${endpoint}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal,
    });
    let result: RpcResult<T>;
    if (response.status === 404 || response.status === 405) {
      result = await connection.rpc.call(CONFIG.rpcNamespace, endpoint, payload, signal) as RpcResult<T>;
    } else {
      if (!response.ok) throw new Error(`学习树保存通道返回 HTTP ${response.status}。`);
      result = await response.json() as RpcResult<T>;
    }
    if (!result.ok || !result.value) throw new Error(result.error ? `${result.error.code}: ${result.error.message}` : '无法保存学习树，请检查 DSH 连接。');
    return result.value;
  }

  /** Read browser-only view preferences, independently from durable Host data. */
  private readPreferences(): ViewPreferences {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.browserKey) ?? '{}') as ViewPreferences;
      const positions: Record<string, number> = {};
      if (saved.positions && typeof saved.positions === 'object') for (const [id, top] of Object.entries(saved.positions)) {
        if (Number.isFinite(top) && top >= 0) positions[id] = top;
      }
      return { enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
        currentId: typeof saved.currentId === 'string' ? saved.currentId : undefined, positions,
        pendingFork: this.parsePendingFork(saved.pendingFork) };
    } catch { return {}; }
  }

  /** Args: value: Browser receipt. Returns: A validated legacy or no-prompt fork receipt. */
  private parsePendingFork(value: PendingFork | undefined): PendingFork | undefined {
    if (!value || typeof value.id !== 'string' || typeof value.title !== 'string') return undefined;
    if (!value.origin && (typeof value.question !== 'string' || !value.source)) return undefined;
    const tree = parseTree({ schemaVersion: 1, nodes: [{ id: value.id, parentId: null, title: value.title,
      createdAt: 0, source: value.source, origin: value.origin }] });
    const node = tree.nodes[0]!;
    return node.source
      ? { id: node.id, title: node.title, source: node.source, question: value.question!, promptAttempted: value.promptAttempted === true }
      : { id: node.id, title: node.title, origin: node.origin!, question: typeof value.question === 'string' ? value.question : undefined, promptAttempted: value.promptAttempted === true };
  }

  /** Args: tree: Persisted relationships. catalog: Native title authority. Returns: A synchronized view. */
  private projectTitles(tree: StudyTree, catalog: StudyViewSnapshot['catalog']): StudyTree {
    const titles = new Map(catalog.map(item => [item.id, item.title]));
    return { ...tree, nodes: tree.nodes.map(node => ({ ...node, title: titles.get(node.id) ?? node.title })) };
  }

  /** Args: id: A submitted fork. attempt: Bounded wait for the native message commit. */
  private requestTitle(id: string, attempt = 0): void {
    if (this.disposed || (attempt === 0 && this.titleRequests.has(id))) return;
    this.titleRequests.add(id);
    void this.rpc<{ ready: boolean }>('title', { id }).then(result => {
      if (result.ready === false && attempt < CONFIG.titleRetryLimit) {
        const timer = setTimeout(() => { this.timers.delete(timer); this.requestTitle(id, attempt + 1); }, CONFIG.titleRetryMs);
        this.timers.add(timer);
      } else this.refreshCatalog();
    }).catch(error => {
      if (!this.disposed) this.update({ error: `对话已发送，暂用首条消息作为标题。自动起标题失败：${error instanceof Error ? error.message : String(error)}` });
    });
  }

  /** Persist a bounded UI preference snapshot; relationship data is stored by Host RPC. */
  private persistPreferences(): void {
    const ids = new Set(this.state.tree.nodes.map(node => node.id));
    const positions = Object.fromEntries(Object.entries(this.positions).filter(([id]) => ids.has(id)));
    try { localStorage.setItem(CONFIG.browserKey, JSON.stringify({ enabled: this.state.enabled, currentId: this.state.currentId, positions, pendingFork: this.pendingFork })); }
    catch (error) { this.update({ error: `阅读位置未保存：${error instanceof Error ? error.message : String(error)}` }); }
  }

  /** Save the current main chat scroll position before changing its selection. */
  private savePosition(): void {
    if (this.state.currentId) this.positions[this.state.currentId] = captureScrollPosition();
    this.persistPreferences();
  }

  /** Coalesce chat DOM updates without unbounded observers or polling. */
  private scheduleDisplay(): void {
    if (this.mutationTimer || this.disposed) return;
    this.mutationTimer = setTimeout(() => { this.mutationTimer = undefined; this.applyDisplay(); }, CONFIG.positionDelayMs);
  }

  /** Restore all inherited chat rows when leaving the learning presentation. */
  private clearInheritedPresentation(): void {
    document.querySelectorAll<HTMLElement>('[data-study-inherited]').forEach(element => { delete element.dataset.studyInherited; });
  }

  /** Fold a copied prefix visually while preserving every recorded Host event. */
  private applyDisplay(): void {
    this.clearInheritedPresentation();
    const node = this.currentNode();
    const source = node?.source ?? node?.origin;
    if (this.state.historyOpen || source?.seq === undefined) return;
    const markers = [...document.querySelectorAll<HTMLElement>('[data-study-turn-end]')];
    const boundary = markers.find(marker => marker.dataset.studySessionId === this.state.currentId
      && (Number(marker.dataset.studyTurnEnd) === source.seq || Number(marker.dataset.studySourceSeq) === source.seq));
    const tail = boundary?.closest<HTMLElement>('[data-chat-flow-kind="turn-tail"]');
    if (!tail?.parentElement) return;
    for (const row of [...tail.parentElement.children]) {
      if (row instanceof HTMLElement && row.hasAttribute('data-chat-flow-kind')) row.dataset.studyInherited = 'true';
      if (row === tail) break;
    }
  }

  /** Args: id: Expected Session. generation: Navigation guard. restore: Safe DOM restoration attempt. */
  private afterHistory(id: string, generation: number, restore: () => boolean, reportFailure = false): void {
    const deadline = Date.now() + CONFIG.restoreTimeoutMs;
    const attempt = (): void => {
      if (this.disposed || generation !== this.restoring || this.state.currentId !== id) return;
      const ready = [...document.querySelectorAll<HTMLElement>('[data-study-session-id]')].some(marker => marker.dataset.studySessionId === id);
      if (ready && restore()) return;
      if (Date.now() >= deadline) { if (reportFailure) this.update({ error: '已打开原会话，但原文位置暂时无法唯一定位。' }); return; }
      const timer = setTimeout(() => { this.timers.delete(timer); attempt(); }, CONFIG.positionDelayMs);
      this.timers.add(timer);
    };
    const timer = setTimeout(() => { this.timers.delete(timer); attempt(); }, CONFIG.positionDelayMs);
    this.timers.add(timer);
  }
}
