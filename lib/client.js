window.__ModuleLoader__.load({id:"dsh-study-tree",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/config.ts
var CONFIG = Object.freeze({
  rpcNamespace: "/study-tree",
  schemaVersion: 1,
  stateDirectory: "community/dsh-study-tree",
  treeFile: "tree.json",
  maxStateBytes: 2e6,
  lockTimeoutMs: 5e3,
  lockRetryMs: 30,
  lockStaleMs: 3e4,
  browserKey: "dsh-study-tree:ui:v1",
  treeWidth: 280,
  drawerMotionDurationMs: 240,
  drawerMotionEasing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  dragThresholdPx: 4,
  dragRowGapPx: 6,
  dragScrollEdgePx: 48,
  dragScrollPxPerSecond: 560,
  dragFrameMaxMs: 32,
  dragPreviewOffsetPx: 14,
  narrowWidth: 740,
  titleLength: 48,
  draftPanel: "study-tree-draft",
  fallbackTitleLength: 24,
  titleWords: 6,
  titleCjkCharacters: 12,
  titleInputCharacters: 1500,
  titleInputBytes: 8192,
  titleOutputTokens: 512,
  titleTimeoutMs: 12e3,
  titleRetryMs: 250,
  titleRetryLimit: 3,
  quoteLimit: 8e3,
  sourceContextLength: 64,
  requestTimeoutMs: 15e3,
  restoreTimeoutMs: 5e3,
  positionDelayMs: 120,
  compatibility: ["0.1.1-rc.2", "0.2.1-rc.5", "0.2.2-rc.1"]
});

// src/compat.ts
var DshAdapter = class {
  context;
  constructor(ctx) {
    if (!isRecord(ctx)) throw new Error("DSH adapter requires a plugin context.");
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
  catalog() {
    const list = this.sessions().list;
    if (typeof list?.getSnapshot !== "function") {
      throw new Error("DSH session catalog is unavailable: sessions.list.getSnapshot is required.");
    }
    const snapshot = list.getSnapshot();
    if (!isRecord(snapshot) || !isRecord(snapshot.byId)) {
      throw new Error("DSH session catalog is invalid: expected a byId metadata map.");
    }
    const ids = Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(snapshot.byId);
    const entries = [];
    for (const id of ids) {
      const row = snapshot.byId[id];
      if (!row) continue;
      const title = nonblank(row.title) ?? nonblank(row.displayTitle) ?? id;
      entries.push({ id, title, ...typeof row.cwd === "string" ? { cwd: row.cwd } : {} });
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
  subscribe(listener) {
    const list = this.sessions().list;
    if (typeof list?.subscribe !== "function") {
      throw new Error("DSH session catalog is not observable: sessions.list.subscribe is required.");
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
  async open(id) {
    requireText(id, "session id");
    const workspace = this.service("uiWorkspace");
    if (isRecord(workspace) && typeof workspace.openSession === "function") {
      await workspace.openSession(id);
      return;
    }
    const sessions = this.sessions();
    if (typeof sessions.open !== "function") {
      throw new Error(`Cannot open DSH session "${id}": uiWorkspace.openSession or sessions.open is required.`);
    }
    await sessions.open(id);
    const layout = this.service("layout");
    if (isRecord(layout) && typeof layout.selectPanel === "function") {
      layout.selectPanel(null);
    }
  }
  /** Args: open: Select the registered temporary page, or return to native chat. */
  showDraft(open) {
    const layout = this.service("layout");
    if (isRecord(layout) && typeof layout.selectPanel === "function") layout.selectPanel(open ? CONFIG.draftPanel : null);
  }
  /** Returns: The public main-panel path, or the legacy root overlay fallback. */
  draftPresentation() {
    const layout = this.service("layout");
    return isRecord(layout) && typeof layout.selectPanel === "function" ? "panel" : "overlay";
  }
  /** Args: id: Parent session. Returns: Latest available completed-turn anchor for a draft. */
  async completedTurnEnd(id) {
    return this.usingSession(id, (binding) => {
      const source = binding.eventSource;
      if (isRecord(source) && typeof source.getSnapshot === "function") {
        const window2 = source.getSnapshot();
        if (!isRecord(window2) || !Array.isArray(window2.entries)) return void 0;
        let end2;
        for (const entry of window2.entries) {
          const event = isRecord(entry) && entry.type === "event" && isRecord(entry.event) ? entry.event : void 0;
          if (event?.type === "turn/end" && Number.isSafeInteger(event.seq) && event.seq >= 0) end2 = event.seq;
        }
        return end2;
      }
      const snapshot = binding.session.getSnapshot();
      let end;
      if (isRecord(snapshot) && snapshot.turnEnds instanceof Map) for (const seq of snapshot.turnEnds.values()) {
        if (Number.isSafeInteger(seq) && seq >= 0 && (end === void 0 || seq > end)) end = seq;
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
  async usingSession(id, operation) {
    requireText(id, "session id");
    const sessions = this.sessions();
    if (typeof sessions.retain === "function") {
      const reference = sessions.retain(id, { source: "studyTreeOperation" });
      if (!reference || typeof reference.release !== "function") {
        throw new Error(`Cannot retain DSH session "${id}": invalid session reference.`);
      }
      try {
        const binding2 = await reference.ready;
        requireBinding(binding2, id);
        return await operation(binding2);
      } finally {
        reference.release();
      }
    }
    if (typeof sessions.binding !== "function") {
      throw new Error(`Cannot borrow DSH session "${id}": sessions.retain or sessions.binding is required.`);
    }
    let binding = sessions.binding(id);
    if (!binding && typeof sessions.open === "function") {
      await sessions.open(id);
      binding = sessions.binding(id);
    }
    requireBinding(binding, id);
    if (typeof binding.session.open === "function") await binding.session.open();
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
  async fork(source, onCreated) {
    requireText(source.sessionId, "source session id");
    if (source.seq !== void 0 && (!Number.isSafeInteger(source.seq) || source.seq < 0)) {
      throw new Error("Cannot fork DSH session: source sequence must be a nonnegative safe integer.");
    }
    const sessions = this.sessions();
    if (typeof sessions.fork !== "function") {
      throw new Error("This DSH version does not expose sessions.fork; a history-preserving branch cannot be created.");
    }
    let received;
    const record = (id2) => {
      requireText(id2, "forked session id");
      if (received === id2) return;
      if (received) throw new Error("DSH returned inconsistent fork identities.");
      received = id2;
      onCreated?.(id2);
    };
    let id;
    try {
      id = await sessions.fork({
        sessionId: source.sessionId,
        atSeq: source.seq,
        increaseTitle: false,
        ...onCreated ? { onCreated: record } : {}
      });
    } catch (error) {
      const failure = isRecord(error) && isRecord(error.rpcError) ? error.rpcError : void 0;
      if (onCreated && failure?.code === "workspace-attach-failed" && isRecord(failure.details) && typeof failure.details.sessionId === "string") record(failure.details.sessionId);
      throw error;
    }
    requireText(id, "forked session id");
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
  async inheritedTurnEnd(id, allowLegacySnapshot = true) {
    return this.usingSession(id, (binding) => {
      const source = binding.eventSource;
      if (isRecord(source) && typeof source.getSnapshot === "function") {
        const window2 = source.getSnapshot();
        if (!isRecord(window2) || !Array.isArray(window2.entries)) return void 0;
        let end2;
        let inherited;
        for (const entry of window2.entries) {
          if (!isRecord(entry) || entry.type !== "event" || !isRecord(entry.event)) continue;
          const event = entry.event;
          if (!Number.isSafeInteger(event.seq) || event.seq < 0) continue;
          if (event.type === "turn/end") end2 = event.seq;
          if (event.type === "session/end-seed" && isRecord(event.data) && event.data.inherited === true) inherited = end2;
        }
        return inherited;
      }
      if (!allowLegacySnapshot) return void 0;
      const snapshot = binding.session.getSnapshot();
      if (!isRecord(snapshot) || !(snapshot.turnEnds instanceof Map)) return void 0;
      let end;
      for (const value of snapshot.turnEnds.values()) {
        if (Number.isSafeInteger(value) && value >= 0 && (end === void 0 || value > end)) end = value;
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
  async rename(id, title) {
    requireText(title, "session title");
    await this.usingSession(id, async ({ session }) => {
      if (typeof session.rename !== "function") {
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
  async prompt(id, text) {
    requireText(text, "question");
    await this.usingSession(id, async ({ session }) => {
      if (typeof session.prompt !== "function") {
        throw new Error(`Cannot prompt DSH session "${id}": session.prompt is unavailable.`);
      }
      const result = await session.prompt([{ type: "text", text }], "queue");
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
  describe() {
    const sessions = this.sessions();
    const workspace = this.service("uiWorkspace");
    return {
      navigation: isRecord(workspace) && typeof workspace.openSession === "function" ? "uiWorkspace.openSession" : typeof sessions.open === "function" ? "sessions.open" : "unavailable",
      ownership: typeof sessions.retain === "function" ? "sessions.retain" : typeof sessions.binding === "function" ? "sessions.binding" : "unavailable",
      fork: typeof sessions.fork === "function"
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
  service(name) {
    if (typeof this.context.get === "function") return this.context.get(name);
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
  sessions() {
    const service = this.service("sessions");
    if (!isRecord(service)) throw new Error("DSH sessions service is unavailable; enable the plugin in a Web profile.");
    return service;
  }
};
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function nonblank(value) {
  return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
function requireText(value, name) {
  if (nonblank(value) === void 0) throw new Error(`DSH ${name} must be a nonempty string.`);
}
function requireBinding(binding, id) {
  if (!isRecord(binding) || !isRecord(binding.session)) {
    throw new Error(`DSH session "${id}" has no live binding after opening.`);
  }
}
function assertSuccess(result, operation) {
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    throw new Error(`${operation} returned an invalid DSH result.`);
  }
  if (result.ok) return;
  const error = isRecord(result.error) ? result.error : {};
  const code = nonblank(error.code) ?? "unknown";
  const message = nonblank(error.message) ?? "The host rejected the operation.";
  throw new Error(`${operation} failed (${code}): ${message}`);
}

// src/tree.ts
var MAX_TREE_NODES = 2e3;
function emptyTree() {
  return { schemaVersion: 1, nodes: [] };
}
function attachSession(tree, node) {
  const next = parseTree(tree);
  const entry = parseNode(node, "node");
  const index = next.nodes.findIndex((item) => item.id === entry.id);
  if (index === -1) {
    if (next.nodes.length >= MAX_TREE_NODES) {
      throw new Error(`Study tree node limit (${MAX_TREE_NODES}) exceeded.`);
    }
    next.nodes.push(entry);
  } else {
    next.nodes[index] = { ...next.nodes[index], ...entry };
  }
  validateTopology(next.nodes);
  return next;
}
function moveNode(tree, id, parentId) {
  const next = parseTree(tree);
  const index = next.nodes.findIndex((item) => item.id === id);
  if (index === -1) throw missingSession(id);
  next.nodes[index] = { ...next.nodes[index], parentId };
  validateTopology(next.nodes);
  return next;
}
function relocateBranch(tree, id, drop) {
  if (drop.position !== "before" && drop.position !== "after") {
    throw new Error("\u53EA\u80FD\u5728\u540C\u4E00\u7236\u8282\u70B9\u4E0B\u8C03\u6574\u987A\u5E8F\uFF0C\u4E0D\u80FD\u901A\u8FC7\u62D6\u62FD\u6539\u53D8\u7EE7\u627F\u5C42\u7EA7\u3002");
  }
  const next = parseTree(tree);
  const byId = new Map(next.nodes.map((node) => [node.id, node]));
  const source = byId.get(id);
  if (!source) throw missingSession(id);
  const target = byId.get(drop.id);
  if (!target) throw missingSession(drop.id);
  if (source.parentId !== target.parentId) throw new Error("\u53EA\u80FD\u5728\u540C\u4E00\u7236\u8282\u70B9\u4E0B\u8C03\u6574\u987A\u5E8F\uFF0C\u4E0D\u80FD\u901A\u8FC7\u62D6\u62FD\u6539\u53D8\u7EE7\u627F\u5C42\u7EA7\u3002");
  if (target.id === id) return next;
  const children = childIndex(next.nodes);
  const siblings = (children.get(source.parentId) ?? []).filter((node) => node.id !== id);
  const index = siblings.findIndex((node) => node.id === target.id) + (drop.position === "after" ? 1 : 0);
  siblings.splice(index, 0, source);
  children.set(source.parentId, siblings);
  const pending = [...children.get(null) ?? []].reverse();
  const ordered = [];
  while (pending.length > 0) {
    const current = pending.pop();
    ordered.push(current);
    const descendants2 = children.get(current.id) ?? [];
    for (let child = descendants2.length - 1; child >= 0; child -= 1) pending.push(descendants2[child]);
  }
  return { ...next, nodes: ordered };
}
function detachBranch(tree, id) {
  const next = parseTree(tree);
  if (!next.nodes.some((item) => item.id === id)) throw missingSession(id);
  const children = childIndex(next.nodes);
  const detached = /* @__PURE__ */ new Set();
  const pending = [id];
  while (pending.length > 0) {
    const current = pending.pop();
    detached.add(current);
    for (const child of children.get(current) ?? []) pending.push(child.id);
  }
  return { ...next, nodes: next.nodes.filter((item) => !detached.has(item.id)) };
}
function ancestors(tree, id) {
  const next = parseTree(tree);
  const byId = new Map(next.nodes.map((item) => [item.id, item]));
  let current = byId.get(id);
  if (!current) throw missingSession(id);
  const path = [];
  while (current) {
    path.push(current);
    current = current.parentId === null ? void 0 : byId.get(current.parentId);
  }
  return path.reverse();
}
function visibleRows(tree) {
  const next = parseTree(tree);
  const children = childIndex(next.nodes);
  const pending = (children.get(null) ?? []).map((node) => ({ node, depth: 0 })).reverse();
  const rows = [];
  while (pending.length > 0) {
    const current = pending.pop();
    const descendants2 = children.get(current.node.id) ?? [];
    rows.push({ ...current, hasChildren: descendants2.length > 0 });
    if (current.node.collapsed) continue;
    for (let index = descendants2.length - 1; index >= 0; index -= 1) {
      pending.push({ node: descendants2[index], depth: current.depth + 1 });
    }
  }
  return rows;
}
function parseTree(input) {
  const record = asRecord(input, "tree");
  if (record.schemaVersion !== 1) {
    throw new Error("Invalid tree.schemaVersion: expected 1.");
  }
  if (!Array.isArray(record.nodes)) throw new Error("Invalid tree.nodes: expected an array.");
  if (record.nodes.length > MAX_TREE_NODES) {
    throw new Error(`Study tree node limit (${MAX_TREE_NODES}) exceeded.`);
  }
  const nodes = record.nodes.map((item, index) => parseNode(item, `tree.nodes[${index}]`));
  validateTopology(nodes);
  return { schemaVersion: 1, nodes };
}
function asRecord(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${path}: expected an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Invalid ${path}: expected a plain object.`);
  }
  return value;
}
function nonemptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${path}: expected a nonempty string.`);
  }
  return value;
}
function parseOrigin(value, path) {
  const record = asRecord(value, path);
  const source = {
    sessionId: nonemptyString(record.sessionId, `${path}.sessionId`)
  };
  if (record.seq !== void 0) {
    if (typeof record.seq !== "number" || !Number.isSafeInteger(record.seq) || record.seq < 0) {
      throw new Error(`Invalid ${path}.seq: expected a nonnegative safe integer.`);
    }
    source.seq = record.seq;
  }
  if (record.scrollTop !== void 0) {
    if (typeof record.scrollTop !== "number" || !Number.isFinite(record.scrollTop) || record.scrollTop < 0) {
      throw new Error(`Invalid ${path}.scrollTop: expected a nonnegative finite number.`);
    }
    source.scrollTop = record.scrollTop;
  }
  return source;
}
function parseSource(value, path) {
  const record = asRecord(value, path);
  const source = { ...parseOrigin(value, path), quote: nonemptyString(record.quote, `${path}.quote`) };
  for (const field of ["prefix", "suffix"]) {
    if (record[field] !== void 0) {
      if (typeof record[field] !== "string") {
        throw new Error(`Invalid ${path}.${field}: expected a string.`);
      }
      source[field] = record[field];
    }
  }
  return source;
}
function parseNode(value, path) {
  const record = asRecord(value, path);
  const node = {
    id: nonemptyString(record.id, `${path}.id`),
    parentId: record.parentId === null ? null : nonemptyString(record.parentId, `${path}.parentId`),
    title: nonemptyString(record.title, `${path}.title`),
    createdAt: 0
  };
  if (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt) || record.createdAt < 0) {
    throw new Error(`Invalid ${path}.createdAt: expected a nonnegative finite number.`);
  }
  node.createdAt = record.createdAt;
  if (record.source !== void 0) node.source = parseSource(record.source, `${path}.source`);
  if (record.origin !== void 0) node.origin = parseOrigin(record.origin, `${path}.origin`);
  if (node.source && node.origin) throw new Error(`Invalid ${path}: use either source or origin.`);
  if (record.collapsed !== void 0) {
    if (typeof record.collapsed !== "boolean") {
      throw new Error(`Invalid ${path}.collapsed: expected a boolean.`);
    }
    node.collapsed = record.collapsed;
  }
  return node;
}
function validateTopology(nodes) {
  const byId = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`Duplicate session id "${node.id}" in study tree.`);
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      throw new Error(`Parent session "${node.parentId}" is missing for session "${node.id}".`);
    }
  }
  const complete = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    const visiting = /* @__PURE__ */ new Set();
    let current = node.id;
    while (current !== null && !complete.has(current)) {
      if (visiting.has(current)) throw new Error(`Study tree cycle at session "${current}".`);
      visiting.add(current);
      current = byId.get(current).parentId;
    }
    for (const id of visiting) complete.add(id);
  }
}
function childIndex(nodes) {
  const children = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  return children;
}
function missingSession(id) {
  return new Error(`Session "${id}" is missing from the study tree.`);
}

// src/selection.ts
var DOM_CONFIG = {
  flow: "[data-chat-flow-kind]",
  assistant: '[data-chat-flow-kind="assistant-step"]',
  tail: '[data-chat-flow-kind="turn-tail"]',
  turnEnd: "[data-study-turn-end]",
  excludedText: ".katex-mathml, annotation, script, style, button, input, textarea, [hidden]",
  plugin: "[data-study-plugin]",
  inputKinds: /* @__PURE__ */ new Set(["user", "user-message", "input", "input-message", "steering-message"]),
  contextCharacters: 64,
  maximumQuoteCharacters: 8e3,
  maximumFlowCharacters: 25e4,
  highlightMilliseconds: 1800,
  highlightName: "dsh-study-tree-source",
  highlightColor: "rgba(68, 112, 210, 0.24)",
  landingRatio: 0.35
};
var ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu;
var clearSourceHighlight;
function captureSelection(selection, currentSessionId) {
  if (!currentSessionId || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return void 0;
  const range = selection.getRangeAt(0);
  const start = elementOf(range.startContainer);
  const end = elementOf(range.endContainer);
  if (!start || !end || start.closest(DOM_CONFIG.plugin) || end.closest(DOM_CONFIG.plugin) || start.closest(DOM_CONFIG.excludedText) || end.closest(DOM_CONFIG.excludedText)) return void 0;
  const flow = start.closest(DOM_CONFIG.assistant);
  if (!flow || flow !== end.closest(DOM_CONFIG.assistant)) return void 0;
  const boundary = completedTurn(flow, currentSessionId);
  if (!boundary) return void 0;
  const rawQuote = readableRangeText(range);
  const quote = rawQuote.trim();
  if (!quote || quote.length > DOM_CONFIG.maximumQuoteCharacters) return void 0;
  const leading = rawQuote.indexOf(quote);
  const before = range.cloneRange();
  before.selectNodeContents(flow);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(flow);
  after.setStart(range.endContainer, range.endOffset);
  const prefix = (readableRangeText(before) + rawQuote.slice(0, leading)).slice(-DOM_CONFIG.contextCharacters);
  const suffix = (rawQuote.slice(leading + quote.length) + readableRangeText(after)).slice(0, DOM_CONFIG.contextCharacters);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return void 0;
  return {
    source: {
      sessionId: currentSessionId,
      seq: boundary.seq,
      quote,
      prefix,
      suffix,
      scrollTop: scrollingContainer(flow).scrollTop
    },
    rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
  };
}
function restoreSource(source) {
  if (typeof document === "undefined" || source.seq === void 0) return false;
  const tails = [...document.querySelectorAll(DOM_CONFIG.turnEnd)].filter((marker) => (markerSequence(marker) === source.seq || Number(marker.dataset.studySourceSeq) === source.seq) && markerSessionMatches(marker, source.sessionId)).map((marker) => marker.closest(DOM_CONFIG.tail)).filter((tail) => tail !== null && visible(tail));
  const matches = [];
  for (const tail of new Set(tails)) {
    for (const flow of assistantFlowsInTurn(tail)) {
      const index = visibleTextIndex(flow);
      if (!index) continue;
      for (const range2 of quoteMatches(index.text, source.quote, source.prefix, source.suffix)) {
        matches.push({ flow, index, range: range2 });
        if (matches.length > 1) return false;
      }
    }
  }
  if (matches.length !== 1) return false;
  const match = matches[0];
  const range = domRange(match.index, match.range);
  if (!range) return false;
  const container = scrollingContainer(match.flow);
  const rect = range.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  container.scrollTop = Math.max(0, container.scrollTop + rect.top - viewport.top - container.clientHeight * DOM_CONFIG.landingRatio);
  flashSource(range);
  return true;
}
function captureScrollPosition() {
  if (typeof document === "undefined") return 0;
  return Math.max(0, scrollingContainer(currentFlow()).scrollTop);
}
function restoreScrollPosition(top) {
  if (typeof document === "undefined" || !Number.isFinite(top) || top < 0) return;
  scrollingContainer(currentFlow()).scrollTop = top;
}
function quoteMatches(text, quote, prefix = "", suffix = "") {
  if (!quote) return [];
  const matches = [];
  let position = text.indexOf(quote);
  while (position !== -1) {
    const end = position + quote.length;
    if ((!prefix || text.slice(0, position).endsWith(prefix)) && (!suffix || text.slice(end).startsWith(suffix))) {
      matches.push({ start: position, end });
      if (matches.length > 1) break;
    }
    position = text.indexOf(quote, position + 1);
  }
  return matches;
}
function elementOf(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}
function readableRangeText(range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll(DOM_CONFIG.excludedText).forEach((element) => element.remove());
  return (fragment.textContent ?? "").replace(ZERO_WIDTH, "");
}
function completedTurn(flow, sessionId) {
  const rows = flowRows(flow);
  const start = rows.indexOf(flow);
  if (start < 0) return void 0;
  const turn = flow.dataset.chatTurn;
  for (let index = start + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (turn && row.dataset.chatTurn && row.dataset.chatTurn !== turn || DOM_CONFIG.inputKinds.has(row.dataset.chatFlowKind ?? "")) return void 0;
    if (!row.matches(DOM_CONFIG.tail)) continue;
    const marker = row.querySelector(DOM_CONFIG.turnEnd);
    if (!marker || !markerSessionMatches(marker, sessionId)) return void 0;
    const seq = markerSequence(marker);
    return seq === void 0 ? void 0 : { seq, tail: row };
  }
  return void 0;
}
function flowRows(flow) {
  const container = scrollingContainer(flow);
  return [...container.querySelectorAll(DOM_CONFIG.flow)];
}
function assistantFlowsInTurn(tail) {
  const rows = flowRows(tail);
  const index = rows.indexOf(tail);
  const turn = tail.dataset.chatTurn;
  const flows = [];
  for (let position = index - 1; position >= 0; position -= 1) {
    const row = rows[position];
    if (row.matches(DOM_CONFIG.tail) || turn && row.dataset.chatTurn && row.dataset.chatTurn !== turn) break;
    if (row.matches(DOM_CONFIG.assistant)) flows.push(row);
    if (DOM_CONFIG.inputKinds.has(row.dataset.chatFlowKind ?? "")) break;
  }
  return flows.reverse();
}
function markerSequence(marker) {
  const value = marker.dataset.studyTurnEnd;
  if (!value || !/^\d+$/u.test(value)) return void 0;
  const seq = Number(value);
  return Number.isSafeInteger(seq) ? seq : void 0;
}
function markerSessionMatches(marker, sessionId) {
  return marker.dataset.studySessionId === void 0 || marker.dataset.studySessionId === sessionId;
}
function visibleTextIndex(flow) {
  const segments = [];
  let text = "";
  const pending = [flow];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.nodeType === Node.ELEMENT_NODE && node.matches(DOM_CONFIG.excludedText)) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      const cleaned = node.data.replace(ZERO_WIDTH, "");
      if (!cleaned) continue;
      const start = text.length;
      text += cleaned;
      if (text.length > DOM_CONFIG.maximumFlowCharacters) return void 0;
      segments.push({ node, start, end: text.length });
      continue;
    }
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) pending.push(node.childNodes[index]);
  }
  return { text, segments };
}
function rawOffset(segment, localOffset) {
  let visibleOffset = 0;
  for (let index = 0; index < segment.node.data.length; index += 1) {
    if (/[\u200B-\u200D\u2060\uFEFF]/u.test(segment.node.data[index])) continue;
    if (visibleOffset === localOffset) return index;
    visibleOffset += 1;
  }
  return void 0;
}
function domRange(index, match) {
  const start = index.segments.find((segment) => match.start >= segment.start && match.start < segment.end);
  const end = index.segments.find((segment) => match.end - 1 >= segment.start && match.end - 1 < segment.end);
  if (!start || !end) return void 0;
  const startOffset = rawOffset(start, match.start - start.start);
  const endOffset = rawOffset(end, match.end - 1 - end.start);
  if (startOffset === void 0 || endOffset === void 0) return void 0;
  const range = document.createRange();
  range.setStart(start.node, startOffset);
  range.setEnd(end.node, endOffset + 1);
  return range;
}
function currentFlow() {
  return [...document.querySelectorAll(DOM_CONFIG.flow)].find((element) => !element.closest(DOM_CONFIG.plugin) && visible(element));
}
function scrollingContainer(flow) {
  let element = flow?.parentElement;
  while (element && element !== document.body) {
    if (/(auto|scroll|overlay)/u.test(getComputedStyle(element).overflowY)) return element;
    element = element.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}
function visible(element) {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}
function flashSource(range) {
  clearSourceHighlight?.();
  const css = globalThis.CSS;
  const HighlightConstructor = globalThis.Highlight;
  const owned = [];
  if (css?.highlights && HighlightConstructor) {
    css.highlights.set(DOM_CONFIG.highlightName, new HighlightConstructor(range));
    const style = document.createElement("style");
    style.textContent = `::highlight(${DOM_CONFIG.highlightName}) { background: ${DOM_CONFIG.highlightColor}; }`;
    document.head.appendChild(style);
    owned.push(style);
  } else {
    for (const rect of range.getClientRects()) {
      const overlay = document.createElement("span");
      overlay.dataset.studyPlugin = "source-highlight";
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        background: DOM_CONFIG.highlightColor,
        pointerEvents: "none",
        zIndex: "1000"
      });
      document.body.appendChild(overlay);
      owned.push(overlay);
    }
  }
  let timer;
  const dispose = () => {
    window.clearTimeout(timer);
    css?.highlights?.delete(DOM_CONFIG.highlightName);
    owned.forEach((element) => element.remove());
    if (clearSourceHighlight === dispose) clearSourceHighlight = void 0;
  };
  clearSourceHighlight = dispose;
  timer = window.setTimeout(dispose, DOM_CONFIG.highlightMilliseconds);
}

// src/naming.ts
function initialBranchTitle(question) {
  return Array.from(question.trim().replace(/\s+/gu, " ")).slice(0, CONFIG.fallbackTitleLength).join("");
}

// src/controller.ts
var StudyController = class {
  adapter;
  ctx;
  listeners = /* @__PURE__ */ new Set();
  state;
  revision = 0;
  positions = {};
  pendingFork;
  disposed = false;
  mutationTimer;
  restoring = 0;
  timers = /* @__PURE__ */ new Set();
  draftVersion = 0;
  titleRequests = /* @__PURE__ */ new Set();
  /** Args: ctx: Public injected host/client services for this plugin instance. */
  constructor(ctx) {
    this.ctx = ctx;
    this.adapter = new DshAdapter(ctx);
    const preferences = this.readPreferences();
    this.positions = preferences.positions ?? {};
    this.pendingFork = preferences.pendingFork;
    this.state = {
      tree: emptyTree(),
      catalog: [],
      loaded: false,
      busy: false,
      enabled: preferences.enabled ?? true,
      currentId: preferences.currentId,
      selectionExpanded: false,
      nativeSelection: false,
      historyOpen: false,
      runningIds: [],
      pendingFork: this.pendingFork ? { id: this.pendingFork.id, title: this.pendingFork.title } : void 0
    };
  }
  /** Returns: The identity-stable snapshot used by React external-store hooks. */
  getSnapshot = () => this.state;
  /** Args: listener: React invalidation callback. Returns: Its independent cleanup. */
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Start observations and restore the host-owned navigation snapshot. */
  start() {
    const unsubscribe = this.adapter.subscribe(() => this.refreshCatalog());
    const observer = new MutationObserver(() => this.scheduleDisplay());
    observer.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
    const onUnload = () => this.savePosition();
    window.addEventListener("pagehide", onUnload);
    this.applyDisplay();
    this.run(() => this.reload());
    return () => {
      this.savePosition();
      this.disposed = true;
      unsubscribe();
      observer.disconnect();
      window.removeEventListener("pagehide", onUnload);
      for (const timer of this.timers) clearTimeout(timer);
      if (this.mutationTimer) clearTimeout(this.mutationTimer);
      document.documentElement.classList.remove("dsh-study-tree-selection");
      this.clearInheritedPresentation();
      this.listeners.clear();
    };
  }
  /** Args: task: One user action whose failure must remain visible. */
  run(task) {
    void task().catch((error) => {
      if (!this.disposed) this.update({ error: error instanceof Error ? error.message : String(error) });
    });
  }
  /** Re-read persistent relationships without creating or opening conversations. */
  async reload() {
    const saved = await this.rpc("read", {});
    this.revision = saved.revision;
    this.update({ tree: parseTree(saved.tree), loaded: true, error: void 0 });
    this.refreshCatalog();
    this.applyDisplay();
  }
  /** Clear an acknowledged error without modifying saved navigation. */
  clearError() {
    this.update({ error: void 0 });
  }
  /** Toggle only the navigation pane; selection and conversation state stay usable. */
  toggleEnabled() {
    this.savePosition();
    this.update({ enabled: !this.state.enabled, selection: void 0 });
    this.persistPreferences();
    this.applyDisplay();
  }
  /** Args: id: Main Conversation identity. running: Host-reported execution state. */
  setCurrent(id, running) {
    if (this.disposed) return;
    const changed = this.state.currentId !== id;
    const runningIds = running === void 0 ? this.state.runningIds : running ? [.../* @__PURE__ */ new Set([...this.state.runningIds, id])] : this.state.runningIds.filter((item) => item !== id);
    if (changed || runningIds.join() !== this.state.runningIds.join()) {
      this.update({ currentId: id, runningIds, ...changed ? { selection: void 0, historyOpen: false, draft: void 0 } : {} });
      this.persistPreferences();
      this.scheduleDisplay();
      if (changed) {
        this.titleRequests.delete(id);
        this.refreshCatalog();
      }
    }
  }
  /** Args: selection: A safely captured completed-turn source. native: Use the host popover. */
  setSelection(selection, native) {
    if (!this.state.loaded || this.state.busy) return;
    this.update({ selection, nativeSelection: native, selectionExpanded: false });
  }
  /** Show the question editor for a captured source. */
  expandSelection() {
    this.update({ selectionExpanded: true });
  }
  /**
   * Closes study UI while preserving selections and carets owned by host editors.
   *
   * Repeated native mouseup/keyup events are no-ops when no study UI is active.
   * Browser selection consumption belongs to the host's explicit fork action.
   */
  dismissSelection() {
    if (!this.state.selection && !this.state.selectionExpanded) return;
    this.update({ selection: void 0, selectionExpanded: false });
  }
  /** Args: dialog: Existing-session picker or one navigation node to manage. */
  setDialog(dialog) {
    this.refreshCatalog();
    this.update({ dialog });
  }
  /** Add the current host Conversation as a new learning root. */
  async addCurrent() {
    const id = this.state.currentId;
    if (!id) throw new Error("\u5148\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u518D\u52A0\u5165\u5B66\u4E60\u6811\u3002");
    if (this.state.tree.nodes.some((node) => node.id === id)) return;
    await this.attachExisting(id, null);
  }
  /** Args: id: Existing DSH Session. parentId: Navigation parent or a new root. */
  async attachExisting(id, parentId) {
    this.assertAvailable();
    const item = this.adapter.catalog().find((entry) => entry.id === id);
    if (!item) throw new Error("\u8FD9\u4E2A\u4F1A\u8BDD\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5237\u65B0\u4F1A\u8BDD\u5217\u8868\u3002");
    await this.saveTree(attachSession(this.state.tree, { id, parentId, title: item.title, createdAt: Date.now() }));
    this.update({ dialog: void 0 });
  }
  /** Args: id: Node to edit. title: Display title. parentId: Its chosen navigation parent. */
  async editNode(id, title, parentId) {
    this.assertAvailable();
    const node = this.state.tree.nodes.find((entry) => entry.id === id);
    if (!node) throw new Error("\u627E\u4E0D\u5230\u8FD9\u4E2A\u5B66\u4E60\u5206\u652F\u3002");
    const normalized = title.trim().slice(0, CONFIG.titleLength);
    if (!normalized) throw new Error("\u8BF7\u586B\u5199\u5206\u652F\u540D\u79F0\u3002");
    const moved = moveNode(this.state.tree, id, parentId);
    if (normalized !== node.title) {
      await this.adapter.rename(id, normalized);
      this.refreshCatalog();
    }
    await this.saveTree(attachSession(moved, { ...node, title: this.adapter.catalog().find((item) => item.id === id)?.title ?? normalized, parentId }));
    this.update({ dialog: void 0 });
  }
  /** Args: id: Branch to sort. drop: Same-parent edge, revalidated before writing. */
  async relocate(id, drop) {
    this.assertAvailable();
    const tree = relocateBranch(this.state.tree, id, drop);
    if (tree.nodes.every((node, index) => node.id === this.state.tree.nodes[index]?.id)) return;
    this.update({ busy: true, error: void 0 });
    try {
      await this.saveTree(tree);
    } finally {
      this.update({ busy: false });
    }
  }
  /** Args: id: Navigation branch to detach. Recorded DSH Sessions are retained. */
  async detach(id) {
    this.assertAvailable();
    await this.saveTree(detachBranch(this.state.tree, id));
    this.update({ dialog: void 0 });
  }
  /** Args: id: Node whose descendants should expand or collapse. */
  async toggleNode(id) {
    this.assertAvailable();
    const node = this.state.tree.nodes.find((entry) => entry.id === id);
    if (node) await this.saveTree(attachSession(this.state.tree, { ...node, collapsed: !node.collapsed }));
  }
  /** Args: id: Real host Session to display in its normal chat surface. */
  async navigate(id) {
    if (this.state.draft) this.cancelDraft(false);
    this.savePosition();
    const generation = ++this.restoring;
    await this.adapter.open(id);
    this.setCurrent(id);
    const top = this.positions[id];
    if (top !== void 0) this.afterHistory(id, generation, () => {
      restoreScrollPosition(top);
      return true;
    });
  }
  /**
   * Create a contextual child and send the user's question to its normal Agent.
   *
   * Args:
   *   question: New user turn, appended after the inherited prefix.
   *   title: Optional short navigation label.
   */
  async fork(question, title) {
    const capture = this.state.selection;
    if (!capture) throw new Error("\u8BF7\u91CD\u65B0\u9009\u4E2D\u4E00\u6BB5\u5DF2\u5B8C\u6210\u7684\u56DE\u7B54\u3002");
    if (!question.trim()) throw new Error("\u8BF7\u5199\u4E0B\u60F3\u8FDB\u4E00\u6B65\u4E86\u89E3\u7684\u95EE\u9898\u3002");
    if (this.state.busy) throw new Error("\u6B63\u5728\u521B\u5EFA\u5206\u652F\uFF0C\u8BF7\u7A0D\u5019\u3002");
    if (this.pendingFork) throw new Error("\u8FD8\u6709\u4E00\u4E2A\u5DF2\u521B\u5EFA\u7684\u5206\u652F\u7B49\u5F85\u6062\u590D\uFF0C\u8BF7\u5148\u70B9\u51FB\u300C\u6062\u590D\u8FD9\u4E2A\u5206\u652F\u300D\u3002");
    this.update({ busy: true, error: void 0 });
    const parentId = capture.source.sessionId;
    this.savePosition();
    let childId;
    try {
      if (!this.state.tree.nodes.some((node) => node.id === parentId)) {
        const item = this.adapter.catalog().find((entry) => entry.id === parentId);
        await this.saveTree(attachSession(this.state.tree, { id: parentId, parentId: null, title: item?.title ?? "\u5B66\u4E60\u4E3B\u9898", createdAt: Date.now() }));
      }
      childId = await this.adapter.fork(capture.source);
      const label = (title?.trim() || capture.source.quote).replace(/\s+/g, " ").slice(0, CONFIG.titleLength);
      this.pendingFork = { id: childId, title: label, source: capture.source, question: question.trim(), promptAttempted: false };
      this.update({ pendingFork: { id: childId, title: label } });
      this.persistPreferences();
      await this.finishPendingFork();
    } catch (error) {
      if (childId) {
        await this.adapter.open(childId).catch(() => void 0);
        this.setCurrent(childId);
      }
      throw error;
    } finally {
      this.update({ busy: false });
    }
  }
  /**
   * Opens an in-memory draft without creating a host session or a navigation node.
   * The completed source boundary is frozen before the first message is sent.
   */
  async newBranch() {
    this.assertAvailable();
    if (this.state.draft) return;
    const parentId = this.state.currentId;
    if (!parentId) throw new Error("\u5148\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u518D\u65B0\u5F00\u5B66\u4E60\u5206\u652F\u3002");
    if (this.pendingFork) throw new Error("\u8FD8\u6709\u4E00\u4E2A\u5DF2\u521B\u5EFA\u7684\u5206\u652F\u7B49\u5F85\u6062\u590D\uFF0C\u8BF7\u5148\u70B9\u51FB\u300C\u6062\u590D\u8FD9\u4E2A\u5206\u652F\u300D\u3002");
    this.update({ busy: true, error: void 0 });
    this.savePosition();
    const origin = { sessionId: parentId, scrollTop: this.positions[parentId] };
    const token = ++this.draftVersion;
    try {
      origin.seq = await this.adapter.completedTurnEnd(parentId);
      if (token !== this.draftVersion || this.state.currentId !== parentId) return;
      this.update({
        draft: { token, parentId, origin, question: "", presentation: this.adapter.draftPresentation() },
        enabled: window.innerWidth < CONFIG.narrowWidth ? false : this.state.enabled,
        selection: void 0
      });
      this.persistPreferences();
      this.adapter.showDraft(true);
    } finally {
      this.update({ busy: false });
    }
  }
  /** Args: question: Unsent text, held only in the temporary page's memory. */
  setDraftQuestion(question) {
    if (this.state.draft) this.update({ draft: { ...this.state.draft, question } });
  }
  /** Args: returnToChat: Restore native chat on explicit cancellation. token: Ignore stale page cleanup. */
  cancelDraft(returnToChat = true, token) {
    if (token !== void 0 && this.state.draft?.token !== token) return;
    this.draftVersion += 1;
    this.update({ draft: void 0 });
    if (returnToChat) {
      this.adapter.showDraft(false);
      const id = this.state.currentId;
      const top = id ? this.positions[id] : void 0;
      if (id && top !== void 0) this.afterHistory(id, ++this.restoring, () => {
        restoreScrollPosition(top);
        return true;
      });
    }
  }
  /** Materialize the draft once the user explicitly sends its first question. */
  async submitDraft() {
    this.assertAvailable();
    const draft = this.state.draft;
    if (!draft?.question.trim()) throw new Error("\u8BF7\u5148\u5199\u4E0B\u60F3\u4E86\u89E3\u7684\u95EE\u9898\u3002");
    if (this.pendingFork) throw new Error("\u8BF7\u5148\u6062\u590D\u5DF2\u7ECF\u521B\u5EFA\u7684\u5B66\u4E60\u5206\u652F\u3002");
    const question = draft.question.trim();
    const title = initialBranchTitle(question);
    this.update({ busy: true, error: void 0 });
    let childId;
    try {
      await this.adapter.fork(draft.origin, (id) => {
        childId = id;
        this.pendingFork = { id, title, origin: draft.origin, question, promptAttempted: false };
        this.update({ draft: void 0, pendingFork: { id, title } });
        this.persistPreferences();
      });
      await this.finishPendingFork();
    } catch (error) {
      if (childId) {
        await this.adapter.open(childId).catch(() => void 0);
        this.setCurrent(childId);
      }
      throw error;
    } finally {
      this.update({ busy: false });
    }
  }
  /** Resume an already created child after an interrupted navigation/save operation. */
  async recoverFork() {
    this.assertAvailable();
    if (!this.pendingFork) return;
    this.update({ busy: true, error: void 0 });
    try {
      await this.finishPendingFork(true);
    } finally {
      this.update({ busy: false });
    }
  }
  /** Args: recovering: Reuse the existing child without guessing legacy inherited boundaries. */
  async finishPendingFork(recovering = false) {
    const pending = this.pendingFork;
    if (!pending) return;
    const provenance = pending.source ?? pending.origin;
    const parentId = provenance.sessionId;
    if (pending.origin && pending.origin.seq === void 0) {
      pending.origin.seq = await this.adapter.inheritedTurnEnd(pending.id, !recovering);
      this.persistPreferences();
    }
    let tree = this.state.tree;
    const parent = tree.nodes.find((node) => node.id === parentId);
    tree = attachSession(tree, parent ? { ...parent, collapsed: false } : {
      id: parentId,
      parentId: null,
      title: this.adapter.catalog().find((entry) => entry.id === parentId)?.title ?? "\u5B66\u4E60\u4E3B\u9898",
      createdAt: Date.now()
    });
    tree = attachSession(tree, {
      id: pending.id,
      parentId,
      title: pending.title,
      ...pending.source ? { source: pending.source } : { origin: pending.origin },
      createdAt: Date.now()
    });
    await this.saveTree(tree);
    this.dismissSelection();
    await this.adapter.open(pending.id);
    this.setCurrent(pending.id);
    await this.adapter.rename(pending.id, pending.title);
    if (pending.source || pending.question) {
      if (!pending.promptAttempted) {
        pending.promptAttempted = true;
        this.persistPreferences();
        await this.adapter.prompt(pending.id, pending.source ? `\u5173\u4E8E\u521A\u624D\u56DE\u7B54\u4E2D\u7684\u300C${pending.source.quote}\u300D\uFF1A

${pending.question}` : pending.question);
        if (pending.origin) this.requestTitle(pending.id);
      } else {
        this.update({ error: "\u5DF2\u6062\u590D\u8FD9\u4E2A\u5206\u652F\u3002\u8BF7\u5728\u804A\u5929\u4E2D\u786E\u8BA4\u4E0A\u4E00\u6761\u95EE\u9898\u662F\u5426\u5DF2\u53D1\u9001\uFF0C\u518D\u7EE7\u7EED\u63D0\u95EE\u3002" });
      }
    }
    this.pendingFork = void 0;
    this.update({ pendingFork: void 0 });
    this.persistPreferences();
    this.afterHistory(pending.id, ++this.restoring, () => {
      this.applyDisplay();
      return true;
    });
  }
  /** Return to the saved parent passage and visibly locate the selected text. */
  async returnToSource() {
    const node = this.currentNode();
    const source = node?.source ?? node?.origin;
    if (!source) return;
    await this.navigate(source.sessionId);
    this.update({ historyOpen: true });
    this.applyDisplay();
    if (node?.source) this.afterHistory(source.sessionId, ++this.restoring, () => restoreSource(node.source), true);
    else if (source.scrollTop !== void 0) this.afterHistory(source.sessionId, ++this.restoring, () => {
      restoreScrollPosition(source.scrollTop);
      return true;
    });
  }
  /** Reversibly show or fold the history inherited by the current fork. */
  toggleHistory() {
    this.update({ historyOpen: !this.state.historyOpen });
    this.applyDisplay();
  }
  /** Returns: The selected learning node, if this Session belongs to the index. */
  currentNode() {
    return this.state.tree.nodes.find((node) => node.id === this.state.currentId);
  }
  /** Reject a conflicting edit while a host operation is being completed. */
  assertAvailable() {
    if (this.state.busy) throw new Error("\u6B63\u5728\u521B\u5EFA\u5B66\u4E60\u5206\u652F\u6216\u4FDD\u5B58\u4F4D\u7F6E\uFF0C\u8BF7\u7A0D\u540E\u518D\u64CD\u4F5C\u3002");
  }
  /** Args: partial: Changed view fields. Publish exactly one new stable snapshot. */
  update(partial) {
    if (this.disposed) return;
    this.state = { ...this.state, ...partial };
    document.documentElement.classList.toggle("dsh-study-tree-selection", Boolean(this.state.selection && !this.state.nativeSelection));
    for (const listener of this.listeners) listener();
  }
  /** Refresh titles and identities without retaining conversation histories. */
  refreshCatalog() {
    try {
      const catalog = this.adapter.catalog();
      this.update({ catalog, tree: this.projectTitles(this.state.tree, catalog) });
      const byId = new Map(catalog.map((item) => [item.id, item]));
      for (const node of this.state.tree.nodes) {
        const native = byId.get(node.id);
        const parent = node.origin ? byId.get(node.origin.sessionId) : void 0;
        if (node.origin && native && (native.title === "\u65B0\u60F3\u6CD5" || native.title === parent?.title)) this.requestTitle(node.id);
      }
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  /** Args: tree: Complete new relationships. Save before reporting the edit accepted. */
  async saveTree(tree) {
    if (!this.state.loaded) throw new Error("\u5B66\u4E60\u6811\u8FD8\u5728\u8F7D\u5165\uFF0C\u8BF7\u7A0D\u5019\u3002");
    try {
      const saved = await this.rpc("write", { tree, revision: this.revision });
      this.revision = saved.revision;
      this.update({ tree: this.projectTitles(parseTree(saved.tree), this.state.catalog) });
      this.applyDisplay();
    } catch (error) {
      if (error instanceof Error && error.message.includes("conflict")) {
        await this.reload();
        throw new Error("\u53E6\u4E00\u7A97\u53E3\u66F4\u65B0\u4E86\u5B66\u4E60\u6811\uFF0C\u5DF2\u8F7D\u5165\u6700\u65B0\u7248\u672C\uFF0C\u8BF7\u518D\u8BD5\u4E00\u6B21\u3002");
      }
      throw error;
    }
  }
  /** Args: endpoint: Read/write operation. payload: JSON-only validated navigation. */
  async rpc(endpoint, payload) {
    const connection = this.ctx.get("connection");
    const signal = AbortSignal.timeout(CONFIG.requestTimeoutMs);
    const response = await fetch(`./api/study-tree/${endpoint}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal
    });
    let result;
    if (response.status === 404 || response.status === 405) {
      result = await connection.rpc.call(CONFIG.rpcNamespace, endpoint, payload, signal);
    } else {
      if (!response.ok) throw new Error(`\u5B66\u4E60\u6811\u4FDD\u5B58\u901A\u9053\u8FD4\u56DE HTTP ${response.status}\u3002`);
      result = await response.json();
    }
    if (!result.ok || !result.value) throw new Error(result.error ? `${result.error.code}: ${result.error.message}` : "\u65E0\u6CD5\u4FDD\u5B58\u5B66\u4E60\u6811\uFF0C\u8BF7\u68C0\u67E5 DSH \u8FDE\u63A5\u3002");
    return result.value;
  }
  /** Read browser-only view preferences, independently from durable Host data. */
  readPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.browserKey) ?? "{}");
      const positions = {};
      if (saved.positions && typeof saved.positions === "object") for (const [id, top] of Object.entries(saved.positions)) {
        if (Number.isFinite(top) && top >= 0) positions[id] = top;
      }
      return {
        enabled: typeof saved.enabled === "boolean" ? saved.enabled : true,
        currentId: typeof saved.currentId === "string" ? saved.currentId : void 0,
        positions,
        pendingFork: this.parsePendingFork(saved.pendingFork)
      };
    } catch {
      return {};
    }
  }
  /** Args: value: Browser receipt. Returns: A validated legacy or no-prompt fork receipt. */
  parsePendingFork(value) {
    if (!value || typeof value.id !== "string" || typeof value.title !== "string") return void 0;
    if (!value.origin && (typeof value.question !== "string" || !value.source)) return void 0;
    const tree = parseTree({ schemaVersion: 1, nodes: [{
      id: value.id,
      parentId: null,
      title: value.title,
      createdAt: 0,
      source: value.source,
      origin: value.origin
    }] });
    const node = tree.nodes[0];
    return node.source ? { id: node.id, title: node.title, source: node.source, question: value.question, promptAttempted: value.promptAttempted === true } : { id: node.id, title: node.title, origin: node.origin, question: typeof value.question === "string" ? value.question : void 0, promptAttempted: value.promptAttempted === true };
  }
  /** Args: tree: Persisted relationships. catalog: Native title authority. Returns: A synchronized view. */
  projectTitles(tree, catalog) {
    const titles = new Map(catalog.map((item) => [item.id, item.title]));
    return { ...tree, nodes: tree.nodes.map((node) => ({ ...node, title: titles.get(node.id) ?? node.title })) };
  }
  /** Args: id: A submitted fork. attempt: Bounded wait for the native message commit. */
  requestTitle(id, attempt = 0) {
    if (this.disposed || attempt === 0 && this.titleRequests.has(id)) return;
    this.titleRequests.add(id);
    void this.rpc("title", { id }).then((result) => {
      if (result.ready === false && attempt < CONFIG.titleRetryLimit) {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          this.requestTitle(id, attempt + 1);
        }, CONFIG.titleRetryMs);
        this.timers.add(timer);
      } else this.refreshCatalog();
    }).catch((error) => {
      if (!this.disposed) this.update({ error: `\u5BF9\u8BDD\u5DF2\u53D1\u9001\uFF0C\u6682\u7528\u9996\u6761\u6D88\u606F\u4F5C\u4E3A\u6807\u9898\u3002\u81EA\u52A8\u8D77\u6807\u9898\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` });
    });
  }
  /** Persist a bounded UI preference snapshot; relationship data is stored by Host RPC. */
  persistPreferences() {
    const ids = new Set(this.state.tree.nodes.map((node) => node.id));
    const positions = Object.fromEntries(Object.entries(this.positions).filter(([id]) => ids.has(id)));
    try {
      localStorage.setItem(CONFIG.browserKey, JSON.stringify({ enabled: this.state.enabled, currentId: this.state.currentId, positions, pendingFork: this.pendingFork }));
    } catch (error) {
      this.update({ error: `\u9605\u8BFB\u4F4D\u7F6E\u672A\u4FDD\u5B58\uFF1A${error instanceof Error ? error.message : String(error)}` });
    }
  }
  /** Save the current main chat scroll position before changing its selection. */
  savePosition() {
    if (this.state.currentId) this.positions[this.state.currentId] = captureScrollPosition();
    this.persistPreferences();
  }
  /** Coalesce chat DOM updates without unbounded observers or polling. */
  scheduleDisplay() {
    if (this.mutationTimer || this.disposed) return;
    this.mutationTimer = setTimeout(() => {
      this.mutationTimer = void 0;
      this.applyDisplay();
    }, CONFIG.positionDelayMs);
  }
  /** Restore all inherited chat rows when leaving the learning presentation. */
  clearInheritedPresentation() {
    document.querySelectorAll("[data-study-inherited]").forEach((element) => {
      delete element.dataset.studyInherited;
    });
  }
  /** Fold a copied prefix visually while preserving every recorded Host event. */
  applyDisplay() {
    this.clearInheritedPresentation();
    const node = this.currentNode();
    const source = node?.source ?? node?.origin;
    if (this.state.historyOpen || source?.seq === void 0) return;
    const markers = [...document.querySelectorAll("[data-study-turn-end]")];
    const boundary = markers.find((marker) => marker.dataset.studySessionId === this.state.currentId && (Number(marker.dataset.studyTurnEnd) === source.seq || Number(marker.dataset.studySourceSeq) === source.seq));
    const tail = boundary?.closest('[data-chat-flow-kind="turn-tail"]');
    if (!tail?.parentElement) return;
    for (const row of [...tail.parentElement.children]) {
      if (row instanceof HTMLElement && row.hasAttribute("data-chat-flow-kind")) row.dataset.studyInherited = "true";
      if (row === tail) break;
    }
  }
  /** Args: id: Expected Session. generation: Navigation guard. restore: Safe DOM restoration attempt. */
  afterHistory(id, generation, restore, reportFailure = false) {
    const deadline = Date.now() + CONFIG.restoreTimeoutMs;
    const attempt = () => {
      if (this.disposed || generation !== this.restoring || this.state.currentId !== id) return;
      const ready = [...document.querySelectorAll("[data-study-session-id]")].some((marker) => marker.dataset.studySessionId === id);
      if (ready && restore()) return;
      if (Date.now() >= deadline) {
        if (reportFailure) this.update({ error: "\u5DF2\u6253\u5F00\u539F\u4F1A\u8BDD\uFF0C\u4F46\u539F\u6587\u4F4D\u7F6E\u6682\u65F6\u65E0\u6CD5\u552F\u4E00\u5B9A\u4F4D\u3002" });
        return;
      }
      const timer2 = setTimeout(() => {
        this.timers.delete(timer2);
        attempt();
      }, CONFIG.positionDelayMs);
      this.timers.add(timer2);
    };
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      attempt();
    }, CONFIG.positionDelayMs);
    this.timers.add(timer);
  }
};

// src/ui.tsx
var import_react2 = require("react");

// src/use-tree-drag.ts
var import_react = require("react");

// src/drag.ts
function dragActivated(start, current) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= CONFIG.dragThresholdPx;
}
function siblingDrop(source, hovered, clientY, rect) {
  if (!hovered || hovered.id === source.id || hovered.parentId !== source.parentId) return;
  return { id: hovered.id, position: clientY < rect.top + rect.height / 2 ? "before" : "after" };
}
function scrollVelocity(y, top, bottom) {
  if (y < top || y > bottom) return 0;
  const edge = Math.min(CONFIG.dragScrollEdgePx, (bottom - top) / 2);
  if (edge <= 0) return 0;
  if (y < top + edge) return -CONFIG.dragScrollPxPerSecond * (top + edge - y) / edge;
  if (y > bottom - edge) return CONFIG.dragScrollPxPerSecond * (y - bottom + edge) / edge;
  return 0;
}

// src/use-tree-drag.ts
function useTreeDrag(tree, disabled, viewport, move) {
  const byId = (0, import_react.useMemo)(() => new Map(tree.nodes.map((node) => [node.id, node])), [tree]);
  const latest = (0, import_react.useRef)({ byId, disabled, move });
  latest.current = { byId, disabled, move };
  const gesture = (0, import_react.useRef)();
  const frame = (0, import_react.useRef)();
  const preview = (0, import_react.useRef)(null);
  const saving = (0, import_react.useRef)(false);
  const mounted = (0, import_react.useRef)(false);
  const suppressClick = (0, import_react.useRef)(false);
  const [sourceId, setSourceId] = (0, import_react.useState)();
  const [target, setTarget] = (0, import_react.useState)();
  const [status, setStatus] = (0, import_react.useState)("");
  const positionPreview = (point) => {
    if (preview.current) preview.current.style.transform = `translate3d(${point.x + CONFIG.dragPreviewOffsetPx}px, ${point.y + CONFIG.dragPreviewOffsetPx}px, 0)`;
  };
  const destination = (current) => {
    const body = viewport.current;
    const source2 = latest.current.byId.get(current.id);
    if (!body || !source2 || source2.parentId !== current.parentId || latest.current.disabled) return;
    const bounds = body.getBoundingClientRect();
    const { x, y } = current.point;
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !body.contains(hit)) return;
    let row = hit.closest("[data-study-node-id]");
    if (!row) {
      let distance = CONFIG.dragRowGapPx;
      for (const item of body.querySelectorAll("[data-study-node-id]")) {
        const rect = item.getBoundingClientRect();
        const gap = Math.max(rect.top - y, y - rect.bottom, 0);
        if (gap <= distance) {
          distance = gap;
          row = item;
        }
      }
    }
    if (!row || !body.contains(row)) return;
    return siblingDrop(source2, latest.current.byId.get(row.dataset.studyNodeId), y, row.getBoundingClientRect());
  };
  const showTarget = (proposed) => {
    setTarget((previous) => previous?.id === proposed?.id && previous?.position === proposed?.position ? previous : proposed);
  };
  const cancel = (announce = false) => {
    const current = gesture.current;
    gesture.current = void 0;
    if (frame.current !== void 0) cancelAnimationFrame(frame.current);
    frame.current = void 0;
    if (current?.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
    if (mounted.current) {
      setSourceId(void 0);
      setTarget(void 0);
      if (announce && current?.active) setStatus("\u5DF2\u53D6\u6D88\u6392\u5E8F");
    }
  };
  const tick = (timestamp) => {
    frame.current = void 0;
    const current = gesture.current;
    const body = viewport.current;
    if (!current?.active || !body) return;
    if (latest.current.disabled) {
      cancel(true);
      return;
    }
    const bounds = body.getBoundingClientRect();
    const elapsed = Math.min(CONFIG.dragFrameMaxMs, current.frameAt === void 0 ? 0 : timestamp - current.frameAt);
    current.frameAt = timestamp;
    const velocity = current.point.x >= bounds.left && current.point.x <= bounds.right ? scrollVelocity(current.point.y, bounds.top, bounds.bottom) : 0;
    const previousTop = body.scrollTop;
    if (velocity) body.scrollTop += velocity * elapsed / 1e3;
    if (current.dirty || body.scrollTop !== previousTop) {
      current.dirty = false;
      positionPreview(current.point);
      showTarget(destination(current));
    }
    const canScroll = velocity < 0 ? body.scrollTop > 0 : velocity > 0 && body.scrollTop < body.scrollHeight - body.clientHeight;
    if (canScroll) frame.current = requestAnimationFrame(tick);
  };
  (0, import_react.useEffect)(() => {
    mounted.current = true;
    const movePointer = (event) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
        cancel(true);
        return;
      }
      current.point = { x: event.clientX, y: event.clientY };
      current.dirty = true;
      if (!current.active && dragActivated(current.start, current.point)) {
        current.active = true;
        suppressClick.current = true;
        setSourceId(current.id);
        setStatus("");
        showTarget(destination(current));
      }
      if (current.active) {
        event.preventDefault();
        if (frame.current === void 0) {
          current.frameAt = void 0;
          frame.current = requestAnimationFrame(tick);
        }
      }
    };
    const finish = (event) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.point = { x: event.clientX, y: event.clientY };
      const proposed = current.active ? destination(current) : void 0;
      if (current.active) {
        event.preventDefault();
        event.stopPropagation();
      }
      cancel();
      if (!current.active) return;
      if (!proposed) {
        setStatus("\u672A\u8C03\u6574\u4F4D\u7F6E\uFF1A\u53EA\u80FD\u5728\u540C\u4E00\u7236\u8282\u70B9\u4E0B\u6392\u5E8F");
        return;
      }
      if (saving.current) return;
      saving.current = true;
      setStatus("\u6B63\u5728\u4FDD\u5B58\u4F4D\u7F6E\u2026");
      void latest.current.move(current.id, proposed).then(() => {
        if (mounted.current) setStatus("\u4F4D\u7F6E\u5DF2\u4FDD\u5B58");
      }, (error) => {
        if (mounted.current) setStatus(`\u4FDD\u5B58\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => {
        saving.current = false;
      });
    };
    const abortPointer = (event) => {
      if (event.pointerId === gesture.current?.pointerId) cancel(true);
    };
    const key = (event) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel(true);
      } else if (gesture.current?.active && ["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const freshPress = () => {
      if (!gesture.current) suppressClick.current = false;
    };
    const blur = () => cancel(true);
    const refreshGeometry = () => {
      const current = gesture.current;
      if (!current?.active) return;
      current.dirty = true;
      if (frame.current === void 0) {
        current.frameAt = void 0;
        frame.current = requestAnimationFrame(tick);
      }
    };
    const body = viewport.current;
    body?.addEventListener("scroll", refreshGeometry, { passive: true });
    window.addEventListener("resize", refreshGeometry);
    window.addEventListener("pointerdown", freshPress, true);
    window.addEventListener("pointermove", movePointer, { passive: false, capture: true });
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", abortPointer, true);
    window.addEventListener("lostpointercapture", abortPointer, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    return () => {
      mounted.current = false;
      cancel();
      window.removeEventListener("pointerdown", freshPress, true);
      window.removeEventListener("pointermove", movePointer, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", abortPointer, true);
      window.removeEventListener("lostpointercapture", abortPointer, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
      body?.removeEventListener("scroll", refreshGeometry);
      window.removeEventListener("resize", refreshGeometry);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const current = gesture.current;
    if (current && (disabled || !byId.has(current.id) || byId.get(current.id)?.parentId !== current.parentId)) cancel(true);
  }, [disabled, byId]);
  const start = (event, id) => {
    const source2 = latest.current.byId.get(id);
    const element = event.target instanceof Element ? event.target : void 0;
    if (latest.current.disabled || saving.current || gesture.current || !source2 || !event.isPrimary || event.button !== 0) return;
    if (element?.closest('button, a, input, textarea, select, [contenteditable], [role="button"]')) return;
    if (event.pointerType === "touch" && !element?.closest(".study-drag-handle")) return;
    const point = { x: event.clientX, y: event.clientY };
    gesture.current = {
      id,
      pointerId: event.pointerId,
      parentId: source2.parentId,
      start: point,
      point,
      capture: event.currentTarget,
      active: false,
      dirty: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const captureClick = (event) => {
    if (suppressClick.current && event.detail > 0) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const previewRef = (element) => {
    preview.current = element;
    if (gesture.current) positionPreview(gesture.current.point);
  };
  const rowTitle = target ? byId.get(target.id)?.title : void 0;
  const source = sourceId ? byId.get(sourceId) : void 0;
  const siblingCount = source ? tree.nodes.filter((node) => node.parentId === source.parentId).length : 0;
  const hint = sourceId ? target ? `\u653E\u5728\u300C${rowTitle}\u300D${target.position === "before" ? "\u4E4B\u524D" : "\u4E4B\u540E"}` : siblingCount < 2 ? "\u5F53\u524D\u5C42\u7EA7\u53EA\u6709\u8FD9\u4E00\u4E2A\u5206\u652F \xB7 Esc \u53D6\u6D88" : "\u4EC5\u80FD\u5728\u540C\u4E00\u7236\u8282\u70B9\u4E0B\u6392\u5E8F \xB7 Esc \u53D6\u6D88" : status;
  return { sourceId, target, hint, start, captureClick, previewRef };
}

// src/ui.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function StudyOverlay({ controller }) {
  const state = (0, import_react2.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "study-tree-scrim",
        "data-study-open": state.enabled,
        "aria-label": "\u6536\u8D77\u5B66\u4E60\u5BFC\u822A",
        "aria-hidden": !state.enabled,
        tabIndex: -1,
        disabled: !state.enabled,
        onClick: () => controller.toggleEnabled()
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StudyNavigation, { controller, state }),
    state.draft?.presentation === "overlay" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "study-legacy-draft", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StudyDraftPage, { controller }) }),
    state.selection && !state.nativeSelection && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LegacySelection, { controller, state }),
    state.dialog === "attach" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AttachDialog, { controller, state }),
    state.dialog && state.dialog !== "attach" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ManageDialog, { controller, state, id: state.dialog }, state.dialog),
    state.error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-study-ui study-error", role: "alert", "data-study-plugin": "error", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: state.error }),
      state.pendingFork && !state.enabled && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-button study-button-primary", disabled: state.busy, onClick: () => controller.run(() => controller.recoverFork()), children: "\u6062\u590D\u8FD9\u4E2A\u5206\u652F" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-icon-button", "aria-label": "\u5173\u95ED\u9519\u8BEF\u63D0\u793A", onClick: () => controller.clearError(), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "close" }) })
    ] })
  ] });
}
function StudyHeaderAction({ controller, sessionId, useSession }) {
  const state = (0, import_react2.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const running = useSession ? useSession((snapshot) => snapshot.running === true) : void 0;
  (0, import_react2.useEffect)(() => {
    controller.setCurrent(sessionId, running);
  }, [controller, sessionId, running]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: `dsh-study-ui study-header-toggle${state.enabled ? " is-active" : ""}`,
      "data-study-plugin": "header",
      "data-study-current-session": sessionId,
      "aria-label": state.enabled ? "\u6536\u8D77\u5B66\u4E60\u5BFC\u822A" : "\u6253\u5F00\u5B66\u4E60\u5BFC\u822A",
      "aria-pressed": state.enabled,
      title: state.enabled ? "\u6536\u8D77\u5B66\u4E60\u5BFC\u822A" : "\u6253\u5F00\u5B66\u4E60\u5BFC\u822A",
      onClick: () => controller.toggleEnabled(),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "tree" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5B66\u4E60" })
      ]
    }
  );
}
function NativeForkSurface({ controller, dismiss, clearSelection }) {
  const state = (0, import_react2.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (!state.selection) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ForkContent, { controller, state, dismiss, clearSelection }, selectionKey(state));
}
function StudyNavigation({ controller, state }) {
  const navigation = (0, import_react2.useRef)(null);
  const viewport = (0, import_react2.useRef)(null);
  const drag = useTreeDrag(
    state.tree,
    !state.loaded || !state.enabled || state.busy,
    viewport,
    (id, drop) => controller.relocate(id, drop)
  );
  (0, import_react2.useLayoutEffect)(() => {
    const drawer = navigation.current;
    if (!drawer) return;
    if (!state.enabled && drawer.contains(document.activeElement)) {
      (document.querySelector('[data-study-plugin="header"]') ?? document.querySelector("[data-study-draft-toggle]"))?.focus();
    }
    drawer.inert = !state.enabled;
    drawer.setAttribute("aria-hidden", String(!state.enabled));
  }, [state.enabled]);
  const draftPath = new Set(state.draft && state.tree.nodes.some((node) => node.id === state.draft.parentId) ? ancestors(state.tree, state.draft.parentId).map((node) => node.id) : []);
  const rows = visibleRows(state.draft ? { ...state.tree, nodes: state.tree.nodes.map((node) => draftPath.has(node.id) ? { ...node, collapsed: false } : node) } : state.tree);
  let dropAnchorId = drag.target?.id;
  const targetRow = rows.findIndex((row) => row.node.id === drag.target?.id);
  if (drag.target?.position === "after" && targetRow >= 0) {
    for (let index = targetRow + 1; index < rows.length && rows[index].depth > rows[targetRow].depth; index += 1) {
      dropAnchorId = rows[index].node.id;
    }
  }
  const dropDepth = rows[targetRow]?.depth ?? 0;
  const dropAfterDraft = drag.target?.position === "after" && Boolean(state.draft) && state.draft?.parentId === dropAnchorId;
  const topicCount = state.tree.nodes.filter((node) => node.parentId === null).length;
  const active = state.tree.nodes.find((node) => node.id === state.currentId);
  const currentOutsideTree = Boolean(state.currentId && !active);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "aside",
    {
      ref: navigation,
      className: "dsh-study-ui study-navigation",
      "aria-label": "\u5B66\u4E60\u5BFC\u822A",
      "data-study-plugin": "navigation",
      "data-study-open": state.enabled,
      "data-study-sorting": Boolean(drag.sourceId),
      onClickCapture: drag.captureClick,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "study-navigation-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-navigation-title", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "tree" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5B66\u4E60\u5BFC\u822A" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-icon-button", "aria-label": "\u6536\u8D77\u5B66\u4E60\u5BFC\u822A", title: "\u6536\u8D77\u5B66\u4E60\u5BFC\u822A", onClick: () => controller.toggleEnabled(), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "collapse" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: "study-new-branch",
            disabled: !state.loaded || !state.currentId || state.busy || Boolean(state.pendingFork),
            title: "\u4ECE\u5F53\u524D\u4F1A\u8BDD\u7EE7\u627F\u4E0A\u4E0B\u6587\uFF0C\u6253\u5F00\u65B0\u7684\u5B50\u5206\u652F\u5BF9\u8BDD",
            onClick: () => controller.run(() => controller.newBranch()),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "plus" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u65B0\u5F00\u5BF9\u8BDD" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "\u5F53\u524D\u4F1A\u8BDD\u4E0B" })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-tree-heading", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: topicCount === 0 ? "\u5B66\u4E60\u4E3B\u9898" : `${topicCount} \u4E2A\u4E3B\u9898 \xB7 ${state.tree.nodes.length} \u4E2A\u4F1A\u8BDD` }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavigationManagement, { controller, state })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: viewport, className: "study-tree-body", onDragStart: (event) => event.preventDefault(), children: [
          state.pendingFork && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-recovery", role: "status", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u5206\u652F\u5DF2\u521B\u5EFA\uFF0C\u7B49\u5F85\u6062\u590D" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { title: state.pendingFork.title, children: state.pendingFork.title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-button study-button-primary", disabled: state.busy, onClick: () => controller.run(() => controller.recoverFork()), children: "\u6062\u590D\u8FD9\u4E2A\u5206\u652F" })
          ] }),
          !state.loaded ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "study-empty-copy", role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u5B66\u4E60\u5BFC\u822A\u2026" }) : rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-empty", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "study-empty-title", children: "\u4ECE\u4E00\u4E2A\u4F1A\u8BDD\u5F00\u59CB\u5B66\u4E60" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "study-empty-copy", children: "\u4EE5\u5F53\u524D\u4F1A\u8BDD\u4E3A\u8D77\u70B9\uFF0C\u5212\u8BCD\u5C55\u5F00\u7684\u5206\u652F\u4F1A\u7559\u5728\u540C\u4E00\u4E2A\u5B66\u4E60\u4E3B\u9898\u4E2D\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-button study-button-primary", disabled: !state.currentId || state.busy, onClick: () => controller.run(() => controller.addCurrent()), children: "\u4EE5\u5F53\u524D\u4F1A\u8BDD\u5F00\u59CB" })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "tree", "aria-label": "\u5B66\u4E60\u4F1A\u8BDD\u6811", className: "study-tree-list", children: rows.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-tree-entry", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "div",
              {
                role: "treeitem",
                "aria-label": row.node.title,
                "aria-level": row.depth + 1,
                "aria-selected": !state.draft && row.node.id === state.currentId,
                "aria-expanded": row.hasChildren ? !row.node.collapsed : void 0,
                "aria-disabled": state.busy || void 0,
                tabIndex: !state.draft && (row.node.id === state.currentId || !active && index === 0) ? 0 : -1,
                className: `study-tree-row${row.node.parentId === null ? " is-topic" : ""}${!state.draft && row.node.id === state.currentId ? " is-active" : ""}`,
                style: { "--study-depth": row.depth, "--study-drop-depth": dropDepth },
                "data-study-node-id": row.node.id,
                title: row.node.title,
                "data-study-dragging": drag.sourceId === row.node.id || void 0,
                "data-study-drop": drag.target && !dropAfterDraft && dropAnchorId === row.node.id ? drag.target.position : void 0,
                "data-study-drop-for": drag.target && !dropAfterDraft && dropAnchorId === row.node.id ? drag.target.id : void 0,
                onPointerDown: (event) => drag.start(event, row.node.id),
                onClick: () => {
                  if (!state.busy) controller.run(() => controller.navigate(row.node.id));
                },
                onKeyDown: (event) => treeKey(event, row.node, rows.map((item) => item.node), controller, state.busy || Boolean(drag.sourceId)),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-drag-handle", "aria-hidden": "true", title: "\u62D6\u52A8\u8C03\u6574\u540C\u4E00\u7236\u8282\u70B9\u4E0B\u7684\u987A\u5E8F", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "grip" }) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-tree-indent", "aria-hidden": "true", children: Array.from({ length: row.depth }, (_, depth) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}, depth)) }),
                  row.hasChildren ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      tabIndex: -1,
                      className: `study-tree-chevron${row.node.collapsed ? "" : " is-open"}`,
                      "aria-label": `${row.node.collapsed ? "\u5C55\u5F00" : "\u6536\u8D77"}\u201C${row.node.title}\u201D`,
                      disabled: state.busy || draftPath.has(row.node.id),
                      onClick: (event) => {
                        event.stopPropagation();
                        controller.run(() => controller.toggleNode(row.node.id));
                      },
                      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "chevron" })
                    }
                  ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-tree-leaf", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-tree-label", children: row.node.title }),
                  row.node.parentId === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-node-kind", title: "\u6B64\u6839\u4F1A\u8BDD\u53CA\u5176\u6240\u6709\u5206\u652F\u7EC4\u6210\u4E00\u4E2A\u5B66\u4E60\u4E3B\u9898", children: "\u4E3B\u9898" }) : !row.node.source && !row.node.origin && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-node-kind", title: "\u4EC5\u52A0\u5165\u5BFC\u822A\uFF0C\u6CBF\u7528\u8BE5\u4F1A\u8BDD\u539F\u6709\u7684 Agent \u4E0A\u4E0B\u6587", children: "\u5173\u8054" }),
                  state.runningIds.includes(row.node.id) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-running", title: "\u6B63\u5728\u56DE\u7B54", "aria-label": "\u6B63\u5728\u56DE\u7B54" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-icon-button study-node-menu", "aria-label": `\u7BA1\u7406\u201C${row.node.title}\u201D`, title: "\u7BA1\u7406\u4F1A\u8BDD\u8282\u70B9", disabled: state.busy, onClick: (event) => {
                    event.stopPropagation();
                    controller.setDialog(row.node.id);
                  }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "more" }) })
                ]
              }
            ),
            state.draft?.parentId === row.node.id && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              DraftTreeRow,
              {
                controller,
                depth: row.depth + 1,
                busy: state.busy,
                dropAfter: dropAfterDraft && dropAnchorId === row.node.id,
                dropDepth
              }
            )
          ] }, row.node.id)) }),
          state.loaded && currentOutsideTree && rows.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "study-add-current", disabled: state.busy, onClick: () => controller.run(() => controller.addCurrent()), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "plus" }),
            "\u4EE5\u5F53\u524D\u4F1A\u8BDD\u5F00\u59CB\u65B0\u4E3B\u9898"
          ] })
        ] }),
        drag.sourceId && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: drag.previewRef, className: "study-drag-preview", "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "grip" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: state.tree.nodes.find((node) => node.id === drag.sourceId)?.title })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "study-drag-status", role: "status", "aria-live": "polite", title: drag.hint || void 0, children: drag.hint || "\u62D6\u52A8\u5206\u652F\u53EF\u8C03\u6574\u540C\u7EA7\u987A\u5E8F" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", { className: "study-navigation-footer", children: active?.source || active?.origin ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "study-source-caption", children: active.source ? "\u4ECE\u8FD9\u91CC\u5C55\u5F00" : "\u7EE7\u627F\u81EA\u6765\u6E90\u4F1A\u8BDD" }),
          active.source ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("blockquote", { className: "study-source-quote", title: active.source.quote, children: active.source.quote }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "study-origin-title", children: state.tree.nodes.find((node) => node.id === active.origin.sessionId)?.title ?? state.catalog.find((node) => node.id === active.origin.sessionId)?.title ?? "\u539F\u4F1A\u8BDD" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "study-source-return", disabled: state.busy, onClick: () => controller.run(() => controller.returnToSource()), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "return" }),
            active.source ? "\u56DE\u5230\u539F\u6587" : "\u56DE\u5230\u6765\u6E90\u4F1A\u8BDD"
          ] }),
          (active.source?.seq ?? active.origin?.seq) !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: `study-history-toggle${state.historyOpen ? " is-active" : ""}`, "aria-pressed": state.historyOpen, onClick: () => controller.toggleHistory(), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "history" }),
            state.historyOpen ? "\u6536\u8D77\u7EE7\u627F\u5BF9\u8BDD" : "\u67E5\u770B\u7EE7\u627F\u5BF9\u8BDD",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "chevron" })
          ] })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "study-navigation-hint", children: [
          "\u9009\u4E2D\u56DE\u7B54\u4E2D\u7684\u6587\u5B57\uFF0C",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
          "\u4ECE\u4E00\u4E2A\u95EE\u9898\u7EE7\u7EED\u6DF1\u5165\u3002"
        ] }) })
      ]
    }
  );
}
function DraftTreeRow({ controller, depth, busy, dropAfter, dropDepth }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      role: "treeitem",
      "aria-label": "\u65B0\u5BF9\u8BDD\uFF0C\u672A\u53D1\u9001",
      "aria-level": depth + 1,
      "aria-selected": "true",
      tabIndex: 0,
      className: "study-tree-row study-draft-row is-active",
      "data-study-plugin": "draft-node",
      "data-study-drop": dropAfter ? "after" : void 0,
      style: { "--study-drop-depth": dropDepth },
      onClick: () => document.querySelector("[data-study-draft-input]")?.focus(),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-drag-handle", "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-tree-indent", "aria-hidden": "true", children: Array.from({ length: depth }, (_, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}, index)) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-tree-leaf", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "plus" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-tree-label", children: "\u65B0\u5BF9\u8BDD" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "study-node-kind", children: "\u672A\u53D1\u9001" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-icon-button", "aria-label": "\u53D6\u6D88\u65B0\u5BF9\u8BDD", disabled: busy, onClick: (event) => {
          event.stopPropagation();
          controller.cancelDraft();
        }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "close" }) })
      ]
    }
  );
}
function StudyDraftPage({ controller }) {
  const state = (0, import_react2.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const draft = state.draft;
  const mounted = (0, import_react2.useRef)(false);
  (0, import_react2.useEffect)(() => {
    if (!draft) {
      controller.cancelDraft();
      return;
    }
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) controller.cancelDraft(false, draft.token);
      });
    };
  }, [controller, draft?.token]);
  if (!draft) return null;
  const parentTitle = state.tree.nodes.find((node) => node.id === draft.parentId)?.title ?? state.catalog.find((node) => node.id === draft.parentId)?.title ?? "\u5F53\u524D\u4F1A\u8BDD";
  const submit = (event) => {
    event.preventDefault();
    if (!state.busy && draft.question.trim()) controller.run(() => controller.submitDraft());
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-study-ui study-draft-page", "data-study-plugin": "draft", "aria-label": "\u65B0\u5BF9\u8BDD\u8349\u7A3F", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "study-draft-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u65B0\u5BF9\u8BDD" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-draft-header-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "study-header-toggle", "data-study-draft-toggle": true, "aria-label": state.enabled ? "\u6536\u8D77\u5B66\u4E60\u5BFC\u822A" : "\u6253\u5F00\u5B66\u4E60\u5BFC\u822A", "aria-pressed": state.enabled, onClick: () => controller.toggleEnabled(), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "tree" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5B66\u4E60" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-text-button", disabled: state.busy, onClick: () => controller.cancelDraft(), children: "\u53D6\u6D88" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-draft-intro", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "fork" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", { children: [
        "\u4ECE\u300C",
        parentTitle,
        "\u300D\u7EE7\u7EED"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6CBF\u7528\u8FD9\u6BB5\u5BF9\u8BDD\u7684\u80CC\u666F\uFF0C\u95EE\u4E00\u4E2A\u65B0\u7684\u95EE\u9898\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "study-draft-composer", onSubmit: submit, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "study-sr-status", htmlFor: "study-draft-question", children: "\u4F60\u7684\u95EE\u9898" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          id: "study-draft-question",
          "data-study-draft-input": true,
          value: draft.question,
          autoFocus: true,
          rows: 3,
          placeholder: "\u5199\u4E0B\u7A81\u7136\u60F3\u5230\u7684\u95EE\u9898\u2026",
          onChange: (event) => controller.setDraftQuestion(event.target.value),
          onKeyDown: (event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey && !state.busy && draft.question.trim()) {
              event.preventDefault();
              controller.run(() => controller.submitDraft());
            }
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-draft-composer-footer", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u672A\u53D1\u9001\u7684\u5BF9\u8BDD\u4E0D\u4F1A\u4FDD\u7559" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", className: "study-button study-button-primary", disabled: state.busy || !draft.question.trim(), children: state.busy ? "\u6B63\u5728\u53D1\u9001\u2026" : "\u53D1\u9001" })
      ] })
    ] })
  ] });
}
function NavigationManagement({ controller, state }) {
  const [open, setOpen] = (0, import_react2.useState)(false);
  const reference = (0, import_react2.useRef)(null);
  const trigger = (0, import_react2.useRef)(null);
  const focusLast = (0, import_react2.useRef)(false);
  (0, import_react2.useEffect)(() => {
    if (!open) return;
    const items = reference.current?.querySelectorAll('[role="menuitem"]:not(:disabled)');
    (focusLast.current ? items?.item(items.length - 1) : items?.item(0))?.focus();
    const outside = (event) => {
      if (event.target instanceof Node && !reference.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const keydown = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (!open) {
      focusLast.current = event.key === "ArrowUp" || event.key === "End";
      setOpen(true);
      return;
    }
    const items = [...reference.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      ref: reference,
      className: "study-management",
      onKeyDown: keydown,
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            ref: trigger,
            type: "button",
            className: "study-icon-button",
            "aria-label": "\u5B66\u4E60\u5BFC\u822A\u7BA1\u7406",
            title: "\u7BA1\u7406",
            "aria-haspopup": "menu",
            "aria-expanded": open,
            disabled: !state.loaded || state.busy,
            onClick: () => {
              focusLast.current = false;
              setOpen(!open);
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "more" })
          }
        ),
        open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "menu", "aria-label": "\u5B66\u4E60\u5BFC\u822A\u7BA1\u7406", className: "study-management-menu", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "menuitem", disabled: state.busy, onClick: () => {
            close();
            controller.setDialog("attach");
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "plus" }),
            "\u5173\u8054\u5DF2\u6709\u4F1A\u8BDD"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "menuitem", disabled: state.busy, onClick: () => {
            close();
            controller.run(() => controller.reload());
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "refresh" }),
            "\u5237\u65B0\u5B66\u4E60\u5BFC\u822A"
          ] })
        ] })
      ]
    }
  );
}
function treeKey(event, node, rows, controller, busy) {
  if (event.target !== event.currentTarget) return;
  if (busy) return;
  const index = rows.findIndex((item) => item.id === node.id);
  let target;
  if (event.key === "ArrowDown") target = rows[Math.min(index + 1, rows.length - 1)];
  else if (event.key === "ArrowUp") target = rows[Math.max(0, index - 1)];
  else if (event.key === "Home") target = rows[0];
  else if (event.key === "End") target = rows.at(-1);
  else if (event.key === "ArrowRight" && node.collapsed) controller.run(() => controller.toggleNode(node.id));
  else if (event.key === "ArrowRight") target = rows.find((item) => item.parentId === node.id);
  else if (event.key === "ArrowLeft" && !node.collapsed && rows.some((item) => item.parentId === node.id)) controller.run(() => controller.toggleNode(node.id));
  else if (event.key === "ArrowLeft") target = rows.find((item) => item.id === node.parentId);
  else if (event.key === "Enter" || event.key === " ") controller.run(() => controller.navigate(node.id));
  else return;
  event.preventDefault();
  if (target) [...event.currentTarget.parentElement.querySelectorAll("[data-study-node-id]")].find((element) => element.dataset.studyNodeId === target.id)?.focus();
}
function LegacySelection({ controller, state }) {
  const rect = state.selection.rect;
  const width = state.selectionExpanded ? 360 : 180;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - (state.selectionExpanded ? 370 : 44) - 8));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-study-ui study-legacy-selection", "data-study-plugin": "selection", style: { left, top }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ForkContent, { controller, state }, selectionKey(state)) });
}
function ForkContent({ controller, state, dismiss, clearSelection }) {
  const [title, setTitle] = (0, import_react2.useState)(() => Array.from(state.selection.source.quote.trim().replace(/\s+/gu, " ")).slice(0, CONFIG.titleLength).join(""));
  const [question, setQuestion] = (0, import_react2.useState)("");
  const close = () => {
    controller.dismissSelection();
    dismiss?.();
  };
  if (!state.selectionExpanded) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-study-ui study-selection-action", "data-study-plugin": "selection", role: "toolbar", "aria-label": "\u5B66\u4E60\u5206\u652F\u64CD\u4F5C", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "study-selection-expand", onMouseDown: (event) => event.preventDefault(), onClick: () => controller.expandSelection(), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "fork" }),
      "\u6DF1\u5165\u4E86\u89E3"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-icon-button", "aria-label": "\u5173\u95ED\u5206\u652F\u64CD\u4F5C", onClick: close, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "close" }) })
  ] });
  const submit = (event) => {
    event.preventDefault();
    if (state.busy || !question.trim()) return;
    controller.run(async () => {
      await controller.fork(question.trim(), title.trim() || void 0);
      clearSelection?.();
      dismiss?.();
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "dsh-study-ui study-fork-form", "data-study-plugin": "selection", "aria-label": "\u521B\u5EFA\u5B66\u4E60\u5206\u652F", onSubmit: submit, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-form-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "fork" }),
        "\u5C55\u5F00\u4E00\u4E2A\u95EE\u9898"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-icon-button", "aria-label": "\u5173\u95ED\u5206\u652F\u64CD\u4F5C", onClick: close, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "close" }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("blockquote", { className: "study-fork-quote", children: state.selection.source.quote }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "study-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5206\u652F\u540D\u79F0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "branchTitle", value: title, maxLength: CONFIG.titleLength, onChange: (event) => setTitle(event.target.value), autoComplete: "off" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "study-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u60F3\u8FDB\u4E00\u6B65\u4E86\u89E3\u4EC0\u4E48\uFF1F" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { name: "question", rows: 3, autoFocus: true, required: true, value: question, onChange: (event) => setQuestion(event.target.value), placeholder: "\u4ECE\u8FD9\u91CC\u7EE7\u7EED\u95EE\u4E00\u4E2A\u95EE\u9898\u2026" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-form-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-button", onClick: close, children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", className: "study-button study-button-primary", disabled: state.busy || !question.trim(), children: state.busy ? "\u6B63\u5728\u521B\u5EFA\u2026" : "\u521B\u5EFA\u5206\u652F" })
    ] })
  ] });
}
function AttachDialog({ controller, state }) {
  const available = state.catalog.filter((item) => !state.tree.nodes.some((node) => node.id === item.id));
  const [sessionId, setSessionId] = (0, import_react2.useState)(() => available.find((item) => item.id === state.currentId)?.id ?? available[0]?.id ?? "");
  const [parentId, setParentId] = (0, import_react2.useState)(() => state.tree.nodes.some((node) => node.id === state.currentId) ? state.currentId : "");
  const ref = (0, import_react2.useRef)(null);
  useDialogFocus(ref, controller);
  const submit = (event) => {
    event.preventDefault();
    if (state.busy || !sessionId) return;
    controller.run(async () => {
      await controller.attachExisting(sessionId, parentId || null);
      controller.setDialog();
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogShell, { controller, reference: ref, title: "\u5173\u8054\u5DF2\u6709\u4F1A\u8BDD", titleId: "study-attach-title", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: submit, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "study-dialog-description", children: "\u4EC5\u52A0\u5165\u5BFC\u822A\uFF0C\u4E0A\u4E0B\u6587\u4FDD\u6301\u539F\u6837\u3002\u5212\u8BCD fork \u624D\u4F1A\u7EE7\u627F\u5206\u53C9\u4F4D\u7F6E\u4E4B\u524D\u7684\u5BF9\u8BDD\u3002" }),
    available.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "study-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5DF2\u6709\u4F1A\u8BDD" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { value: sessionId, onChange: (event) => setSessionId(event.target.value), children: available.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: item.id, children: item.title }, item.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "study-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u653E\u5728\u5BFC\u822A\u7684\u54EA\u4E2A\u4F4D\u7F6E\uFF1F" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: parentId, onChange: (event) => setParentId(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u4F5C\u4E3A\u65B0\u5B66\u4E60\u4E3B\u9898\u7684\u8D77\u70B9" }),
          state.tree.nodes.map((node) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: node.id, children: node.title }, node.id))
        ] })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "study-empty-copy", children: "\u76EE\u524D\u7684\u4F1A\u8BDD\u90FD\u5DF2\u52A0\u5165\u5B66\u4E60\u6811\u3002\u53EF\u4EE5\u5148\u5728 DSH \u4E2D\u6253\u5F00\u53E6\u4E00\u4E2A\u4F1A\u8BDD\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-form-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-button", onClick: () => controller.setDialog(), children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", className: "study-button study-button-primary", disabled: !sessionId || state.busy, children: "\u4EC5\u52A0\u5165\u5BFC\u822A" })
    ] })
  ] }) });
}
function ManageDialog({ controller, state, id }) {
  const node = state.tree.nodes.find((item) => item.id === id);
  const [title, setTitle] = (0, import_react2.useState)(node?.title ?? "");
  const [parentId, setParentId] = (0, import_react2.useState)(node?.parentId ?? "");
  const ref = (0, import_react2.useRef)(null);
  useDialogFocus(ref, controller);
  const excluded = descendants(state.tree, id);
  const submit = (event) => {
    event.preventDefault();
    if (state.busy || !title.trim()) return;
    controller.run(async () => {
      await controller.editNode(id, title.trim(), parentId || null);
      controller.setDialog();
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogShell, { controller, reference: ref, title: "\u7BA1\u7406\u4F1A\u8BDD\u8282\u70B9", titleId: "study-manage-title", children: node ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: submit, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "study-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u4F1A\u8BDD\u540D\u79F0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: title, onChange: (event) => setTitle(event.target.value), maxLength: CONFIG.titleLength, autoComplete: "off" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "study-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5BFC\u822A\u4F4D\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: parentId, onChange: (event) => setParentId(event.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u4F5C\u4E3A\u5B66\u4E60\u4E3B\u9898\u7684\u8D77\u70B9" }),
        state.tree.nodes.filter((item) => !excluded.has(item.id)).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: item.id, children: item.title }, item.id))
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "study-dialog-description", children: "\u8C03\u6574\u5BFC\u822A\u4F4D\u7F6E\u65F6\uFF0C\u4F1A\u8BDD\u539F\u6709\u4E0A\u4E0B\u6587\u548C fork \u6765\u6E90\u4FDD\u6301\u539F\u6837\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-detach-area", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-text-button study-detach", disabled: state.busy, onClick: () => controller.run(async () => {
        await controller.detach(id);
        controller.setDialog();
      }), children: "\u79FB\u51FA\u5B66\u4E60\u6811" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6B64\u8282\u70B9\u53CA\u5B50\u5206\u652F\u5C06\u79FB\u51FA\u5BFC\u822A\uFF0C\u804A\u5929\u8BB0\u5F55\u4ECD\u4FDD\u7559\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-form-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-button", onClick: () => controller.setDialog(), children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", className: "study-button study-button-primary", disabled: state.busy || !title.trim(), children: "\u4FDD\u5B58" })
    ] })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "study-dialog-description", children: "\u8FD9\u4E2A\u4F1A\u8BDD\u5DF2\u4E0D\u5728\u5B66\u4E60\u6811\u4E2D\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-button", onClick: () => controller.setDialog(), children: "\u5173\u95ED" })
  ] }) });
}
function DialogShell({ controller, reference, title, titleId, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-study-ui study-modal-scrim", "data-study-plugin": "dialog", onMouseDown: (event) => {
    if (event.target === event.currentTarget) controller.setDialog();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: reference, className: "study-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "study-dialog-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { id: titleId, children: title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "study-icon-button", "aria-label": "\u5173\u95ED\u5BF9\u8BDD\u6846", onClick: () => controller.setDialog(), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "close" }) })
    ] }),
    children
  ] }) });
}
function useDialogFocus(reference, controller) {
  (0, import_react2.useEffect)(() => {
    const previous = document.activeElement;
    const focusable = () => [...reference.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []];
    const frame = window.requestAnimationFrame(() => (reference.current?.querySelector("input, select, textarea") ?? focusable()[0])?.focus());
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        controller.setDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, [controller, reference]);
}
function descendants(tree, id) {
  const children = /* @__PURE__ */ new Map();
  for (const node of tree.nodes) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  const excluded = /* @__PURE__ */ new Set();
  const pending = [id];
  while (pending.length > 0) {
    const current = pending.pop();
    if (excluded.has(current)) continue;
    excluded.add(current);
    pending.push(...children.get(current) ?? []);
  }
  return excluded;
}
function selectionKey(state) {
  const source = state.selection?.source;
  return JSON.stringify([source?.sessionId, source?.seq, source?.quote]);
}
function Icon({ name }) {
  const paths = {
    tree: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5 4v12a3 3 0 0 0 3 3h7M5 10h10" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "5", cy: "3", r: "1.5" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "17", cy: "10", r: "1.5" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "17", cy: "19", r: "1.5" })
    ] }),
    close: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m6 6 12 12M18 6 6 18" }),
    collapse: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9 4H5v16h4M17 7l-5 5 5 5" }) }),
    chevron: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m9 6 6 6-6 6" }),
    plus: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 5v14M5 12h14" }),
    grip: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01", strokeWidth: "3" }) }),
    refresh: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M19 10a7 7 0 1 0 0 5M19 5v5h-5" }) }),
    more: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "5", cy: "12", r: "1" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "1" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "19", cy: "12", r: "1" })
    ] }),
    return: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m9 5-5 5 5 5M4 10h10a5 5 0 0 1 0 10" }) }),
    history: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5 4h13v16H5zM8 8h7M8 12h7M8 16h4" }) }),
    fork: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6 20V7M6 13h6a6 6 0 0 0 6-6V4M3 7l3-3 3 3M15 7l3-3 3 3" }) })
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { className: "study-icon", width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.65", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: paths[name] });
}

// src/styles.ts
var STYLES = `
[data-study-inherited="true"] { display: none !important; }
html.dsh-study-tree-selection [data-text-interaction-surface] { visibility: hidden !important; pointer-events: none !important; }
.dsh-study-ui {
  --study-paper: var(--dsw-alias-bg-base, #ffffff);
  --study-panel: var(--dsw-specific-sidebar-fill, #f6f8fb);
  --study-ink: var(--dsw-alias-label-primary, #17202b);
  --study-muted: var(--dsw-alias-label-secondary, #6c7788);
  --study-line: var(--dsw-alias-border-l3, #dde3eb);
  --study-accent: var(--dsw-alias-state-business-primary, #2358cc);
  --study-tint: #e8eefb;
  --study-hover: var(--dsw-alias-interactive-bg-hover, #edf0f5);
  --study-danger: #b34242;
  box-sizing: border-box; color: var(--study-ink); font: inherit;
  font-size: 13px; line-height: 1.5; text-align: left; pointer-events: auto;
}
[data-ds-dark-theme] .dsh-study-ui { --study-tint: #23344f; --study-danger: #ed9696; }
.dsh-study-ui *, .dsh-study-ui *::before, .dsh-study-ui *::after { box-sizing: border-box; }
.dsh-study-ui button, .dsh-study-ui input, .dsh-study-ui textarea, .dsh-study-ui select { font: inherit; }
.dsh-study-ui button { color: inherit; cursor: pointer; }
.dsh-study-ui button:disabled { opacity: .45; cursor: default; }
.dsh-study-ui button:focus-visible, .dsh-study-ui input:focus-visible, .dsh-study-ui select:focus-visible,
.dsh-study-ui textarea:focus-visible, .study-tree-row:focus-visible { outline: 2px solid var(--study-accent); outline-offset: 2px; }
.study-icon { display: block; flex: 0 0 auto; }
.study-icon-button { width: 28px; height: 28px; padding: 5px; border: 0; background: transparent; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; }
.study-icon-button:hover:not(:disabled) { background: var(--study-hover); }
.study-navigation { position: fixed; z-index: 100; inset: 0 auto 0 0; width: ${CONFIG.treeWidth}px; height: 100dvh; background: var(--study-panel); border-right: 1px solid var(--study-line); display: flex; flex-direction: column; min-height: 0; transform: translateX(-100%); visibility: hidden; pointer-events: none; transition: transform ${CONFIG.drawerMotionDurationMs}ms ${CONFIG.drawerMotionEasing}, visibility 0s linear ${CONFIG.drawerMotionDurationMs}ms; }
.study-navigation[data-study-open="true"] { transform: translateX(0); visibility: visible; pointer-events: auto; transition-delay: 0s; }
.study-navigation-header { min-height: 64px; padding: 18px 12px 15px 19px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.study-navigation-title { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; letter-spacing: .01em; }
.study-navigation-title > svg { color: var(--study-accent); width: 20px; height: 20px; }
.study-navigation-header > button { color: var(--study-muted); }
.study-new-branch { display: flex; align-items: center; gap: 7px; margin: 0 15px 12px; padding: 8px 10px; min-height: 35px; border: 1px solid var(--study-line); border-radius: 7px; background: var(--study-paper); text-align: left; flex: 0 0 auto; }
.study-new-branch:hover:not(:disabled) { border-color: var(--study-accent); color: var(--study-accent); }
.study-new-branch svg { width: 16px; height: 16px; color: var(--study-accent); }
.study-new-branch small { margin-left: auto; font-size: 10px; color: var(--study-muted); }
.study-tree-heading { min-height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px 0 20px; color: var(--study-muted); font-size: 11px; }
.study-management { position: relative; flex: 0 0 auto; }
.study-management > button .study-icon { width: 15px; height: 15px; }
.study-management-menu { position: absolute; z-index: 1; right: 0; top: calc(100% + 3px); min-width: 174px; padding: 5px; border: 1px solid var(--study-line); border-radius: 8px; background: var(--study-paper); box-shadow: 0 6px 24px #1824361c; }
.study-management-menu > button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 9px; border: 0; border-radius: 4px; background: none; text-align: left; white-space: nowrap; font-size: 12px !important; }
.study-management-menu > button:hover, .study-management-menu > button:focus-visible { background: var(--study-hover); }
.study-management-menu .study-icon { width: 15px; height: 15px; color: var(--study-muted); }
.study-tree-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 9px 20px; scrollbar-width: thin; }
.study-recovery { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; margin: 3px 3px 14px; padding: 11px; border: 1px solid var(--study-line); border-radius: 7px; background: var(--study-paper); }
.study-recovery p { margin: 0; font-size: 12px; font-weight: 550; }
.study-recovery > span { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--study-muted); font-size: 11px; }
.study-recovery > button { margin-top: 3px; }
.study-tree-list { display: flex; flex-direction: column; gap: 3px; }
.study-tree-entry { display: contents; }
.study-draft-row { font-style: italic; }
.study-draft-row .study-tree-leaf svg { width: 12px; height: 12px; }
.study-draft-page { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--study-paper); }
.study-legacy-draft { position: fixed; z-index: 90; top: 0; right: 0; bottom: 0; left: ${CONFIG.treeWidth}px; pointer-events: auto; }
.study-draft-header { min-height: 64px; padding: 16px 28px; display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--study-line); }
.study-draft-header-actions { display: flex; align-items: center; gap: 16px; }
.study-draft-header strong { font-size: 14px; font-weight: 550; }
.study-draft-intro { flex: 1; min-height: 0; overflow: auto; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 40px 28px; text-align: center; }
.study-draft-intro > svg { width: 28px; height: 28px; color: var(--study-accent); margin-bottom: 18px; }
.study-draft-intro h1 { font-size: 20px; line-height: 1.6; font-weight: 550; max-width: 36em; margin: 0 0 10px; overflow-wrap: anywhere; }
.study-draft-intro p { margin: 0; color: var(--study-muted); }
.study-draft-composer { width: min(880px, calc(100% - 48px)); margin: 0 auto 32px; border: 1px solid var(--study-line); border-radius: 15px; background: var(--study-paper); box-shadow: 0 2px 14px #17202b08; }
.study-draft-composer:focus-within { border-color: color-mix(in srgb, var(--study-accent) 45%, var(--study-line)); }
.study-draft-composer textarea { width: 100%; display: block; border: 0; outline: 0 !important; background: transparent; color: var(--study-ink); padding: 16px 17px 10px; min-height: 85px; max-height: 240px; resize: vertical; line-height: 1.7; }
.study-draft-composer textarea::placeholder { color: var(--study-muted); }
.study-draft-composer-footer { padding: 0 11px 11px 17px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.study-draft-composer-footer > span { font-size: 11px; color: var(--study-muted); }
.study-tree-row { display: flex; position: relative; align-items: center; min-height: 35px; padding: 3px 5px 3px 6px; border-radius: 6px; cursor: pointer; outline-offset: -2px; }
.study-tree-row:hover { background: var(--study-hover); }
.study-tree-row.is-active { background: var(--study-tint); color: var(--study-accent); }
.study-tree-row.is-topic { margin-top: 12px; font-weight: 550; }
.study-tree-row.is-topic:first-child { margin-top: 0; }
.study-tree-entry:not(:first-child) > .study-tree-row.is-topic { margin-top: 12px; }
.study-tree-row[data-study-node-id] { user-select: none; -webkit-user-select: none; }
.study-drag-handle { display: flex; align-items: center; justify-content: center; width: 18px; height: 29px; flex: 0 0 18px; margin-left: -3px; color: var(--study-muted); opacity: .28; cursor: grab; user-select: none; touch-action: none; }
.study-drag-handle > svg { width: 12px; height: 17px; }
.study-tree-row:hover .study-drag-handle, .study-tree-row:focus-within .study-drag-handle { opacity: .75; }
.study-navigation[data-study-sorting="true"], .study-navigation[data-study-sorting="true"] * { cursor: grabbing; }
.study-tree-row[data-study-dragging="true"] { opacity: .45; }
.study-tree-row[data-study-drop="before"]::after, .study-tree-row[data-study-drop="after"]::after { content: ''; position: absolute; left: calc(23px + var(--study-drop-depth, 0) * 17px); right: 4px; height: 2px; border-radius: 2px; background: var(--study-accent); pointer-events: none; }
.study-tree-row[data-study-drop="before"]::after { top: -2px; }
.study-tree-row[data-study-drop="after"]::after { bottom: -2px; }
.study-drag-preview { position: fixed; z-index: 3; top: 0; left: 0; display: flex; align-items: center; gap: 7px; max-width: 250px; padding: 7px 11px; border: 1px solid var(--study-line); border-radius: 7px; background: var(--study-paper); box-shadow: 0 5px 18px #17202b25; color: var(--study-ink); pointer-events: none; font-size: 12px; }
.study-drag-preview > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.study-drag-preview > svg { width: 12px; height: 17px; color: var(--study-muted); }
.study-drag-status { flex: 0 0 35px; height: 35px; padding: 8px 19px; font-size: 11px; color: var(--study-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.study-sr-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.study-node-kind { flex: 0 0 auto; padding: 1px 4px; margin-left: 5px; border: 1px solid var(--study-line); border-radius: 4px; color: var(--study-muted); font-size: 10px; font-weight: 400; line-height: 1.4; }
.study-tree-indent { height: 35px; flex: 0 0 auto; display: inline-flex; align-self: stretch; margin: -3px 0; }
.study-tree-indent > i { width: 17px; height: 100%; position: relative; display: block; }
.study-tree-indent > i::before { content: ''; position: absolute; left: 9px; top: 0; bottom: 0; border-left: 1px solid var(--study-line); }
.study-tree-row.is-active .study-tree-indent > i::before { border-color: color-mix(in srgb, var(--study-accent) 22%, transparent); }
.study-tree-chevron, .study-tree-leaf { flex: 0 0 21px; width: 21px; height: 25px; display: inline-flex; align-items: center; justify-content: center; padding: 0; background: none; border: 0; color: var(--study-muted); }
.study-tree-chevron svg { width: 13px; height: 13px; }
.study-tree-chevron.is-open svg { transform: rotate(90deg); }
.study-tree-leaf i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .65; }
.study-tree-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 3px; }
.study-tree-row.is-active .study-tree-label { font-weight: 550; }
.study-node-menu { opacity: 0; flex: 0 0 auto; width: 25px; height: 25px; padding: 5px; margin-left: 3px; color: var(--study-muted); }
.study-node-menu > svg { width: 16px; height: 16px; }
.study-tree-row:hover .study-node-menu, .study-tree-row:focus-within .study-node-menu { opacity: 1; }
.study-running { width: 6px; height: 6px; margin-left: 5px; border-radius: 50%; background: var(--study-accent); flex: 0 0 auto; }
.study-add-current { display: flex; align-items: center; gap: 7px; margin: 16px 5px 0; padding: 7px 1px; text-align: left; border: 0; background: none; color: var(--study-muted) !important; font-size: 11px !important; }
.study-add-current svg { width: 14px; height: 14px; }
.study-add-current:hover { color: var(--study-accent) !important; }
.study-navigation-footer { flex: 0 0 auto; padding: 18px 19px 20px; border-top: 1px solid var(--study-line); }
.study-source-caption { font-size: 11px; color: var(--study-muted); margin-bottom: 8px; }
.study-origin-title { margin: 0 0 12px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.study-source-quote { margin: 0 0 13px; padding: 0 0 0 9px; border-left: 2px solid var(--study-line); font-size: 12px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.study-source-return { display: flex; align-items: center; gap: 7px; padding: 0; border: 0; background: none; color: var(--study-accent) !important; font-size: 12px !important; }
.study-source-return svg { width: 15px; height: 15px; }
.study-history-toggle { display: flex; align-items: center; gap: 7px; width: 100%; margin-top: 18px; padding: 10px 0 0; border: 0; border-top: 1px solid var(--study-line); background: none; color: var(--study-muted) !important; font-size: 11px !important; text-align: left; }
.study-history-toggle > svg { width: 14px; height: 14px; }
.study-history-toggle > svg:last-child { margin-left: auto; width: 12px; height: 12px; }
.study-history-toggle.is-active > svg:last-child { transform: rotate(90deg); }
.study-navigation-hint { margin: 0; color: var(--study-muted); font-size: 12px; line-height: 1.85; }
.study-empty { padding: 27px 11px; }
.study-empty-title { margin: 0 0 8px; font-size: 14px; font-weight: 550; }
.study-empty-copy { color: var(--study-muted); margin: 0 0 18px; font-size: 12px; line-height: 1.8; }
.study-empty .study-button { width: 100%; }
.study-empty .study-text-button { width: 100%; margin-top: 10px; text-align: center; }
.study-tree-scrim { display: none; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity ${CONFIG.drawerMotionDurationMs}ms ${CONFIG.drawerMotionEasing}, visibility 0s linear ${CONFIG.drawerMotionDurationMs}ms; }
.study-tree-scrim[data-study-open="true"] { opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s; }
.study-header-toggle { display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; min-height: 29px; border: 1px solid transparent; background: transparent; border-radius: 6px; font-size: 12px; }
.study-header-toggle > svg { width: 15px; height: 15px; }
.study-header-toggle:hover { background: var(--study-hover); }
.study-header-toggle.is-active { color: var(--study-accent); background: var(--study-tint); }
.study-lineage { display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
.study-lineage-part { min-width: 0; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 1; }
.study-lineage-part > svg { width: 11px; height: 11px; color: var(--study-muted); }
.study-lineage-part > button, .study-lineage-current { display: block; min-width: 0; max-width: 155px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.study-lineage-part > button { padding: 3px 1px; border: 0; background: none; color: var(--study-muted); font-size: 13px; }
.study-lineage-part > button:hover { color: var(--study-accent); }
.study-lineage-current { color: var(--study-ink); font-weight: 550; }
.study-legacy-selection { position: fixed; z-index: 160; max-width: calc(100vw - 16px); }
.study-selection-action { display: flex; align-items: center; gap: 4px; width: max-content; max-width: 100%; padding: 5px; background: var(--study-paper); border: 1px solid var(--study-line); border-radius: 9px; box-shadow: 0 4px 18px #18243616; }
.study-selection-expand { display: inline-flex; align-items: center; gap: 7px; padding: 5px 8px; border: 0; border-radius: 5px; background: none; color: var(--study-accent) !important; font-weight: 550 !important; white-space: nowrap; }
.study-selection-expand:hover { background: var(--study-tint); }
.study-selection-expand > svg { width: 16px; height: 16px; }
.study-fork-form { width: 360px; max-width: calc(100vw - 24px); padding: 15px; background: var(--study-paper); border: 1px solid var(--study-line); border-radius: 10px; box-shadow: 0 9px 30px #18243620; }
.study-form-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 600; margin: -3px -4px 9px 0; }
.study-form-heading > span { display: inline-flex; align-items: center; gap: 7px; }
.study-form-heading > span > svg { width: 16px; height: 16px; color: var(--study-accent); }
.study-fork-quote { margin: 0 0 14px; padding-left: 9px; border-left: 2px solid var(--study-line); color: var(--study-muted); font-size: 12px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.study-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 13px; }
.study-field > span { color: var(--study-muted); font-size: 12px; }
.study-field input, .study-field textarea, .study-field select { display: block; width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--study-line); border-radius: 6px; background: var(--study-paper); color: var(--study-ink); font-size: 13px; line-height: 1.55; }
.study-field textarea { resize: vertical; min-height: 86px; max-height: 210px; }
.study-field textarea::placeholder { color: var(--study-muted); opacity: .75; }
.study-form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 17px; }
.study-button { min-height: 32px; padding: 6px 12px; border: 1px solid var(--study-line); border-radius: 6px; background: var(--study-paper); font-size: 12px !important; font-weight: 500 !important; }
.study-button:hover:not(:disabled) { background: var(--study-hover); }
.study-button-primary { background: var(--study-accent); border-color: var(--study-accent); color: white !important; }
.study-button-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--study-accent) 90%, black); }
.study-text-button { padding: 6px 0; border: 0; background: none; color: var(--study-muted) !important; font-size: 12px !important; text-align: left; }
.study-text-button:hover:not(:disabled) { color: var(--study-accent) !important; }
.study-modal-scrim { position: fixed; z-index: 200; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: #101a2b38; }
.study-dialog { width: 400px; max-width: 100%; max-height: calc(100dvh - 48px); overflow: auto; padding: 22px; border: 1px solid var(--study-line); border-radius: 12px; background: var(--study-paper); box-shadow: 0 18px 70px #111a2930; }
.study-dialog-heading { display: flex; align-items: center; justify-content: space-between; margin: -3px -4px 19px 0; gap: 12px; }
.study-dialog-heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
.study-dialog-description { margin: -4px 0 18px; color: var(--study-muted); font-size: 12px; line-height: 1.8; }
.study-detach-area { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--study-line); }
.study-detach { color: var(--study-danger) !important; padding: 0; }
.study-detach-area p { margin: 7px 0 0; color: var(--study-muted); font-size: 11px; line-height: 1.7; }
.study-error { position: fixed; z-index: 220; bottom: 22px; left: 50%; transform: translateX(-50%); display: flex; align-items: flex-start; gap: 14px; width: max-content; max-width: min(560px, calc(100vw - 32px)); padding: 12px 12px 12px 16px; border: 1px solid var(--study-line); border-radius: 9px; background: var(--study-paper); box-shadow: 0 6px 22px #18243622; font-size: 12px; }
.study-error > span { padding-top: 4px; overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: ${CONFIG.narrowWidth - 1}px) {
  .study-legacy-draft { left: 0; }
  .study-navigation { width: min(${CONFIG.treeWidth}px, 86vw); }
  .study-tree-scrim { display: block; position: fixed; z-index: 99; inset: 0; width: 100vw; height: 100dvh; border: 0; background: #101a2b38; }
  .study-node-menu { opacity: 1; }
  .study-lineage-part > button, .study-lineage-current { max-width: 95px; }
  .study-fork-form { width: min(360px, calc(100vw - 24px)); }
}
@media (prefers-reduced-motion: reduce) {
  .study-navigation, .study-tree-scrim { transition: none; }
}
@media (pointer: coarse) {
  .study-drag-handle { opacity: .65; }
}
`;
function installStyles() {
  const style = document.createElement("style");
  style.dataset.studyTreeStyles = "";
  style.textContent = STYLES;
  document.head.appendChild(style);
  return () => style.remove();
}

// src/client.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var inject = ["slots", "sessions", "connection", "layout"];
function TurnBoundaryMarker({ seq, sessionId, turn }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "data-study-turn-end": turn?.end?.seq ?? seq, "data-study-source-seq": seq, "data-study-session-id": sessionId, "aria-hidden": "true" });
}
function LegacyTurnMarker({ sessionId, messageId, useSession }) {
  const assistantSeq = useSession((snapshot) => snapshot.nodes?.find((node) => node.kind === "assistant" && node.messageId === messageId)?.seq);
  const endSeq = useSession((snapshot) => {
    const node = snapshot.nodes?.find((item) => item.kind === "assistant" && item.messageId === messageId);
    return node ? snapshot.turnEnds?.get(node.turn) : void 0;
  });
  return endSeq === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "data-study-turn-end": endSeq, "data-study-source-seq": assistantSeq, "data-study-session-id": sessionId, "aria-hidden": "true" });
}
function apply(ctx) {
  const controller = new StudyController(ctx);
  ctx.effect(() => installStyles(), "study-tree: theme");
  ctx.effect(() => controller.start(), "study-tree: state and navigation");
  const register = (name, component, options = {}) => {
    ctx.slots.inject(name, () => ctx.slots.register({
      name,
      id: `study-tree:${name}`,
      order: 80,
      inject: () => ({ controller }),
      ...options
    }, component));
  };
  register("shell.overlay", StudyOverlay);
  if (controller.adapter.draftPresentation() === "panel") register("main", StudyDraftPage, { key: CONFIG.draftPanel });
  register("conversation.session.header.actions", StudyHeaderAction);
  ctx.slots.inject("conversation.chat.turnTail", () => {
    if (ctx.slots.spec?.("conversation.chat.turnTail")?.kind === "chain") {
      register("conversation.chat.assistant-actions", LegacyTurnMarker);
      return;
    }
    return ctx.slots.register({ name: "conversation.chat.turnTail", id: "study-tree:turn-boundary", order: 80 }, TurnBoundaryMarker);
  });
  let nativeActive = false;
  ctx.inject(["uiConversation"], (scope) => {
    const interactions = scope.get("uiConversation")?.interactions;
    if (typeof interactions?.register !== "function") return;
    scope.slots.inject("conversation.chat.text-interaction", () => scope.slots.register({
      name: "conversation.chat.text-interaction",
      key: "dsh-study-tree",
      inject: () => ({ controller })
    }, NativeForkSurface));
    const unregister = interactions.register({ id: "dsh-study-tree", onInteraction(request) {
      if (!request.hasSelection) return;
      const selection = captureSelection(window.getSelection(), request.sessionId);
      if (!selection) return;
      controller.setSelection(selection, true);
      request.preventDefault();
      request.open();
    } });
    nativeActive = true;
    scope.effect(() => () => {
      nativeActive = false;
      unregister();
    }, "study-tree: official text interaction");
  });
  ctx.effect(() => {
    const onSelection = (event) => {
      if (event.target?.closest?.("[data-study-plugin]")) return;
      const snapshot = controller.getSnapshot();
      if (snapshot.selectionExpanded) return;
      if (nativeActive && snapshot.selection && snapshot.nativeSelection) return;
      const captured = captureSelection(window.getSelection(), snapshot.currentId);
      if (captured) controller.setSelection(captured, false);
      else controller.dismissSelection();
    };
    document.addEventListener("mouseup", onSelection);
    document.addEventListener("keyup", onSelection);
    return () => {
      document.removeEventListener("mouseup", onSelection);
      document.removeEventListener("keyup", onSelection);
    };
  }, "study-tree: legacy text interaction");
  ctx.effect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") controller.dismissSelection();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, "study-tree: keyboard dismissal");
}
return module.exports;}});
//# sourceMappingURL=client.js.map
