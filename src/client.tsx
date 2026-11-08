import { StudyController } from './controller.ts';
import { captureSelection } from './selection.ts';
import type { PluginContext } from './contracts.ts';
import { StudyHeaderAction, StudyOverlay, NativeForkSurface, StudyDraftPage } from './ui.tsx';
import { CONFIG } from './config.ts';
import { installStyles } from './styles.ts';

export const inject = ['slots', 'sessions', 'connection', 'layout'];

/** Register a strict complete-turn marker for safe fork boundaries on both hosts. */
function TurnBoundaryMarker({ seq, sessionId, turn }: { seq: number; sessionId: string; turn?: { end?: { seq: number } } }) {
  return <span data-study-turn-end={turn?.end?.seq ?? seq} data-study-source-seq={seq} data-study-session-id={sessionId} aria-hidden="true" />;
}

/** Read the legacy public completed-turn projection without replacing its chain slot. */
function LegacyTurnMarker({ sessionId, messageId, useSession }: {
  sessionId: string; messageId: string; useSession: (selector: (snapshot: any) => number | undefined) => number | undefined;
}) {
  const assistantSeq = useSession(snapshot => snapshot.nodes?.find((node: any) => node.kind === 'assistant' && node.messageId === messageId)?.seq);
  const endSeq = useSession(snapshot => {
    const node = snapshot.nodes?.find((item: any) => item.kind === 'assistant' && item.messageId === messageId);
    return node ? snapshot.turnEnds?.get(node.turn) : undefined;
  });
  return endSeq === undefined ? null : <span data-study-turn-end={endSeq} data-study-source-seq={assistantSeq} data-study-session-id={sessionId} aria-hidden="true" />;
}

/**
 * Mount the study navigation next to the native DSH Conversation.
 *
 * Args:
 *   ctx: Browser plugin context, provided by the running DSH version.
 */
export function apply(ctx: PluginContext): void {
  const controller = new StudyController(ctx);
  ctx.effect(() => installStyles(), 'study-tree: theme');
  ctx.effect(() => controller.start(), 'study-tree: state and navigation');
  const register = (name: string, component: unknown, options: Record<string, unknown> = {}): void => {
    ctx.slots.inject(name, () => ctx.slots.register({ name, id: `study-tree:${name}`, order: 80,
      inject: () => ({ controller }), ...options }, component));
  };
  register('shell.overlay', StudyOverlay);
  if (controller.adapter.draftPresentation() === 'panel') register('main', StudyDraftPage, { key: CONFIG.draftPanel });
  register('conversation.session.header.actions', StudyHeaderAction);
  ctx.slots.inject('conversation.chat.turnTail', () => {
    if (ctx.slots.spec?.('conversation.chat.turnTail')?.kind === 'chain') {
      register('conversation.chat.assistant-actions', LegacyTurnMarker);
      return;
    }
    return ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'study-tree:turn-boundary', order: 80 }, TurnBoundaryMarker);
  });
  let nativeActive = false;
  // Wait for the service, rather than taking a one-time snapshot during concurrent boot.
  ctx.inject(['uiConversation'], (scope) => {
    const interactions = scope.get('uiConversation')?.interactions;
    if (typeof interactions?.register !== 'function') return;
    scope.slots.inject('conversation.chat.text-interaction', () => scope.slots.register({
      name: 'conversation.chat.text-interaction', key: 'dsh-study-tree',
      inject: () => ({ controller }),
    }, NativeForkSurface));
    const unregister = interactions.register({ id: 'dsh-study-tree', onInteraction(request: {
      sessionId: string; hasSelection: boolean; open(): void; preventDefault(): void;
    }) {
      if (!request.hasSelection) return;
      const selection = captureSelection(window.getSelection(), request.sessionId);
      if (!selection) return;
      controller.setSelection(selection, true); request.preventDefault(); request.open();
    } });
    nativeActive = true;
    scope.effect(() => () => { nativeActive = false; unregister(); }, 'study-tree: official text interaction');
  });
  ctx.effect(() => {
      const onSelection = (event: Event): void => {
        if ((event.target as Element | null)?.closest?.('[data-study-plugin]')) return;
        const snapshot = controller.getSnapshot();
        if (snapshot.selectionExpanded) return;
        // An earlier native consumer may have claimed the gesture (e.g. stock quote).
        // Keep the compatibility action available without replacing native registrations.
        if (nativeActive && snapshot.selection && snapshot.nativeSelection) return;
        const captured = captureSelection(window.getSelection(), snapshot.currentId);
        if (captured) controller.setSelection(captured, false);
        else controller.dismissSelection();
      };
      document.addEventListener('mouseup', onSelection);
      document.addEventListener('keyup', onSelection);
      return () => { document.removeEventListener('mouseup', onSelection); document.removeEventListener('keyup', onSelection); };
  }, 'study-tree: legacy text interaction');
  // A single scoped marker owns DOM session identity; no deprecated list.current reads.
  ctx.effect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') controller.dismissSelection(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, 'study-tree: keyboard dismissal');
}
