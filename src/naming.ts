import { CONFIG } from './config.ts';

/** Args: question: First local user message. Returns: A readable Unicode-safe provisional title. */
export function initialBranchTitle(question: string): string {
  return Array.from(question.trim().replace(/\s+/gu, ' ')).slice(0, CONFIG.fallbackTitleLength).join('');
}

/** Args: response: Auxiliary model output. Returns: Plain title text. Throws: Error on invalid finishes or content. */
export function titleFromResponse(response: any): string {
  if (response?.finish?.kind !== 'stop' || !Array.isArray(response.blocks)
    || response.blocks.some((block: any) => block.type === 'tool-call')) throw new Error('标题模型没有返回完整的纯文本标题。');
  const text = response.blocks.filter((block: any) => block.type === 'text').map((block: any) => block.text).join(' ');
  const line = text.split(/\r?\n/u).map((item: string) => item.trim()).find(Boolean) ?? '';
  const title = line.replace(/^\*{1,3}(.+?)\*{1,3}$/u, '$1').replace(/^["“](.*)["”]$/u, '$1').trim();
  if (!title) throw new Error('标题模型返回了空标题。');
  return title;
}
