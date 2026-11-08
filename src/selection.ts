/**
 * Text-quote anchoring is adapted from dsh-inline-study by its contributors.
 * Original: https://github.com/Chen-chy/dsh-inline-study (MIT).
 * The original copyright and permission notice are retained in THIRD_PARTY_NOTICES.
 * Conversation rendering, text contents, and recorded session events stay owned by DSH.
 */
import type { StudySource } from './tree.ts';

/** DOM seams are centralized so host markup changes need one compatibility edit. */
const DOM_CONFIG = {
  flow: '[data-chat-flow-kind]',
  assistant: '[data-chat-flow-kind="assistant-step"]',
  tail: '[data-chat-flow-kind="turn-tail"]',
  turnEnd: '[data-study-turn-end]',
  excludedText: '.katex-mathml, annotation, script, style, button, input, textarea, [hidden]',
  plugin: '[data-study-plugin]',
  inputKinds: new Set(['user', 'user-message', 'input', 'input-message', 'steering-message']),
  contextCharacters: 64,
  maximumQuoteCharacters: 8_000,
  maximumFlowCharacters: 250_000,
  highlightMilliseconds: 1_800,
  highlightName: 'dsh-study-tree-source',
  highlightColor: 'rgba(68, 112, 210, 0.24)',
  landingRatio: 0.35,
} as const;

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu;

/** A real completed-turn source plus viewport coordinates for the fork action. */
export interface CapturedStudySelection {
  source: StudySource;
  rect: { left: number; top: number; bottom: number; width: number; height: number };
}

/** One exact UTF-16 match in a visible text projection. */
export interface QuoteRange {
  start: number;
  end: number;
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface TextIndex {
  text: string;
  segments: TextSegment[];
}

interface CompletedTurn {
  seq: number;
  tail: HTMLElement;
}

let clearSourceHighlight: (() => void) | undefined;

/**
 * Finds an exact quote only when its saved context identifies one occurrence.
 *
 * Args:
 *   text: Visible text in one completed assistant message.
 *   quote: Original selected text, in UTF-16 coordinates.
 *   prefix: Exact text immediately before the quote, when recorded.
 *   suffix: Exact text immediately after the quote, when recorded.
 *
 * Returns:
 *   The unique match, or undefined when absent or ambiguous.
 */
export function resolveQuote(text: string, quote: string, prefix = '', suffix = ''): QuoteRange | undefined {
  const matches = quoteMatches(text, quote, prefix, suffix);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Captures a selection from one assistant answer whose complete turn is known.
 *
 * Args:
 *   selection: Browser selection after the user's gesture.
 *   currentSessionId: Real DSH session currently displayed in the main chat.
 *
 * Returns:
 *   A durable source and toolbar placement, or undefined for an unsafe selection.
 */
export function captureSelection(
  selection: Selection | null,
  currentSessionId: string | undefined,
): CapturedStudySelection | undefined {
  if (!currentSessionId || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  const start = elementOf(range.startContainer);
  const end = elementOf(range.endContainer);
  if (!start || !end || start.closest(DOM_CONFIG.plugin) || end.closest(DOM_CONFIG.plugin)
    || start.closest(DOM_CONFIG.excludedText) || end.closest(DOM_CONFIG.excludedText)) return undefined;
  const flow = start.closest<HTMLElement>(DOM_CONFIG.assistant);
  if (!flow || flow !== end.closest(DOM_CONFIG.assistant)) return undefined;
  const boundary = completedTurn(flow, currentSessionId);
  if (!boundary) return undefined;
  const rawQuote = readableRangeText(range);
  const quote = rawQuote.trim();
  if (!quote || quote.length > DOM_CONFIG.maximumQuoteCharacters) return undefined;
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
  if (rect.width === 0 && rect.height === 0) return undefined;
  return {
    source: {
      sessionId: currentSessionId,
      seq: boundary.seq,
      quote,
      prefix,
      suffix,
      scrollTop: scrollingContainer(flow).scrollTop,
    },
    rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
  };
}

/**
 * Returns to an unambiguous saved passage after its DSH session has been opened.
 *
 * Args:
 *   source: Completed-turn source saved when creating the learning branch.
 *
 * Returns:
 *   True when the original passage was found and highlighted; false on missing
 *   history, unavailable DOM, changed text, or ambiguity. No conversation text is edited.
 */
export function restoreSource(source: StudySource): boolean {
  if (typeof document === 'undefined' || source.seq === undefined) return false;
  const tails = [...document.querySelectorAll<HTMLElement>(DOM_CONFIG.turnEnd)]
    .filter((marker) => (markerSequence(marker) === source.seq || Number(marker.dataset.studySourceSeq) === source.seq)
      && markerSessionMatches(marker, source.sessionId))
    .map((marker) => marker.closest<HTMLElement>(DOM_CONFIG.tail))
    .filter((tail): tail is HTMLElement => tail !== null && visible(tail));
  const matches: Array<{ flow: HTMLElement; index: TextIndex; range: QuoteRange }> = [];
  for (const tail of new Set(tails)) {
    for (const flow of assistantFlowsInTurn(tail)) {
      const index = visibleTextIndex(flow);
      if (!index) continue;
      for (const range of quoteMatches(index.text, source.quote, source.prefix, source.suffix)) {
        matches.push({ flow, index, range });
        if (matches.length > 1) return false;
      }
    }
  }
  if (matches.length !== 1) return false;
  const match = matches[0]!;
  const range = domRange(match.index, match.range);
  if (!range) return false;
  const container = scrollingContainer(match.flow);
  const rect = range.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  container.scrollTop = Math.max(0, container.scrollTop + rect.top - viewport.top - container.clientHeight * DOM_CONFIG.landingRatio);
  flashSource(range);
  return true;
}

/**
 * Reads the normal chat's current scroll position.
 *
 * Returns:
 *   Nonnegative pixels from the active conversation's scroll origin.
 */
export function captureScrollPosition(): number {
  if (typeof document === 'undefined') return 0;
  return Math.max(0, scrollingContainer(currentFlow()).scrollTop);
}

/**
 * Restores a previously recorded chat position without scrolling another panel.
 *
 * Args:
 *   top: Finite nonnegative pixels saved before navigation.
 */
export function restoreScrollPosition(top: number): void {
  if (typeof document === 'undefined' || !Number.isFinite(top) || top < 0) return;
  scrollingContainer(currentFlow()).scrollTop = top;
}

/**
 * Collects at most two context-valid matches, including overlapping occurrences.
 *
 * Args:
 *   text: Visible source projection.
 *   quote: Selected quote.
 *   prefix: Exact saved prefix, if any.
 *   suffix: Exact saved suffix, if any.
 *
 * Returns:
 *   Zero, one, or two matches; two is sufficient to prove ambiguity.
 */
function quoteMatches(text: string, quote: string, prefix = '', suffix = ''): QuoteRange[] {
  if (!quote) return [];
  const matches: QuoteRange[] = [];
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

/**
 * Resolves a text or element node to the element that contains it.
 *
 * Args:
 *   node: One browser selection endpoint.
 *
 * Returns:
 *   The node's element container, when present.
 */
function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

/**
 * Reads selected visible text without KaTeX's duplicate accessibility subtree.
 *
 * Args:
 *   range: A range contained in one assistant answer.
 *
 * Returns:
 *   Exact visible UTF-16 text, preserving spaces and paragraph-local offsets.
 */
function readableRangeText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll(DOM_CONFIG.excludedText).forEach((element) => element.remove());
  return (fragment.textContent ?? '').replace(ZERO_WIDTH, '');
}

/**
 * Finds the first closing marker belonging to the selected assistant's turn.
 *
 * Args:
 *   flow: Selected assistant row.
 *   sessionId: Current main session identity.
 *
 * Returns:
 *   A real completed-turn boundary, or undefined when it is not safely known.
 */
function completedTurn(flow: HTMLElement, sessionId: string): CompletedTurn | undefined {
  const rows = flowRows(flow);
  const start = rows.indexOf(flow);
  if (start < 0) return undefined;
  const turn = flow.dataset.chatTurn;
  for (let index = start + 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    if ((turn && row.dataset.chatTurn && row.dataset.chatTurn !== turn) || DOM_CONFIG.inputKinds.has(row.dataset.chatFlowKind ?? '')) return undefined;
    if (!row.matches(DOM_CONFIG.tail)) continue;
    const marker = row.querySelector<HTMLElement>(DOM_CONFIG.turnEnd);
    if (!marker || !markerSessionMatches(marker, sessionId)) return undefined;
    const seq = markerSequence(marker);
    return seq === undefined ? undefined : { seq, tail: row };
  }
  return undefined;
}

/**
 * Reads all loaded business rows in the containing chat viewport.
 *
 * Args:
 *   flow: Any business row in that chat.
 *
 * Returns:
 *   DOM-order rows without relying on hashed host CSS classes.
 */
function flowRows(flow: HTMLElement): HTMLElement[] {
  const container = scrollingContainer(flow);
  return [...container.querySelectorAll<HTMLElement>(DOM_CONFIG.flow)];
}

/**
 * Collects assistant answers back to the previous turn boundary.
 *
 * Args:
 *   tail: Complete turn's closing row.
 *
 * Returns:
 *   Assistant answer rows from precisely this loaded turn.
 */
function assistantFlowsInTurn(tail: HTMLElement): HTMLElement[] {
  const rows = flowRows(tail);
  const index = rows.indexOf(tail);
  const turn = tail.dataset.chatTurn;
  const flows: HTMLElement[] = [];
  for (let position = index - 1; position >= 0; position -= 1) {
    const row = rows[position]!;
    if (row.matches(DOM_CONFIG.tail) || (turn && row.dataset.chatTurn && row.dataset.chatTurn !== turn)) break;
    if (row.matches(DOM_CONFIG.assistant)) flows.push(row);
    if (DOM_CONFIG.inputKinds.has(row.dataset.chatFlowKind ?? '')) break;
  }
  return flows.reverse();
}

/**
 * Validates the sequence advertised by our own completed-turn marker.
 *
 * Args:
 *   marker: Span mounted through the official turnTail slot.
 *
 * Returns:
 *   A safe nonnegative integer, or undefined for an invalid marker.
 */
function markerSequence(marker: HTMLElement): number | undefined {
  const value = marker.dataset.studyTurnEnd;
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const seq = Number(value);
  return Number.isSafeInteger(seq) ? seq : undefined;
}

/**
 * Excludes a marker explicitly bound to another displayed session.
 *
 * Args:
 *   marker: Completed-turn marker, optionally carrying its session identity.
 *   sessionId: Expected real session.
 *
 * Returns:
 *   Whether the marker is legacy-compatible or belongs to this session.
 */
function markerSessionMatches(marker: HTMLElement, sessionId: string): boolean {
  return marker.dataset.studySessionId === undefined || marker.dataset.studySessionId === sessionId;
}

/**
 * Projects visible text and records each text node's range without cloning chat.
 *
 * Args:
 *   flow: One assistant answer.
 *
 * Returns:
 *   A bounded visible-text index, or undefined when its size exceeds the limit.
 */
function visibleTextIndex(flow: HTMLElement): TextIndex | undefined {
  const segments: TextSegment[] = [];
  let text = '';
  const pending: Node[] = [flow];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(DOM_CONFIG.excludedText)) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      const cleaned = (node as Text).data.replace(ZERO_WIDTH, '');
      if (!cleaned) continue;
      const start = text.length;
      text += cleaned;
      if (text.length > DOM_CONFIG.maximumFlowCharacters) return undefined;
      segments.push({ node: node as Text, start, end: text.length });
      continue;
    }
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) pending.push(node.childNodes[index]!);
  }
  return { text, segments };
}

/**
 * Maps a visible character offset back into its original UTF-16 text node.
 *
 * Args:
 *   segment: Text node and its visible projection interval.
 *   localOffset: Visible character offset inside this segment.
 *
 * Returns:
 *   The raw text-node offset or undefined when out of range.
 */
function rawOffset(segment: TextSegment, localOffset: number): number | undefined {
  let visibleOffset = 0;
  for (let index = 0; index < segment.node.data.length; index += 1) {
    if (/[\u200B-\u200D\u2060\uFEFF]/u.test(segment.node.data[index]!)) continue;
    if (visibleOffset === localOffset) return index;
    visibleOffset += 1;
  }
  return undefined;
}

/**
 * Builds a browser range that may span several formatted text nodes.
 *
 * Args:
 *   index: Current assistant text projection.
 *   match: Unique visible interval.
 *
 * Returns:
 *   A range into the original chat DOM, without wrapping or rewriting its text.
 */
function domRange(index: TextIndex, match: QuoteRange): Range | undefined {
  const start = index.segments.find((segment) => match.start >= segment.start && match.start < segment.end);
  const end = index.segments.find((segment) => match.end - 1 >= segment.start && match.end - 1 < segment.end);
  if (!start || !end) return undefined;
  const startOffset = rawOffset(start, match.start - start.start);
  const endOffset = rawOffset(end, match.end - 1 - end.start);
  if (startOffset === undefined || endOffset === undefined) return undefined;
  const range = document.createRange();
  range.setStart(start.node, startOffset);
  range.setEnd(end.node, endOffset + 1);
  return range;
}

/**
 * Chooses a visible normal-chat row for position capture without class-name coupling.
 *
 * Returns:
 *   The first visible chat business row outside this plugin's surfaces.
 */
function currentFlow(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(DOM_CONFIG.flow)]
    .find((element) => !element.closest(DOM_CONFIG.plugin) && visible(element));
}

/**
 * Locates the existing host scrollport around a chat business row.
 *
 * Args:
 *   flow: A business row, when the chat already contains messages.
 *
 * Returns:
 *   The innermost vertical scroll container, or the document's scroll owner.
 */
function scrollingContainer(flow?: HTMLElement): HTMLElement {
  let element = flow?.parentElement;
  while (element && element !== document.body) {
    if (/(auto|scroll|overlay)/u.test(getComputedStyle(element).overflowY)) return element;
    element = element.parentElement;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

/**
 * Checks whether a business row participates in the current visible layout.
 *
 * Args:
 *   element: Candidate chat row.
 *
 * Returns:
 *   Whether its rendered box is visible to the browser layout engine.
 */
function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

/**
 * Briefly highlights the original range without changing any chat text nodes.
 *
 * Args:
 *   range: Current source range after scroll restoration.
 */
function flashSource(range: Range): void {
  clearSourceHighlight?.();
  const css = globalThis.CSS as typeof CSS & { highlights?: Map<string, unknown> };
  const HighlightConstructor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  const owned: HTMLElement[] = [];
  if (css?.highlights && HighlightConstructor) {
    css.highlights.set(DOM_CONFIG.highlightName, new HighlightConstructor(range));
    const style = document.createElement('style');
    style.textContent = `::highlight(${DOM_CONFIG.highlightName}) { background: ${DOM_CONFIG.highlightColor}; }`;
    document.head.appendChild(style);
    owned.push(style);
  } else {
    for (const rect of range.getClientRects()) {
      const overlay = document.createElement('span');
      overlay.dataset.studyPlugin = 'source-highlight';
      overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
        background: DOM_CONFIG.highlightColor, pointerEvents: 'none', zIndex: '1000',
      });
      document.body.appendChild(overlay);
      owned.push(overlay);
    }
  }
  let timer: number;
  const dispose = (): void => {
    window.clearTimeout(timer);
    css?.highlights?.delete(DOM_CONFIG.highlightName);
    owned.forEach((element) => element.remove());
    if (clearSourceHighlight === dispose) clearSourceHighlight = undefined;
  };
  clearSourceHighlight = dispose;
  timer = window.setTimeout(dispose, DOM_CONFIG.highlightMilliseconds);
}
