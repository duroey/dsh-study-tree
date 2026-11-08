import type { CapturedStudySelection } from './selection.ts';
import type { StudyOrigin, StudyTree } from './tree.ts';
import type { DshCatalogEntry } from './compat.ts';

/** Serializable view preferences stay separate from shared navigation data. */
export interface StudyViewSnapshot {
  tree: StudyTree;
  catalog: DshCatalogEntry[];
  loaded: boolean;
  busy: boolean;
  enabled: boolean;
  currentId?: string;
  selection?: CapturedStudySelection;
  selectionExpanded: boolean;
  nativeSelection: boolean;
  dialog?: 'attach' | string;
  error?: string;
  historyOpen: boolean;
  runningIds: string[];
  pendingFork?: { id: string; title: string };
  draft?: { token: number; parentId: string; origin: StudyOrigin; question: string; presentation: 'panel' | 'overlay' };
}

/** Minimal Cordis surface: host packages remain owned and loaded by DSH. */
export interface PluginContext {
  get(name: string): any;
  slots: {
    spec?(name: string): { kind: string } | undefined;
    inject(name: string, callback: () => unknown): unknown;
    register(specification: Record<string, unknown>, component: unknown): unknown;
  };
  effect(callback: () => void | (() => void), label?: string): void;
  inject(services: string[], callback: (scope: PluginContext) => void): unknown;
}
