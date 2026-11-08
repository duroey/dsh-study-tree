// src/host.ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// src/persistence.ts
import { mkdir, readFile, rename, writeFile, unlink, stat, open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

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

// src/tree.ts
var MAX_TREE_NODES = 2e3;
function emptyTree() {
  return { schemaVersion: 1, nodes: [] };
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

// src/persistence.ts
var TreeConflictError = class extends Error {
  constructor() {
    super("Tree revision conflict: reload the saved tree before editing again.");
  }
};
var AtomicTreeStore = class {
  file;
  pending = Promise.resolve();
  /** Args: file: Absolute destination owned by this plugin. */
  constructor(file) {
    this.file = file;
  }
  /** Returns: The validated last revision, or the empty initial state. */
  async read() {
    try {
      if ((await stat(this.file)).size > CONFIG.maxStateBytes) throw new Error("Saved study tree exceeds the size limit.");
      const value = JSON.parse(await readFile(this.file, "utf8"));
      if (!value || typeof value !== "object") throw new Error("Invalid saved tree envelope.");
      const data = value;
      if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error("Invalid tree revision.");
      return { revision: data.revision, tree: parseTree(data.tree) };
    } catch (error) {
      if (error.code === "ENOENT") return { revision: 0, tree: emptyTree() };
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
  write(tree, expectedRevision) {
    const validated = parseTree(tree);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return Promise.reject(new Error("Invalid expected revision."));
    const operation = this.pending.then(async () => {
      const release = await this.acquireLock();
      try {
        const current = await this.read();
        if (current.revision !== expectedRevision) throw new TreeConflictError();
        const next = { revision: current.revision + 1, tree: validated };
        const encoded = JSON.stringify(next);
        if (Buffer.byteLength(encoded) > CONFIG.maxStateBytes) throw new Error("Study tree exceeds the size limit.");
        await mkdir(dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, encoded, { encoding: "utf8", mode: 384, flag: "wx" });
          await rename(temporary, this.file);
        } finally {
          await unlink(temporary).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
        return next;
      } finally {
        await release();
      }
    });
    this.pending = operation.then(() => void 0, () => void 0);
    return operation;
  }
  /** Returns: A release callback after bounded, exclusive cross-process acquisition. */
  async acquireLock() {
    await mkdir(dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + CONFIG.lockTimeoutMs;
    const token = randomUUID();
    while (true) {
      try {
        const handle = await open(lock, "wx", 384);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
        } catch (error) {
          await handle.close();
          await unlink(lock);
          throw error;
        }
        return async () => {
          await handle.close();
          const owner = JSON.parse(await readFile(lock, "utf8"));
          if (owner.token !== token) throw new Error("Study tree lock ownership changed unexpectedly.");
          await unlink(lock);
        };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        await this.removeDeadLock(lock);
        if (Date.now() >= deadline) throw new Error("Study tree is busy in another host process; retry the edit.");
        await delay(CONFIG.lockRetryMs);
      }
    }
  }
  /** Args: lock: Our lock path. Remove only an old lease whose process is proven absent. */
  async removeDeadLock(lock) {
    try {
      if (Date.now() - (await stat(lock)).mtimeMs < CONFIG.lockStaleMs) return;
      const owner = JSON.parse(await readFile(lock, "utf8"));
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return;
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") await unlink(lock);
      }
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
};

// src/title.ts
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// src/naming.ts
function initialBranchTitle(question) {
  return Array.from(question.trim().replace(/\s+/gu, " ")).slice(0, CONFIG.fallbackTitleLength).join("");
}
function titleFromResponse(response) {
  if (response?.finish?.kind !== "stop" || !Array.isArray(response.blocks) || response.blocks.some((block) => block.type === "tool-call")) throw new Error("\u6807\u9898\u6A21\u578B\u6CA1\u6709\u8FD4\u56DE\u5B8C\u6574\u7684\u7EAF\u6587\u672C\u6807\u9898\u3002");
  const text = response.blocks.filter((block) => block.type === "text").map((block) => block.text).join(" ");
  const line = text.split(/\r?\n/u).map((item) => item.trim()).find(Boolean) ?? "";
  const title = line.replace(/^\*{1,3}(.+?)\*{1,3}$/u, "$1").replace(/^["“](.*)["”]$/u, "$1").trim();
  if (!title) throw new Error("\u6807\u9898\u6A21\u578B\u8FD4\u56DE\u4E86\u7A7A\u6807\u9898\u3002");
  return title;
}

// src/title.ts
async function loadTitleHelper() {
  const anchor = process.argv[1] ? await realpath(process.argv[1]) : import.meta.url;
  const hostRequire = createRequire(createRequire(anchor).resolve("@deepseek-ai/dsh/package.json"));
  return import(pathToFileURL(hostRequire.resolve("@deepseek-ai/dsh-session-title-llm")).href);
}
var BranchTitles = class {
  inFlight = /* @__PURE__ */ new Map();
  ctx;
  store;
  load;
  /** Args: ctx: Host services. store: Owned learning index. load: Version-specific official helper loader. */
  constructor(ctx, store, load = loadTitleHelper) {
    this.ctx = ctx;
    this.store = store;
    this.load = load;
  }
  /** Args: id: Indexed fork. signal: Caller cancellation. Returns: One shared generation result. */
  generate(id, signal) {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const task = this.generateOnce(id, signal).finally(() => {
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, task);
    return task;
  }
  /** Args: id: Indexed fork. signal: Cancellation. Returns: The accepted native title or a supersession receipt. */
  async generateOnce(id, signal) {
    if (typeof id !== "string" || !id.trim()) throw new Error("\u7F3A\u5C11\u5B66\u4E60\u5206\u652F\u6807\u8BC6\u3002");
    const node = (await this.store.read()).tree.nodes.find((item) => item.id === id);
    if (!node?.origin || node.origin.seq === void 0) throw new Error("\u8FD9\u4E2A\u5206\u652F\u6CA1\u6709\u53EF\u6838\u5BF9\u7684\u539F\u751F\u7EE7\u627F\u8FB9\u754C\u3002");
    const sessions = this.ctx.get("sessions");
    const titles = this.ctx.get("sessionTitle");
    const query = this.ctx.get("sessionQuery");
    const session = sessions?.get?.(id);
    if (!sessions?.get || !titles?.get || !titles?.rename || !query?.readSession) throw new Error("\u5F53\u524D DSH \u672A\u63D0\u4F9B\u6240\u9700\u7684\u6807\u9898\u670D\u52A1\u3002");
    if (!session) return { ready: true, superseded: true };
    const log = await query.readSession(id);
    const own = (seq) => typeof session.isOwnSeq === "function" ? session.isOwnSeq(seq) : seq > node.origin.seq;
    const event = log.events.find((item) => own(item.seq) && item.type === "user/message" && item.data?.source?.kind === "user" && item.data.content?.some((block) => block.type === "text" && block.text.trim()));
    if (!event) return { ready: false };
    const fullText = event.data.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    const before = titles.get(session);
    if (before && own(before.eventSeq) && before.title !== "\u65B0\u60F3\u6CD5" && before.title !== initialBranchTitle(fullText)) {
      return { ready: true, title: before.title, superseded: true };
    }
    const first = { seq: event.seq, text: Array.from(fullText).slice(0, CONFIG.titleInputCharacters).join("") };
    const helper = await this.load();
    const policy = { maxInputBytes: CONFIG.titleInputBytes, maxOutputTokens: CONFIG.titleOutputTokens, timeoutMs: CONFIG.titleTimeoutMs };
    const request = {
      session,
      messages: [first],
      route: session.requestHeader?.()?.config,
      currentTitle: before,
      signal: signal ?? AbortSignal.timeout(CONFIG.titleTimeoutMs)
    };
    let title;
    if (typeof helper.executeSessionTitleLlm === "function") {
      const response = await helper.executeSessionTitleLlm(this.ctx, helper.resolveSessionTitleLlmConfig(policy), request, "dsh-study-tree", {
        system: `\u4E3A\u5B66\u4E60\u5BF9\u8BDD\u4E2D\u7684\u8FD9\u4E2A\u65B0\u95EE\u9898\u62DF\u4E00\u4E2A\u7B80\u6D01\u6807\u9898\u3002\u4F7F\u7528\u95EE\u9898\u7684\u8BED\u8A00\uFF0C\u4E2D\u6587\u7EA6 ${CONFIG.titleCjkCharacters} \u5B57\uFF0C\u5176\u4ED6\u8BED\u8A00\u7EA6 ${CONFIG.titleWords} \u4E2A\u8BCD\u3002\u53EA\u8F93\u51FA\u4E00\u884C\u81EA\u7136\u8BED\u8A00\u6807\u9898\uFF0C\u4E0D\u52A0\u5F15\u53F7\u3001\u89E3\u91CA\u6216 Markdown\u3002`,
        input: JSON.stringify([first]),
        messageSeqs: [first.seq],
        selectReasoningEffort: (model) => model.reasoning?.efforts[0]?.id
      });
      title = titleFromResponse(response);
    } else if (typeof helper.generateSessionTitleWithLlm === "function") {
      const policyLegacy = { ...policy, targetWords: CONFIG.titleWords, targetCjkCharacters: CONFIG.titleCjkCharacters };
      const response = await helper.generateSessionTitleWithLlm(this.ctx, helper.resolveSessionTitleLlmConfig(policyLegacy), request, [first], "dsh-study-tree");
      title = response.title;
    } else throw new Error("\u5F53\u524D DSH \u7684\u8F85\u52A9\u6807\u9898\u63A5\u53E3\u5C1A\u672A\u9002\u914D\u3002");
    if (request.signal.aborted) throw new Error("\u81EA\u52A8\u8D77\u6807\u9898\u5DF2\u53D6\u6D88\u3002");
    const current = titles.get(session);
    if (sessions.get(id) !== session || current?.eventSeq !== before?.eventSeq) return { ready: true, title: current?.title, superseded: true };
    const accepted = titles.rename(session, title);
    await sessions.flush(session);
    return { ready: true, title: accepted.title };
  }
};

// src/host.ts
var name = "dsh-study-tree";
var inject = ["connection", "webServer", "sessions", "sessionTitle", "sessionQuery", "llm"];
function apply(ctx) {
  const configured = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  const home = configured === "~" ? homedir() : configured.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured;
  const store = new AtomicTreeStore(join(resolve(home), CONFIG.stateDirectory, CONFIG.treeFile));
  const connection = ctx.get("connection");
  const titles = new BranchTitles(ctx, store);
  const handler = async (endpoint, payload, signal, peer) => {
    if (peer && peer.principal?.kind !== "owner") return { ok: false, error: { code: "forbidden", message: "Study trees belong to the host owner.", details: {} } };
    if (signal?.aborted) return { ok: false, error: { code: "cancelled", message: "Request cancelled.", details: {} } };
    try {
      if (endpoint === "read") return { ok: true, value: await store.read() };
      if (endpoint === "title") return { ok: true, value: await titles.generate(payload?.id, signal) };
      if (endpoint === "write") {
        if (!payload || typeof payload !== "object") throw new Error("Missing tree update.");
        return { ok: true, value: await store.write(payload.tree, payload.revision) };
      }
      return { ok: false, error: { code: "not-found", message: "Unknown study-tree operation.", details: {} } };
    } catch (error) {
      return { ok: false, error: { code: error instanceof TreeConflictError ? "conflict" : "study-tree-error", message: error instanceof Error ? error.message : String(error), details: {} } };
    }
  };
  if (typeof connection.fetch?.register === "function") {
    for (const endpoint of ["read", "write", "title"]) {
      connection.fetch.register({
        path: `/api/study-tree/${endpoint}`,
        methods: ["POST"],
        requestBody: "buffered",
        async fetch(request) {
          let payload;
          try {
            payload = await request.json();
          } catch {
            return Response.json({ ok: false, error: { code: "invalid-json", message: "Expected a JSON request.", details: {} } }, { status: 400 });
          }
          return Response.json(await handler(endpoint, payload, request.signal));
        }
      });
    }
  } else {
    connection.rpc.handle(CONFIG.rpcNamespace, handler, { authority: "trusted-host" });
  }
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
