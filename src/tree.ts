/** A bounded navigation index; conversation contents remain owned by DSH. */
export const MAX_TREE_NODES = 2_000;

/** A whole-session fork origin; seq is an optional completed-turn display anchor. */
export interface StudyOrigin {
  sessionId: string;
  seq?: number;
  scrollTop?: number;
}

/** The immutable selected passage, independent of later navigation moves. */
export interface StudySource extends StudyOrigin {
  quote: string;
  prefix?: string;
  suffix?: string;
}

/** One real DSH session appearing in the learning navigation. */
export interface StudyNode {
  id: string;
  parentId: string | null;
  title: string;
  createdAt: number;
  source?: StudySource;
  origin?: StudyOrigin;
  collapsed?: boolean;
}

/** Versioned data persisted by the plugin, without duplicated conversations. */
export interface StudyTree {
  schemaVersion: 1;
  nodes: StudyNode[];
}

/** One visible navigation row, in depth-first insertion order. */
export interface TreeRow {
  node: StudyNode;
  depth: number;
  hasChildren: boolean;
}

/** One user-directed destination in the navigation tree. */
export type StudyDropTarget = { position: 'root' } | { position: 'inside' | 'before' | 'after'; id: string };

/** A sorting destination that preserves the branch's parent and inherited context. */
export interface StudyReorderTarget { position: 'before' | 'after'; id: string }

/**
 * Creates an independent empty navigation tree.
 *
 * Returns:
 *   A new version-one tree with no session references.
 */
export function emptyTree(): StudyTree {
  return { schemaVersion: 1, nodes: [] };
}

/**
 * Adds a session or updates its existing navigation entry immutably.
 *
 * Args:
 *   tree: Valid navigation state.
 *   node: Complete session identity and parent; omitted optional metadata is retained.
 *
 * Returns:
 *   A validated tree with one entry per session, preserving existing row order.
 *
 * Throws:
 *   Error: If the parent is absent, a cycle is introduced, or the limit is exceeded.
 */
export function attachSession(tree: StudyTree, node: StudyNode): StudyTree {
  const next = parseTree(tree);
  const entry = parseNode(node, 'node');
  const index = next.nodes.findIndex((item) => item.id === entry.id);
  if (index === -1) {
    if (next.nodes.length >= MAX_TREE_NODES) {
      throw new Error(`Study tree node limit (${MAX_TREE_NODES}) exceeded.`);
    }
    next.nodes.push(entry);
  } else {
    next.nodes[index] = { ...next.nodes[index]!, ...entry };
  }
  validateTopology(next.nodes);
  return next;
}

/**
 * Moves a navigation branch without changing the session's fork provenance.
 *
 * Args:
 *   tree: Valid navigation state.
 *   id: Session whose navigation parent should change.
 *   parentId: New parent session, or null to make this session a root.
 *
 * Returns:
 *   A validated independent tree containing the moved branch.
 *
 * Throws:
 *   Error: If a session is missing or the move would create a cycle.
 */
export function moveNode(tree: StudyTree, id: string, parentId: string | null): StudyTree {
  const next = parseTree(tree);
  const index = next.nodes.findIndex((item) => item.id === id);
  if (index === -1) throw missingSession(id);
  next.nodes[index] = { ...next.nodes[index]!, parentId };
  validateTopology(next.nodes);
  return next;
}

/**
 * Sorts a complete branch among siblings without changing any parent or context.
 *
 * Args:
 *   tree: Existing session index, including collapsed descendants.
 *   id: Session whose entire navigation branch travels together.
 *   drop: A sibling edge; legacy reparenting destinations are explicitly refused.
 *
 * Returns:
 *   A validated preorder index retaining all session identities and sources.
 *
 * Throws:
 *   Error: If an identity is missing or the destination would change the parent.
 */
export function relocateBranch(tree: StudyTree, id: string, drop: StudyDropTarget): StudyTree {
  if (drop.position !== 'before' && drop.position !== 'after') {
    throw new Error('只能在同一父节点下调整顺序，不能通过拖拽改变继承层级。');
  }
  const next = parseTree(tree);
  const byId = new Map(next.nodes.map((node) => [node.id, node]));
  const source = byId.get(id);
  if (!source) throw missingSession(id);
  const target = byId.get(drop.id);
  if (!target) throw missingSession(drop.id);
  if (source.parentId !== target.parentId) throw new Error('只能在同一父节点下调整顺序，不能通过拖拽改变继承层级。');
  if (target.id === id) return next;
  const children = childIndex(next.nodes);
  const siblings = (children.get(source.parentId) ?? []).filter((node) => node.id !== id);
  const index = siblings.findIndex((node) => node.id === target.id) + (drop.position === 'after' ? 1 : 0);
  siblings.splice(index, 0, source);
  children.set(source.parentId, siblings);
  const pending = [...(children.get(null) ?? [])].reverse();
  const ordered: StudyNode[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    ordered.push(current);
    const descendants = children.get(current.id) ?? [];
    for (let child = descendants.length - 1; child >= 0; child -= 1) pending.push(descendants[child]!);
  }
  return { ...next, nodes: ordered };
}

/**
 * Removes a branch from navigation while leaving its real DSH sessions alone.
 *
 * Args:
 *   tree: Valid navigation state.
 *   id: Root session of the navigation branch to detach.
 *
 * Returns:
 *   A new tree excluding this node and all of its navigation descendants.
 *
 * Throws:
 *   Error: If the addressed session is absent.
 */
export function detachBranch(tree: StudyTree, id: string): StudyTree {
  const next = parseTree(tree);
  if (!next.nodes.some((item) => item.id === id)) throw missingSession(id);
  const children = childIndex(next.nodes);
  const detached = new Set<string>();
  const pending = [id];
  while (pending.length > 0) {
    const current = pending.pop()!;
    detached.add(current);
    for (const child of children.get(current) ?? []) pending.push(child.id);
  }
  return { ...next, nodes: next.nodes.filter((item) => !detached.has(item.id)) };
}

/**
 * Finds a session's complete navigation path, including the session itself.
 *
 * Args:
 *   tree: Valid navigation state.
 *   id: Session whose path should be shown.
 *
 * Returns:
 *   Independent node records ordered from the root to the current session.
 *
 * Throws:
 *   Error: If the addressed session is absent.
 */
export function ancestors(tree: StudyTree, id: string): StudyNode[] {
  const next = parseTree(tree);
  const byId = new Map(next.nodes.map((item) => [item.id, item]));
  let current = byId.get(id);
  if (!current) throw missingSession(id);
  const path: StudyNode[] = [];
  while (current) {
    path.push(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path.reverse();
}

/**
 * Projects expanded navigation rows without removing collapsed descendants.
 *
 * Args:
 *   tree: Valid navigation state, ordered by session insertion.
 *
 * Returns:
 *   Depth-first rows; roots and siblings retain their array order.
 */
export function visibleRows(tree: StudyTree): TreeRow[] {
  const next = parseTree(tree);
  const children = childIndex(next.nodes);
  const pending = (children.get(null) ?? [])
    .map((node) => ({ node, depth: 0 }))
    .reverse();
  const rows: TreeRow[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const descendants = children.get(current.node.id) ?? [];
    rows.push({ ...current, hasChildren: descendants.length > 0 });
    if (current.node.collapsed) continue;
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      pending.push({ node: descendants[index]!, depth: current.depth + 1 });
    }
  }
  return rows;
}

/**
 * Validates and clones persisted navigation data before it reaches the UI.
 *
 * Args:
 *   input: Parsed JSON or another untrusted candidate state.
 *
 * Returns:
 *   A version-one tree with fresh node and source records.
 *
 * Throws:
 *   Error: If the schema, fields, identities, topology, or size are invalid.
 */
export function parseTree(input: unknown): StudyTree {
  const record = asRecord(input, 'tree');
  if (record.schemaVersion !== 1) {
    throw new Error('Invalid tree.schemaVersion: expected 1.');
  }
  if (!Array.isArray(record.nodes)) throw new Error('Invalid tree.nodes: expected an array.');
  if (record.nodes.length > MAX_TREE_NODES) {
    throw new Error(`Study tree node limit (${MAX_TREE_NODES}) exceeded.`);
  }
  const nodes = record.nodes.map((item, index) => parseNode(item, `tree.nodes[${index}]`));
  validateTopology(nodes);
  return { schemaVersion: 1, nodes };
}

/**
 * Reads a plain object without accepting null, arrays, or class instances.
 *
 * Args:
 *   value: Candidate object.
 *   path: Field location used in validation errors.
 *
 * Returns:
 *   An object whose fields remain untrusted until individually validated.
 */
function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${path}: expected an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Invalid ${path}: expected a plain object.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validates a nonempty identifier or title without altering its value.
 *
 * Args:
 *   value: Candidate field.
 *   path: Field location used in validation errors.
 *
 * Returns:
 *   The original string, preserving real session identities and titles.
 */
function nonemptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${path}: expected a nonempty string.`);
  }
  return value;
}

/**
 * Copies a source anchor while validating optional offsets and text fields.
 *
 * Args:
 *   value: Candidate source anchor.
 *   path: Field location used in validation errors.
 *
 * Returns:
 *   A fresh source anchor with validated scalar fields.
 */
function parseOrigin(value: unknown, path: string): StudyOrigin {
  const record = asRecord(value, path);
  const source: StudyOrigin = {
    sessionId: nonemptyString(record.sessionId, `${path}.sessionId`),
  };
  if (record.seq !== undefined) {
    if (typeof record.seq !== 'number' || !Number.isSafeInteger(record.seq) || record.seq < 0) {
      throw new Error(`Invalid ${path}.seq: expected a nonnegative safe integer.`);
    }
    source.seq = record.seq;
  }
  if (record.scrollTop !== undefined) {
    if (typeof record.scrollTop !== 'number' || !Number.isFinite(record.scrollTop) || record.scrollTop < 0) {
      throw new Error(`Invalid ${path}.scrollTop: expected a nonnegative finite number.`);
    }
    source.scrollTop = record.scrollTop;
  }
  return source;
}

/** Args: value: Selected passage. path: Validation location. Returns: A validated text anchor. */
function parseSource(value: unknown, path: string): StudySource {
  const record = asRecord(value, path);
  const source: StudySource = { ...parseOrigin(value, path), quote: nonemptyString(record.quote, `${path}.quote`) };
  for (const field of ['prefix', 'suffix'] as const) {
    if (record[field] !== undefined) {
      if (typeof record[field] !== 'string') {
        throw new Error(`Invalid ${path}.${field}: expected a string.`);
      }
      source[field] = record[field];
    }
  }
  return source;
}

/**
 * Copies a node while rejecting invalid required or optional fields.
 *
 * Args:
 *   value: Candidate node record.
 *   path: Field location used in validation errors.
 *
 * Returns:
 *   A fresh node with independent source metadata.
 */
function parseNode(value: unknown, path: string): StudyNode {
  const record = asRecord(value, path);
  const node: StudyNode = {
    id: nonemptyString(record.id, `${path}.id`),
    parentId: record.parentId === null ? null : nonemptyString(record.parentId, `${path}.parentId`),
    title: nonemptyString(record.title, `${path}.title`),
    createdAt: 0,
  };
  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt) || record.createdAt < 0) {
    throw new Error(`Invalid ${path}.createdAt: expected a nonnegative finite number.`);
  }
  node.createdAt = record.createdAt;
  if (record.source !== undefined) node.source = parseSource(record.source, `${path}.source`);
  if (record.origin !== undefined) node.origin = parseOrigin(record.origin, `${path}.origin`);
  if (node.source && node.origin) throw new Error(`Invalid ${path}: use either source or origin.`);
  if (record.collapsed !== undefined) {
    if (typeof record.collapsed !== 'boolean') {
      throw new Error(`Invalid ${path}.collapsed: expected a boolean.`);
    }
    node.collapsed = record.collapsed;
  }
  return node;
}

/**
 * Checks one-parent topology in linear time without recursive traversal.
 *
 * Args:
 *   nodes: Individually validated node records.
 *
 * Throws:
 *   Error: If identities repeat, a parent is missing, or a cycle exists.
 */
function validateTopology(nodes: StudyNode[]): void {
  const byId = new Map<string, StudyNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`Duplicate session id "${node.id}" in study tree.`);
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      throw new Error(`Parent session "${node.parentId}" is missing for session "${node.id}".`);
    }
  }
  const complete = new Set<string>();
  for (const node of nodes) {
    const visiting = new Set<string>();
    let current: string | null = node.id;
    while (current !== null && !complete.has(current)) {
      if (visiting.has(current)) throw new Error(`Study tree cycle at session "${current}".`);
      visiting.add(current);
      current = byId.get(current)!.parentId;
    }
    for (const id of visiting) complete.add(id);
  }
}

/**
 * Indexes children while preserving each sibling's insertion order.
 *
 * Args:
 *   nodes: Validated node records in insertion order.
 *
 * Returns:
 *   Parent-addressed arrays, with null identifying the roots.
 */
function childIndex(nodes: StudyNode[]): Map<string | null, StudyNode[]> {
  const children = new Map<string | null, StudyNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  return children;
}

/**
 * Creates a consistent error for a missing navigation identity.
 *
 * Args:
 *   id: Requested real session identity.
 *
 * Returns:
 *   A descriptive error without changing any session or navigation state.
 */
function missingSession(id: string): Error {
  return new Error(`Session "${id}" is missing from the study tree.`);
}
