import { CONFIG } from './config.ts';
import type { StudyNode, StudyReorderTarget } from './tree.ts';

/** Viewport coordinates owned by one pointer gesture. */
export interface DragPoint { x: number; y: number }

/** Args: start: Pointer-down position. current: Latest position. Returns: Whether movement is deliberate. */
export function dragActivated(start: DragPoint, current: DragPoint): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= CONFIG.dragThresholdPx;
}

/**
 * Resolves the entire target row into two generous sibling sorting zones.
 *
 * Args:
 *   source: Branch being sorted, whose parent must remain unchanged.
 *   hovered: Row beneath the pointer, absent outside a row.
 *   clientY: Latest pointer position, including the final release position.
 *   rect: Visible target row geometry.
 *
 * Returns:
 *   A sibling edge, or undefined for self, descendants, or other parents.
 */
export function siblingDrop(source: StudyNode, hovered: StudyNode | undefined, clientY: number,
  rect: { top: number; height: number }): StudyReorderTarget | undefined {
  if (!hovered || hovered.id === source.id || hovered.parentId !== source.parentId) return;
  return { id: hovered.id, position: clientY < rect.top + rect.height / 2 ? 'before' : 'after' };
}

/** Args: y: Pointer ordinate. top: Scroll viewport top. bottom: Viewport bottom. Returns: Bounded pixels per second. */
export function scrollVelocity(y: number, top: number, bottom: number): number {
  if (y < top || y > bottom) return 0;
  const edge = Math.min(CONFIG.dragScrollEdgePx, (bottom - top) / 2);
  if (edge <= 0) return 0;
  if (y < top + edge) return -CONFIG.dragScrollPxPerSecond * (top + edge - y) / edge;
  if (y > bottom - edge) return CONFIG.dragScrollPxPerSecond * (y - bottom + edge) / edge;
  return 0;
}
