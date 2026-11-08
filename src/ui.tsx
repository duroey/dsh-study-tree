import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { CONFIG } from './config.ts';
import type { StudyViewSnapshot } from './contracts.ts';
import { ancestors, visibleRows, type StudyDropTarget, type StudyNode, type StudyTree } from './tree.ts';
import { useTreeDrag } from './use-tree-drag.ts';

/** UI actions remain structural so no host or controller implementation is bundled twice. */
export interface StudyUiController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StudyViewSnapshot;
  toggleEnabled(): void;
  run(task: () => Promise<unknown>): void;
  clearError(): void;
  reload(): Promise<void>;
  navigate(id: string): Promise<void>;
  toggleNode(id: string): Promise<void>;
  addCurrent(): Promise<void>;
  attachExisting(id: string, parentId: string | null): Promise<void>;
  editNode(id: string, title: string, parentId: string | null): Promise<void>;
  relocate(id: string, drop: StudyDropTarget): Promise<void>;
  detach(id: string): Promise<void>;
  returnToSource(): Promise<void>;
  toggleHistory(): void;
  recoverFork(): Promise<void>;
  setDialog(value?: 'attach' | string): void;
  expandSelection(): void;
  dismissSelection(): void;
  fork(question: string, title?: string): Promise<void>;
  newBranch(): Promise<void>;
  setDraftQuestion(question: string): void;
  submitDraft(): Promise<void>;
  cancelDraft(returnToChat?: boolean, token?: number): void;
  setCurrent(id: string, running?: boolean): void;
}

interface ControllerProps { controller: StudyUiController }
interface NativeActions { dismiss?: () => void; clearSelection?: () => void }

/**
 * Renders the learning navigation alongside the host's unchanged chat surface.
 *
 * Args:
 *   controller: Shared navigation and fork controller.
 *
 * Returns:
 *   The tree, legacy selection UI, dialogs, and actionable error feedback.
 */
export function StudyOverlay({ controller }: ControllerProps): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return <>
    <button type="button" className="study-tree-scrim" data-study-open={state.enabled}
      aria-label="收起学习导航" aria-hidden={!state.enabled} tabIndex={-1}
      disabled={!state.enabled} onClick={() => controller.toggleEnabled()} />
    <StudyNavigation controller={controller} state={state} />
    {state.draft?.presentation === 'overlay' && <div className="study-legacy-draft"><StudyDraftPage controller={controller} /></div>}
    {state.selection && !state.nativeSelection && <LegacySelection controller={controller} state={state} />}
    {state.dialog === 'attach' && <AttachDialog controller={controller} state={state} />}
    {state.dialog && state.dialog !== 'attach' && <ManageDialog key={state.dialog} controller={controller} state={state} id={state.dialog} />}
    {state.error && <div className="dsh-study-ui study-error" role="alert" data-study-plugin="error">
      <span>{state.error}</span>
      {state.pendingFork && !state.enabled && <button type="button" className="study-button study-button-primary" disabled={state.busy} onClick={() => controller.run(() => controller.recoverFork())}>恢复这个分支</button>}
      <button type="button" className="study-icon-button" aria-label="关闭错误提示" onClick={() => controller.clearError()}><Icon name="close" /></button>
    </div>}
  </>;
}

/**
 * Bridges the host's session-scoped header into the learning navigation.
 *
 * Args:
 *   controller: Shared plugin controller.
 *   sessionId: The session currently rendered by DSH.
 *   useSession: Optional host selector hook for current running state.
 *
 * Returns:
 *   A compact learning-mode toggle in the normal session header.
 */
export function StudyHeaderAction({ controller, sessionId, useSession }: ControllerProps & {
  sessionId: string;
  useSession?: (selector: (snapshot: Record<string, unknown>) => boolean) => boolean;
}): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const running = useSession ? useSession((snapshot) => snapshot.running === true) : undefined;
  useEffect(() => { controller.setCurrent(sessionId, running); }, [controller, sessionId, running]);
  return <button type="button" className={`dsh-study-ui study-header-toggle${state.enabled ? ' is-active' : ''}`}
    data-study-plugin="header" data-study-current-session={sessionId}
    aria-label={state.enabled ? '收起学习导航' : '打开学习导航'} aria-pressed={state.enabled}
    title={state.enabled ? '收起学习导航' : '打开学习导航'} onClick={() => controller.toggleEnabled()}>
    <Icon name="tree" /><span>学习</span>
  </button>;
}

/**
 * Shows the current session's navigable learning path in the host header.
 *
 * Args:
 *   controller: Shared plugin controller.
 *   sessionId: Session whose normal conversation is displayed.
 *
 * Returns:
 *   A breadcrumb path, or nothing outside learning mode or the learning tree.
 */
export function StudyLineage({ controller, sessionId }: ControllerProps & { sessionId: string }): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (!state.enabled || !state.tree.nodes.some((node) => node.id === sessionId)) return null;
  const path = ancestors(state.tree, sessionId);
  return <nav className="dsh-study-ui study-lineage" aria-label="当前学习路径" data-study-plugin="lineage">
    {path.map((node, index) => <span className="study-lineage-part" key={node.id}>
      {index > 0 && <Icon name="chevron" />}
      {index === path.length - 1
        ? <span className="study-lineage-current" aria-current="page" title={node.title}>{node.title}</span>
        : <button type="button" title={node.title} disabled={state.busy} onClick={() => controller.run(() => controller.navigate(node.id))}>{node.title}</button>}
    </span>)}
  </nav>;
}

/**
 * Supplies the latest DSH text-interaction surface with an ordinary fork form.
 *
 * Args:
 *   controller: Shared plugin controller with the captured source.
 *   dismiss: Host action closing its positioned interaction surface.
 *   clearSelection: Host action clearing the consumed browser selection.
 *
 * Returns:
 *   Non-positioned content; the latest DSH owns the popover geometry.
 */
export function NativeForkSurface({ controller, dismiss, clearSelection }: ControllerProps & NativeActions): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (!state.selection) return null;
  return <ForkContent key={selectionKey(state)} controller={controller} state={state} dismiss={dismiss} clearSelection={clearSelection} />;
}

/**
 * Renders one session per navigation row and source actions below the tree.
 *
 * Args:
 *   controller: Shared plugin controller.
 *   state: Stable current view snapshot.
 *
 * Returns:
 *   A resident left drawer, preserving its reading position during both transitions.
 */
function StudyNavigation({ controller, state }: ControllerProps & { state: StudyViewSnapshot }): ReactNode {
  const navigation = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useTreeDrag(state.tree, !state.loaded || !state.enabled || state.busy, viewport,
    (id, drop) => controller.relocate(id, drop));
  useLayoutEffect(() => {
    const drawer = navigation.current;
    if (!drawer) return;
    if (!state.enabled && drawer.contains(document.activeElement)) {
      (document.querySelector<HTMLElement>('[data-study-plugin="header"]')
        ?? document.querySelector<HTMLElement>('[data-study-draft-toggle]'))?.focus();
    }
    // Set inert through the DOM property for both React 18 and React 19 hosts.
    drawer.inert = !state.enabled;
    drawer.setAttribute('aria-hidden', String(!state.enabled));
  }, [state.enabled]);
  const draftPath = new Set(state.draft && state.tree.nodes.some(node => node.id === state.draft!.parentId)
    ? ancestors(state.tree, state.draft.parentId).map(node => node.id) : []);
  const rows = visibleRows(state.draft ? { ...state.tree, nodes: state.tree.nodes.map(node => draftPath.has(node.id) ? { ...node, collapsed: false } : node) } : state.tree);
  let dropAnchorId = drag.target?.id;
  const targetRow = rows.findIndex(row => row.node.id === drag.target?.id);
  if (drag.target?.position === 'after' && targetRow >= 0) {
    for (let index = targetRow + 1; index < rows.length && rows[index]!.depth > rows[targetRow]!.depth; index += 1) {
      dropAnchorId = rows[index]!.node.id;
    }
  }
  const dropDepth = rows[targetRow]?.depth ?? 0;
  const dropAfterDraft = drag.target?.position === 'after' && Boolean(state.draft) && state.draft?.parentId === dropAnchorId;
  const topicCount = state.tree.nodes.filter((node) => node.parentId === null).length;
  const active = state.tree.nodes.find((node) => node.id === state.currentId);
  const currentOutsideTree = Boolean(state.currentId && !active);
  return <aside ref={navigation} className="dsh-study-ui study-navigation" aria-label="学习导航"
    data-study-plugin="navigation" data-study-open={state.enabled}
    data-study-sorting={Boolean(drag.sourceId)} onClickCapture={drag.captureClick}>
    <header className="study-navigation-header">
      <div className="study-navigation-title"><Icon name="tree" /><span>学习导航</span></div>
      <button type="button" className="study-icon-button" aria-label="收起学习导航" title="收起学习导航" onClick={() => controller.toggleEnabled()}><Icon name="collapse" /></button>
    </header>
    <button type="button" className="study-new-branch" disabled={!state.loaded || !state.currentId || state.busy || Boolean(state.pendingFork)}
      title="从当前会话继承上下文，打开新的子分支对话"
      onClick={() => controller.run(() => controller.newBranch())}>
      <Icon name="plus" /><span>新开对话</span><small>当前会话下</small>
    </button>
    <div className="study-tree-heading">
      <span>{topicCount === 0 ? '学习主题' : `${topicCount} 个主题 · ${state.tree.nodes.length} 个会话`}</span>
      <NavigationManagement controller={controller} state={state} />
    </div>
    <div ref={viewport} className="study-tree-body" onDragStart={event => event.preventDefault()}>
      {state.pendingFork && <div className="study-recovery" role="status">
        <p>分支已创建，等待恢复</p>
        <span title={state.pendingFork.title}>{state.pendingFork.title}</span>
        <button type="button" className="study-button study-button-primary" disabled={state.busy} onClick={() => controller.run(() => controller.recoverFork())}>恢复这个分支</button>
      </div>}
      {!state.loaded ? <p className="study-empty-copy" role="status">正在读取学习导航…</p>
        : rows.length === 0 ? <div className="study-empty">
          <p className="study-empty-title">从一个会话开始学习</p>
          <p className="study-empty-copy">以当前会话为起点，划词展开的分支会留在同一个学习主题中。</p>
          <button type="button" className="study-button study-button-primary" disabled={!state.currentId || state.busy} onClick={() => controller.run(() => controller.addCurrent())}>以当前会话开始</button>
        </div> : <div role="tree" aria-label="学习会话树" className="study-tree-list">
          {rows.map((row, index) => <div key={row.node.id} className="study-tree-entry"><div role="treeitem"
            aria-label={row.node.title} aria-level={row.depth + 1} aria-selected={!state.draft && row.node.id === state.currentId}
            aria-expanded={row.hasChildren ? !row.node.collapsed : undefined}
            aria-disabled={state.busy || undefined}
            tabIndex={!state.draft && (row.node.id === state.currentId || (!active && index === 0)) ? 0 : -1}
            className={`study-tree-row${row.node.parentId === null ? ' is-topic' : ''}${!state.draft && row.node.id === state.currentId ? ' is-active' : ''}`}
            style={{ '--study-depth': row.depth, '--study-drop-depth': dropDepth } as React.CSSProperties}
            data-study-node-id={row.node.id} title={row.node.title}
            data-study-dragging={drag.sourceId === row.node.id || undefined}
            data-study-drop={drag.target && !dropAfterDraft && dropAnchorId === row.node.id ? drag.target.position : undefined}
            data-study-drop-for={drag.target && !dropAfterDraft && dropAnchorId === row.node.id ? drag.target.id : undefined}
            onPointerDown={event => drag.start(event, row.node.id)}
            onClick={() => { if (!state.busy) controller.run(() => controller.navigate(row.node.id)); }}
            onKeyDown={(event) => treeKey(event, row.node, rows.map((item) => item.node), controller, state.busy || Boolean(drag.sourceId))}>
            <span className="study-drag-handle" aria-hidden="true" title="拖动调整同一父节点下的顺序"><Icon name="grip" /></span>
            <span className="study-tree-indent" aria-hidden="true">{Array.from({ length: row.depth }, (_, depth) => <i key={depth} />)}</span>
            {row.hasChildren ? <button type="button" tabIndex={-1} className={`study-tree-chevron${row.node.collapsed ? '' : ' is-open'}`}
              aria-label={`${row.node.collapsed ? '展开' : '收起'}“${row.node.title}”`} disabled={state.busy || draftPath.has(row.node.id)} onClick={(event) => { event.stopPropagation(); controller.run(() => controller.toggleNode(row.node.id)); }}><Icon name="chevron" /></button>
              : <span className="study-tree-leaf" aria-hidden="true"><i /></span>}
            <span className="study-tree-label">{row.node.title}</span>
            {row.node.parentId === null
              ? <span className="study-node-kind" title="此根会话及其所有分支组成一个学习主题">主题</span>
              : !row.node.source && !row.node.origin && <span className="study-node-kind" title="仅加入导航，沿用该会话原有的 Agent 上下文">关联</span>}
            {state.runningIds.includes(row.node.id) && <span className="study-running" title="正在回答" aria-label="正在回答" />}
            <button type="button" className="study-icon-button study-node-menu" aria-label={`管理“${row.node.title}”`} title="管理会话节点" disabled={state.busy} onClick={(event) => { event.stopPropagation(); controller.setDialog(row.node.id); }}><Icon name="more" /></button>
          </div>{state.draft?.parentId === row.node.id && <DraftTreeRow controller={controller} depth={row.depth + 1} busy={state.busy}
            dropAfter={dropAfterDraft && dropAnchorId === row.node.id} dropDepth={dropDepth} />}</div>)}
        </div>}
      {state.loaded && currentOutsideTree && rows.length > 0 && <button type="button" className="study-add-current" disabled={state.busy} onClick={() => controller.run(() => controller.addCurrent())}><Icon name="plus" />以当前会话开始新主题</button>}
    </div>
    {drag.sourceId && <div ref={drag.previewRef} className="study-drag-preview" aria-hidden="true"><Icon name="grip" /><span>{state.tree.nodes.find(node => node.id === drag.sourceId)?.title}</span></div>}
    <div className="study-drag-status" role="status" aria-live="polite" title={drag.hint || undefined}>{drag.hint || '拖动分支可调整同级顺序'}</div>
    <footer className="study-navigation-footer">
      {active?.source || active?.origin ? <>
        <div className="study-source-caption">{active.source ? '从这里展开' : '继承自来源会话'}</div>
        {active.source ? <blockquote className="study-source-quote" title={active.source.quote}>{active.source.quote}</blockquote>
          : <p className="study-origin-title">{state.tree.nodes.find((node) => node.id === active.origin!.sessionId)?.title
            ?? state.catalog.find((node) => node.id === active.origin!.sessionId)?.title ?? '原会话'}</p>}
        <button type="button" className="study-source-return" disabled={state.busy} onClick={() => controller.run(() => controller.returnToSource())}><Icon name="return" />{active.source ? '回到原文' : '回到来源会话'}</button>
        {(active.source?.seq ?? active.origin?.seq) !== undefined && <button type="button" className={`study-history-toggle${state.historyOpen ? ' is-active' : ''}`} aria-pressed={state.historyOpen} onClick={() => controller.toggleHistory()}><Icon name="history" />{state.historyOpen ? '收起继承对话' : '查看继承对话'}<Icon name="chevron" /></button>}
      </> : <p className="study-navigation-hint">选中回答中的文字，<br />从一个问题继续深入。</p>}
    </footer>
  </aside>;
}

/** Args: controller: Draft actions. depth: Temporary hierarchy. busy: Submission state. dropAfter: Sibling line after the draft. dropDepth: Sibling indentation. Returns: An unsaved index row. */
function DraftTreeRow({ controller, depth, busy, dropAfter, dropDepth }: ControllerProps & {
  depth: number; busy: boolean; dropAfter: boolean; dropDepth: number;
}): ReactNode {
  return <div role="treeitem" aria-label="新对话，未发送" aria-level={depth + 1} aria-selected="true" tabIndex={0}
    className="study-tree-row study-draft-row is-active" data-study-plugin="draft-node"
    data-study-drop={dropAfter ? 'after' : undefined} style={{ '--study-drop-depth': dropDepth } as React.CSSProperties}
    onClick={() => document.querySelector<HTMLTextAreaElement>('[data-study-draft-input]')?.focus()}>
    <span className="study-drag-handle" aria-hidden="true" />
    <span className="study-tree-indent" aria-hidden="true">{Array.from({ length: depth }, (_, index) => <i key={index} />)}</span>
    <span className="study-tree-leaf" aria-hidden="true"><Icon name="plus" /></span>
    <span className="study-tree-label">新对话</span><span className="study-node-kind">未发送</span>
    <button type="button" className="study-icon-button" aria-label="取消新对话" disabled={busy} onClick={event => { event.stopPropagation(); controller.cancelDraft(); }}><Icon name="close" /></button>
  </div>;
}

/**
 * Renders an unsent conversation in the public root main slot, without a Session.
 *
 * Args:
 *   controller: Draft lifecycle and first-message submission actions.
 *
 * Returns:
 *   A temporary full conversation page; sent messages continue in native chat.
 */
export function StudyDraftPage({ controller }: ControllerProps): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const draft = state.draft;
  const mounted = useRef(false);
  useEffect(() => {
    if (!draft) { controller.cancelDraft(); return; }
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current) controller.cancelDraft(false, draft.token); });
    };
  }, [controller, draft?.token]);
  if (!draft) return null;
  const parentTitle = state.tree.nodes.find(node => node.id === draft.parentId)?.title
    ?? state.catalog.find(node => node.id === draft.parentId)?.title ?? '当前会话';
  const submit = (event: FormEvent): void => { event.preventDefault(); if (!state.busy && draft.question.trim()) controller.run(() => controller.submitDraft()); };
  return <section className="dsh-study-ui study-draft-page" data-study-plugin="draft" aria-label="新对话草稿">
    <header className="study-draft-header"><strong>新对话</strong><div className="study-draft-header-actions">
      <button type="button" className="study-header-toggle" data-study-draft-toggle aria-label={state.enabled ? '收起学习导航' : '打开学习导航'} aria-pressed={state.enabled} onClick={() => controller.toggleEnabled()}><Icon name="tree" /><span>学习</span></button>
      <button type="button" className="study-text-button" disabled={state.busy} onClick={() => controller.cancelDraft()}>取消</button></div></header>
    <div className="study-draft-intro"><Icon name="fork" /><h1>从「{parentTitle}」继续</h1><p>沿用这段对话的背景，问一个新的问题。</p></div>
    <form className="study-draft-composer" onSubmit={submit}>
      <label className="study-sr-status" htmlFor="study-draft-question">你的问题</label>
      <textarea id="study-draft-question" data-study-draft-input value={draft.question} autoFocus rows={3}
        placeholder="写下突然想到的问题…" onChange={event => controller.setDraftQuestion(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey && !state.busy && draft.question.trim()) { event.preventDefault(); controller.run(() => controller.submitDraft()); }
        }} />
      <div className="study-draft-composer-footer"><span>未发送的对话不会保留</span><button type="submit" className="study-button study-button-primary" disabled={state.busy || !draft.question.trim()}>{state.busy ? '正在发送…' : '发送'}</button></div>
    </form>
  </section>;
}

/**
 * Keeps occasional navigation maintenance out of the learning path.
 *
 * Args:
 *   controller: Existing navigation actions without a separate project model.
 *   state: Load and mutation state used to gate menu actions.
 *
 * Returns:
 *   A keyboard-accessible menu that releases focus normally on outside clicks.
 */
function NavigationManagement({ controller, state }: ControllerProps & { state: StudyViewSnapshot }): ReactNode {
  const [open, setOpen] = useState(false);
  const reference = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (!open) return;
    const items = reference.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    (focusLast.current ? items?.item(items.length - 1) : items?.item(0))?.focus();
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !reference.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = (): void => { setOpen(false); trigger.current?.focus(); };
  const keydown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (!open) { focusLast.current = event.key === 'ArrowUp' || event.key === 'End'; setOpen(true); return; }
    const items = [...reference.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return <div ref={reference} className="study-management" onKeyDown={keydown}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="study-icon-button" aria-label="学习导航管理" title="管理"
      aria-haspopup="menu" aria-expanded={open} disabled={!state.loaded || state.busy} onClick={() => { focusLast.current = false; setOpen(!open); }}><Icon name="more" /></button>
    {open && <div role="menu" aria-label="学习导航管理" className="study-management-menu">
      <button type="button" role="menuitem" disabled={state.busy} onClick={() => { close(); controller.setDialog('attach'); }}><Icon name="plus" />关联已有会话</button>
      <button type="button" role="menuitem" disabled={state.busy} onClick={() => { close(); controller.run(() => controller.reload()); }}><Icon name="refresh" />刷新学习导航</button>
    </div>}
  </div>;
}

/**
 * Supplies predictable keyboard movement across the flat accessible tree.
 *
 * Args:
 *   event: Tree row key event.
 *   node: Focused session node.
 *   rows: Currently visible sessions in display order.
 *   controller: Shared navigation controller.
 *   busy: Whether a host mutation is already in progress.
 */
function treeKey(event: KeyboardEvent<HTMLDivElement>, node: StudyNode, rows: StudyNode[], controller: StudyUiController, busy: boolean): void {
  if (event.target !== event.currentTarget) return;
  if (busy) return;
  const index = rows.findIndex((item) => item.id === node.id);
  let target: StudyNode | undefined;
  if (event.key === 'ArrowDown') target = rows[Math.min(index + 1, rows.length - 1)];
  else if (event.key === 'ArrowUp') target = rows[Math.max(0, index - 1)];
  else if (event.key === 'Home') target = rows[0];
  else if (event.key === 'End') target = rows.at(-1);
  else if (event.key === 'ArrowRight' && node.collapsed) controller.run(() => controller.toggleNode(node.id));
  else if (event.key === 'ArrowRight') target = rows.find((item) => item.parentId === node.id);
  else if (event.key === 'ArrowLeft' && !node.collapsed && rows.some((item) => item.parentId === node.id)) controller.run(() => controller.toggleNode(node.id));
  else if (event.key === 'ArrowLeft') target = rows.find((item) => item.id === node.parentId);
  else if (event.key === 'Enter' || event.key === ' ') controller.run(() => controller.navigate(node.id));
  else return;
  event.preventDefault();
  if (target) [...event.currentTarget.parentElement!.querySelectorAll<HTMLElement>('[data-study-node-id]')]
    .find((element) => element.dataset.studyNodeId === target!.id)?.focus();
}

/**
 * Places the compatibility selection surface within the browser viewport.
 *
 * Args:
 *   controller: Shared plugin controller.
 *   state: View state containing the original browser selection rectangle.
 *
 * Returns:
 *   A small fixed toolbar or expanded form for older DSH versions.
 */
function LegacySelection({ controller, state }: ControllerProps & { state: StudyViewSnapshot }): ReactNode {
  const rect = state.selection!.rect;
  const width = state.selectionExpanded ? 360 : 180;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - (state.selectionExpanded ? 370 : 44) - 8));
  return <div className="dsh-study-ui study-legacy-selection" data-study-plugin="selection" style={{ left, top }}>
    <ForkContent key={selectionKey(state)} controller={controller} state={state} />
  </div>;
}

/**
 * Renders the shared action and fork form without owning its positioning.
 *
 * Args:
 *   controller: Shared plugin controller.
 *   state: Stable view snapshot.
 *   dismiss: Optional native surface dismissal.
 *   clearSelection: Optional native selection consumption.
 *
 * Returns:
 *   A compact action, or a form for a named session branch and question.
 */
function ForkContent({ controller, state, dismiss, clearSelection }: ControllerProps & NativeActions & { state: StudyViewSnapshot }): ReactNode {
  const [title, setTitle] = useState(() => Array.from(state.selection!.source.quote.trim().replace(/\s+/gu, ' ')).slice(0, CONFIG.titleLength).join(''));
  const [question, setQuestion] = useState('');
  const close = (): void => { controller.dismissSelection(); dismiss?.(); };
  if (!state.selectionExpanded) return <div className="dsh-study-ui study-selection-action" data-study-plugin="selection" role="toolbar" aria-label="学习分支操作">
    <button type="button" className="study-selection-expand" onMouseDown={(event) => event.preventDefault()} onClick={() => controller.expandSelection()}><Icon name="fork" />深入了解</button>
    <button type="button" className="study-icon-button" aria-label="关闭分支操作" onClick={close}><Icon name="close" /></button>
  </div>;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (state.busy || !question.trim()) return;
    controller.run(async () => { await controller.fork(question.trim(), title.trim() || undefined); clearSelection?.(); dismiss?.(); });
  };
  return <form className="dsh-study-ui study-fork-form" data-study-plugin="selection" aria-label="创建学习分支" onSubmit={submit}>
    <div className="study-form-heading"><span><Icon name="fork" />展开一个问题</span><button type="button" className="study-icon-button" aria-label="关闭分支操作" onClick={close}><Icon name="close" /></button></div>
    <blockquote className="study-fork-quote">{state.selection!.source.quote}</blockquote>
    <label className="study-field"><span>分支名称</span><input name="branchTitle" value={title} maxLength={CONFIG.titleLength} onChange={(event) => setTitle(event.target.value)} autoComplete="off" /></label>
    <label className="study-field"><span>想进一步了解什么？</span><textarea name="question" rows={3} autoFocus required value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="从这里继续问一个问题…" /></label>
    <div className="study-form-actions"><button type="button" className="study-button" onClick={close}>取消</button><button type="submit" className="study-button study-button-primary" disabled={state.busy || !question.trim()}>{state.busy ? '正在创建…' : '创建分支'}</button></div>
  </form>;
}

/**
 * Links an existing real session into the learning navigation.
 *
 * Args:
 *   controller: Shared plugin controller.
 *   state: Available session catalog and current navigation tree.
 *
 * Returns:
 *   An accessible association dialog without copying conversation contents.
 */
function AttachDialog({ controller, state }: ControllerProps & { state: StudyViewSnapshot }): ReactNode {
  const available = state.catalog.filter((item) => !state.tree.nodes.some((node) => node.id === item.id));
  const [sessionId, setSessionId] = useState(() => available.find((item) => item.id === state.currentId)?.id ?? available[0]?.id ?? '');
  const [parentId, setParentId] = useState(() => state.tree.nodes.some((node) => node.id === state.currentId) ? state.currentId! : '');
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, controller);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (state.busy || !sessionId) return;
    controller.run(async () => { await controller.attachExisting(sessionId, parentId || null); controller.setDialog(); });
  };
  return <DialogShell controller={controller} reference={ref} title="关联已有会话" titleId="study-attach-title">
    <form onSubmit={submit}>
      <p className="study-dialog-description">仅加入导航，上下文保持原样。划词 fork 才会继承分叉位置之前的对话。</p>
      {available.length > 0 ? <>
        <label className="study-field"><span>已有会话</span><select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>{available.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <label className="study-field"><span>放在导航的哪个位置？</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">作为新学习主题的起点</option>{state.tree.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
      </> : <p className="study-empty-copy">目前的会话都已加入学习树。可以先在 DSH 中打开另一个会话。</p>}
      <div className="study-form-actions"><button type="button" className="study-button" onClick={() => controller.setDialog()}>取消</button><button type="submit" className="study-button study-button-primary" disabled={!sessionId || state.busy}>仅加入导航</button></div>
    </form>
  </DialogShell>;
}

/**
 * Edits a navigation title or parent while keeping fork provenance intact.
 *
 * Args:
 *   controller: Shared plugin controller.
 *   state: Current tree and busy state.
 *   id: Navigation node to manage.
 *
 * Returns:
 *   A small management dialog with an explicitly scoped detach action.
 */
function ManageDialog({ controller, state, id }: ControllerProps & { state: StudyViewSnapshot; id: string }): ReactNode {
  const node = state.tree.nodes.find((item) => item.id === id);
  const [title, setTitle] = useState(node?.title ?? '');
  const [parentId, setParentId] = useState(node?.parentId ?? '');
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, controller);
  const excluded = descendants(state.tree, id);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (state.busy || !title.trim()) return;
    controller.run(async () => { await controller.editNode(id, title.trim(), parentId || null); controller.setDialog(); });
  };
  return <DialogShell controller={controller} reference={ref} title="管理会话节点" titleId="study-manage-title">
    {node ? <form onSubmit={submit}>
      <label className="study-field"><span>会话名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={CONFIG.titleLength} autoComplete="off" /></label>
      <label className="study-field"><span>导航位置</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">作为学习主题的起点</option>{state.tree.nodes.filter((item) => !excluded.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <p className="study-dialog-description">调整导航位置时，会话原有上下文和 fork 来源保持原样。</p>
      <div className="study-detach-area"><button type="button" className="study-text-button study-detach" disabled={state.busy} onClick={() => controller.run(async () => { await controller.detach(id); controller.setDialog(); })}>移出学习树</button><p>此节点及子分支将移出导航，聊天记录仍保留。</p></div>
      <div className="study-form-actions"><button type="button" className="study-button" onClick={() => controller.setDialog()}>取消</button><button type="submit" className="study-button study-button-primary" disabled={state.busy || !title.trim()}>保存</button></div>
    </form> : <><p className="study-dialog-description">这个会话已不在学习树中。</p><button type="button" className="study-button" onClick={() => controller.setDialog()}>关闭</button></>}
  </DialogShell>;
}

/**
 * Provides shared modal geometry and an explicit heading.
 *
 * Args:
 *   controller: Controller used for dismissal.
 *   reference: Focus-trap reference to the modal's content.
 *   title: Human-readable dialog title.
 *   titleId: Stable heading identity for assistive technology.
 *   children: Form content.
 *
 * Returns:
 *   A dismissible modal isolated from the conversation underneath.
 */
function DialogShell({ controller, reference, title, titleId, children }: ControllerProps & {
  reference: RefObject<HTMLDivElement>; title: string; titleId: string; children: ReactNode;
}): ReactNode {
  return <div className="dsh-study-ui study-modal-scrim" data-study-plugin="dialog" onMouseDown={(event) => { if (event.target === event.currentTarget) controller.setDialog(); }}>
    <div ref={reference} className="study-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="study-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="study-icon-button" aria-label="关闭对话框" onClick={() => controller.setDialog()}><Icon name="close" /></button></div>
      {children}
    </div>
  </div>;
}

/**
 * Keeps keyboard focus inside a modal and restores it on dismissal.
 *
 * Args:
 *   reference: Modal content ref.
 *   controller: Stable dismissal controller.
 */
function useDialogFocus(reference: RefObject<HTMLDivElement>, controller: StudyUiController): void {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = (): HTMLElement[] => [...(reference.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
    const frame = window.requestAnimationFrame(() => (reference.current?.querySelector<HTMLElement>('input, select, textarea') ?? focusable()[0])?.focus());
    const keydown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); controller.setDialog(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, [controller, reference]);
}

/**
 * Builds an exclusion set for reparenting without recursive traversal.
 *
 * Args:
 *   tree: Current navigation tree.
 *   id: Managed session.
 *
 * Returns:
 *   The node and all descendants, which cannot become its new parent.
 */
function descendants(tree: StudyTree, id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of tree.nodes) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  const excluded = new Set<string>();
  const pending = [id];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (excluded.has(current)) continue;
    excluded.add(current);
    pending.push(...(children.get(current) ?? []));
  }
  return excluded;
}

/**
 * Identifies one captured passage so form drafts reset only for a new source.
 *
 * Args:
 *   state: Snapshot containing the selected source.
 *
 * Returns:
 *   An opaque React key independent of the entered question.
 */
function selectionKey(state: StudyViewSnapshot): string {
  const source = state.selection?.source;
  return JSON.stringify([source?.sessionId, source?.seq, source?.quote]);
}

/**
 * Draws a consistent small line icon without adding an icon dependency.
 *
 * Args:
 *   name: Navigation or action symbol.
 *
 * Returns:
 *   Decorative SVG; its owning control supplies the accessible name.
 */
function Icon({ name }: { name: 'tree' | 'close' | 'collapse' | 'chevron' | 'plus' | 'refresh' | 'more' | 'return' | 'history' | 'fork' | 'grip' }): ReactNode {
  const paths: Record<typeof name, ReactNode> = {
    tree: <><path d="M5 4v12a3 3 0 0 0 3 3h7M5 10h10" /><circle cx="5" cy="3" r="1.5" /><circle cx="17" cy="10" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    collapse: <><path d="M9 4H5v16h4M17 7l-5 5 5 5" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    grip: <><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" strokeWidth="3" /></>,
    refresh: <><path d="M19 10a7 7 0 1 0 0 5M19 5v5h-5" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    return: <><path d="m9 5-5 5 5 5M4 10h10a5 5 0 0 1 0 10" /></>,
    history: <><path d="M5 4h13v16H5zM8 8h7M8 12h7M8 16h4" /></>,
    fork: <><path d="M6 20V7M6 13h6a6 6 0 0 0 6-6V4M3 7l3-3 3 3M15 7l3-3 3 3" /></>,
  };
  return <svg className="study-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
