import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CONFIG } from './config.ts';
import { initialBranchTitle, titleFromResponse } from './naming.ts';
import type { StudyTree } from './tree.ts';

interface TitleContext { get(name: string): any }
interface TitleStore { read(): Promise<{ tree: StudyTree }> }
type TitleResult = { ready: boolean; title?: string; superseded?: boolean };

/**
 * Loads the active host's official helper without bundling another DSH runtime.
 *
 * Returns:
 *   A helper exporting the current or legacy public title-generation function.
 */
async function loadTitleHelper(): Promise<any> {
  const anchor = process.argv[1] ? await realpath(process.argv[1]) : import.meta.url;
  const hostRequire = createRequire(createRequire(anchor).resolve('@deepseek-ai/dsh/package.json'));
  return import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-session-title-llm')).href);
}

/** Generates one initial native title from a fork's own first human message. */
export class BranchTitles {
  private readonly inFlight = new Map<string, Promise<TitleResult>>();
  private readonly ctx: TitleContext;
  private readonly store: TitleStore;
  private readonly load: () => Promise<any>;

  /** Args: ctx: Host services. store: Owned learning index. load: Version-specific official helper loader. */
  constructor(ctx: TitleContext, store: TitleStore, load: () => Promise<any> = loadTitleHelper) {
    this.ctx = ctx; this.store = store; this.load = load;
  }

  /** Args: id: Indexed fork. signal: Caller cancellation. Returns: One shared generation result. */
  generate(id: string, signal?: AbortSignal): Promise<TitleResult> {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const task = this.generateOnce(id, signal).finally(() => { this.inFlight.delete(id); });
    this.inFlight.set(id, task);
    return task;
  }

  /** Args: id: Indexed fork. signal: Cancellation. Returns: The accepted native title or a supersession receipt. */
  private async generateOnce(id: string, signal?: AbortSignal): Promise<TitleResult> {
    if (typeof id !== 'string' || !id.trim()) throw new Error('缺少学习分支标识。');
    const node = (await this.store.read()).tree.nodes.find(item => item.id === id);
    if (!node?.origin || node.origin.seq === undefined) throw new Error('这个分支没有可核对的原生继承边界。');
    const sessions = this.ctx.get('sessions');
    const titles = this.ctx.get('sessionTitle');
    const query = this.ctx.get('sessionQuery');
    const session = sessions?.get?.(id);
    if (!sessions?.get || !titles?.get || !titles?.rename || !query?.readSession) throw new Error('当前 DSH 未提供所需的标题服务。');
    if (!session) return { ready: true, superseded: true };
    const log = await query.readSession(id);
    const own = (seq: number): boolean => typeof session.isOwnSeq === 'function' ? session.isOwnSeq(seq) : seq > node.origin!.seq!;
    const event = log.events.find((item: any) => own(item.seq) && item.type === 'user/message'
      && item.data?.source?.kind === 'user' && item.data.content?.some((block: any) => block.type === 'text' && block.text.trim()));
    if (!event) return { ready: false };
    const fullText = event.data.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n');
    const before = titles.get(session);
    if (before && own(before.eventSeq) && before.title !== '新想法' && before.title !== initialBranchTitle(fullText)) {
      return { ready: true, title: before.title, superseded: true };
    }
    const first = { seq: event.seq, text: Array.from(fullText).slice(0, CONFIG.titleInputCharacters).join('') };
    const helper = await this.load();
    const policy = { maxInputBytes: CONFIG.titleInputBytes, maxOutputTokens: CONFIG.titleOutputTokens, timeoutMs: CONFIG.titleTimeoutMs };
    const request = { session, messages: [first], route: session.requestHeader?.()?.config, currentTitle: before,
      signal: signal ?? AbortSignal.timeout(CONFIG.titleTimeoutMs) };
    let title: string;
    if (typeof helper.executeSessionTitleLlm === 'function') {
      const response = await helper.executeSessionTitleLlm(this.ctx, helper.resolveSessionTitleLlmConfig(policy), request, 'dsh-study-tree', {
        system: `为学习对话中的这个新问题拟一个简洁标题。使用问题的语言，中文约 ${CONFIG.titleCjkCharacters} 字，其他语言约 ${CONFIG.titleWords} 个词。只输出一行自然语言标题，不加引号、解释或 Markdown。`,
        input: JSON.stringify([first]), messageSeqs: [first.seq], selectReasoningEffort: (model: any) => model.reasoning?.efforts[0]?.id,
      });
      title = titleFromResponse(response);
    } else if (typeof helper.generateSessionTitleWithLlm === 'function') {
      const policyLegacy = { ...policy, targetWords: CONFIG.titleWords, targetCjkCharacters: CONFIG.titleCjkCharacters };
      const response = await helper.generateSessionTitleWithLlm(this.ctx, helper.resolveSessionTitleLlmConfig(policyLegacy), request, [first], 'dsh-study-tree');
      title = response.title;
    } else throw new Error('当前 DSH 的辅助标题接口尚未适配。');
    if (request.signal.aborted) throw new Error('自动起标题已取消。');
    const current = titles.get(session);
    if (sessions.get(id) !== session || current?.eventSeq !== before?.eventSeq) return { ready: true, title: current?.title, superseded: true };
    const accepted = titles.rename(session, title);
    await sessions.flush(session);
    return { ready: true, title: accepted.title };
  }
}
