import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { CONFIG } from './config.ts';
import { dragActivated, scrollVelocity, siblingDrop, type DragPoint } from './drag.ts';
import type { StudyNode, StudyReorderTarget, StudyTree } from './tree.ts';

interface Gesture {
  id: string;
  pointerId: number;
  parentId: string | null;
  start: DragPoint;
  point: DragPoint;
  capture: HTMLElement;
  active: boolean;
  dirty: boolean;
  frameAt?: number;
}

/**
 * Sorts sibling branches with immediate pointer feedback and no native drag delay.
 *
 * Args:
 *   tree: Current index, including collapsed descendants.
 *   disabled: Whether the drawer or another operation prevents sorting.
 *   viewport: The tree's own scroll area, never the native conversation.
 *   move: Durable same-parent operation; errors are announced in the drawer.
 *
 * Returns:
 *   Row pointer handlers, an inert preview, a sibling edge and live feedback.
 */
export function useTreeDrag(tree: StudyTree, disabled: boolean, viewport: RefObject<HTMLDivElement>,
  move: (id: string, target: StudyReorderTarget) => Promise<void>) {
  const byId = useMemo(() => new Map(tree.nodes.map(node => [node.id, node])), [tree]);
  const latest = useRef({ byId, disabled, move });
  latest.current = { byId, disabled, move };
  const gesture = useRef<Gesture>();
  const frame = useRef<number>();
  const preview = useRef<HTMLDivElement | null>(null);
  const saving = useRef(false);
  const mounted = useRef(false);
  const suppressClick = useRef(false);
  const [sourceId, setSourceId] = useState<string>();
  const [target, setTarget] = useState<StudyReorderTarget>();
  const [status, setStatus] = useState('');

  /** Args: point: Current viewport coordinates. Positions only the inert drag preview. */
  const positionPreview = (point: DragPoint): void => {
    if (preview.current) preview.current.style.transform = `translate3d(${point.x + CONFIG.dragPreviewOffsetPx}px, ${point.y + CONFIG.dragPreviewOffsetPx}px, 0)`;
  };

  /** Args: current: Owned gesture. Returns: A final-coordinate destination inside this scroll area. */
  const destination = (current: Gesture): StudyReorderTarget | undefined => {
    const body = viewport.current;
    const source = latest.current.byId.get(current.id);
    if (!body || !source || source.parentId !== current.parentId || latest.current.disabled) return;
    const bounds = body.getBoundingClientRect();
    const { x, y } = current.point;
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !body.contains(hit)) return;
    let row = hit.closest<HTMLElement>('[data-study-node-id]');
    // Bridge the small inter-row gap without expanding a different parent's hit area.
    if (!row) {
      let distance: number = CONFIG.dragRowGapPx;
      for (const item of body.querySelectorAll<HTMLElement>('[data-study-node-id]')) {
        const rect = item.getBoundingClientRect();
        const gap = Math.max(rect.top - y, y - rect.bottom, 0);
        if (gap <= distance) { distance = gap; row = item; }
      }
    }
    if (!row || !body.contains(row)) return;
    return siblingDrop(source, latest.current.byId.get(row.dataset.studyNodeId!), y, row.getBoundingClientRect());
  };

  /** Args: proposed: Current edge. Avoids rendering the whole navigation for unchanged pointer moves. */
  const showTarget = (proposed: StudyReorderTarget | undefined): void => {
    setTarget(previous => previous?.id === proposed?.id && previous?.position === proposed?.position ? previous : proposed);
  };

  /** Args: announce: Whether an active cancellation should be visible. Stops capture and every scroll frame. */
  const cancel = (announce = false): void => {
    const current = gesture.current;
    gesture.current = undefined;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (current?.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
    if (mounted.current) {
      setSourceId(undefined); setTarget(undefined);
      if (announce && current?.active) setStatus('已取消排序');
    }
  };

  /** Args: timestamp: Browser frame time. Scrolls only this tree and re-hits stationary edge pointers. */
  const tick = (timestamp: number): void => {
    frame.current = undefined;
    const current = gesture.current;
    const body = viewport.current;
    if (!current?.active || !body) return;
    if (latest.current.disabled) { cancel(true); return; }
    const bounds = body.getBoundingClientRect();
    const elapsed = Math.min(CONFIG.dragFrameMaxMs, current.frameAt === undefined ? 0 : timestamp - current.frameAt);
    current.frameAt = timestamp;
    const velocity = current.point.x >= bounds.left && current.point.x <= bounds.right
      ? scrollVelocity(current.point.y, bounds.top, bounds.bottom) : 0;
    const previousTop = body.scrollTop;
    if (velocity) body.scrollTop += velocity * elapsed / 1_000;
    if (current.dirty || body.scrollTop !== previousTop) {
      current.dirty = false;
      positionPreview(current.point); showTarget(destination(current));
    }
    const canScroll = velocity < 0 ? body.scrollTop > 0 : velocity > 0 && body.scrollTop < body.scrollHeight - body.clientHeight;
    if (canScroll) frame.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    mounted.current = true;
    /** Args: event: Owned pointer movement. Activates once after a small distance, with no hold delay. */
    const movePointer = (event: globalThis.PointerEvent): void => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) { cancel(true); return; }
      current.point = { x: event.clientX, y: event.clientY }; current.dirty = true;
      if (!current.active && dragActivated(current.start, current.point)) {
        current.active = true; suppressClick.current = true;
        setSourceId(current.id); setStatus('');
        showTarget(destination(current));
      }
      if (current.active) {
        event.preventDefault();
        if (frame.current === undefined) {
          current.frameAt = undefined;
          frame.current = requestAnimationFrame(tick);
        }
      }
    };
    /** Args: event: Final pointer release. Saves once, using these coordinates instead of a stale rendered edge. */
    const finish = (event: globalThis.PointerEvent): void => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.point = { x: event.clientX, y: event.clientY };
      const proposed = current.active ? destination(current) : undefined;
      if (current.active) { event.preventDefault(); event.stopPropagation(); }
      cancel();
      if (!current.active) return;
      if (!proposed) { setStatus('未调整位置：只能在同一父节点下排序'); return; }
      if (saving.current) return;
      saving.current = true; setStatus('正在保存位置…');
      void latest.current.move(current.id, proposed).then(() => {
        if (mounted.current) setStatus('位置已保存');
      }, error => {
        if (mounted.current) setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => { saving.current = false; });
    };
    /** Args: event: Cancelled or unexpectedly released capture. Never writes a navigation change. */
    const abortPointer = (event: globalThis.PointerEvent): void => {
      if (event.pointerId === gesture.current?.pointerId) cancel(true);
    };
    /** Args: event: Escape while owning a gesture. Cancels sorting without affecting other host shortcuts. */
    const key = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(true); }
      else if (gesture.current?.active && ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    /** Clears only an old synthesized-click guard when a new real press begins. */
    const freshPress = (): void => { if (!gesture.current) suppressClick.current = false; };
    /** Cancels a gesture when focus leaves the browser. */
    const blur = (): void => cancel(true);
    /** Re-hits the pointer when wheel scrolling or resizing moves rows beneath a stationary cursor. */
    const refreshGeometry = (): void => {
      const current = gesture.current;
      if (!current?.active) return;
      current.dirty = true;
      if (frame.current === undefined) {
        current.frameAt = undefined;
        frame.current = requestAnimationFrame(tick);
      }
    };
    const body = viewport.current;
    body?.addEventListener('scroll', refreshGeometry, { passive: true });
    window.addEventListener('resize', refreshGeometry);
    window.addEventListener('pointerdown', freshPress, true);
    window.addEventListener('pointermove', movePointer, { passive: false, capture: true });
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', abortPointer, true);
    window.addEventListener('lostpointercapture', abortPointer, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => {
      mounted.current = false; cancel();
      window.removeEventListener('pointerdown', freshPress, true);
      window.removeEventListener('pointermove', movePointer, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', abortPointer, true);
      window.removeEventListener('lostpointercapture', abortPointer, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
      body?.removeEventListener('scroll', refreshGeometry);
      window.removeEventListener('resize', refreshGeometry);
    };
  }, []);

  useEffect(() => {
    const current = gesture.current;
    if (current && (disabled || !byId.has(current.id) || byId.get(current.id)?.parentId !== current.parentId)) cancel(true);
  }, [disabled, byId]);

  /** Args: event: Row press. id: Real branch identity. Excludes controls and preserves normal touch scrolling. */
  const start = (event: PointerEvent<HTMLElement>, id: string): void => {
    const source = latest.current.byId.get(id);
    const element = event.target instanceof Element ? event.target : undefined;
    if (latest.current.disabled || saving.current || gesture.current || !source || !event.isPrimary || event.button !== 0) return;
    if (element?.closest('button, a, input, textarea, select, [contenteditable], [role="button"]')) return;
    if (event.pointerType === 'touch' && !element?.closest('.study-drag-handle')) return;
    const point = { x: event.clientX, y: event.clientY };
    gesture.current = { id, pointerId: event.pointerId, parentId: source.parentId, start: point, point,
      capture: event.currentTarget, active: false, dirty: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /** Args: event: Post-drag browser click. Eats only the synthetic pointer click, preserving keyboard activation. */
  const captureClick = (event: MouseEvent<HTMLElement>): void => {
    if (suppressClick.current && event.detail > 0) {
      suppressClick.current = false; event.preventDefault(); event.stopPropagation();
    }
  };

  /** Args: element: Inert floating preview. Initial position uses the gesture, without another tree render. */
  const previewRef = (element: HTMLDivElement | null): void => {
    preview.current = element;
    if (gesture.current) positionPreview(gesture.current.point);
  };

  const rowTitle = target ? byId.get(target.id)?.title : undefined;
  const source: StudyNode | undefined = sourceId ? byId.get(sourceId) : undefined;
  const siblingCount = source ? tree.nodes.filter(node => node.parentId === source.parentId).length : 0;
  const hint = sourceId ? target ? `放在「${rowTitle}」${target.position === 'before' ? '之前' : '之后'}`
    : siblingCount < 2 ? '当前层级只有这一个分支 · Esc 取消' : '仅能在同一父节点下排序 · Esc 取消' : status;
  return { sourceId, target, hint, start, captureClick, previewRef };
}
