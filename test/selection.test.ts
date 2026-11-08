import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveQuote } from '../src/selection.ts';

test('finds a unique quote without requiring surrounding context', () => {
  assert.deepEqual(resolveQuote('声音先变成电信号，再进行采样。', '电信号'), { start: 5, end: 8 });
});

test('refuses an ambiguous repeated quote', () => {
  assert.equal(resolveQuote('声音频率和采样频率不同。', '频率'), undefined);
});

test('uses prefix and suffix to identify one occurrence', () => {
  assert.deepEqual(resolveQuote('声音频率和采样频率不同。', '频率', '采样', '不同'), { start: 7, end: 9 });
});

test('does not jump to a surviving quote when its saved context changed', () => {
  assert.equal(resolveQuote('电压频率不同。', '频率', '采样', '不同'), undefined);
});

test('detects ambiguity even when occurrences overlap', () => {
  assert.equal(resolveQuote('aaaa', 'aaa'), undefined);
});

test('rejects empty quotes and tolerates a quote at either boundary', () => {
  assert.equal(resolveQuote('声音', ''), undefined);
  assert.deepEqual(resolveQuote('声音采集', '声音', '', '采集'), { start: 0, end: 2 });
  assert.deepEqual(resolveQuote('声音采集', '采集', '声音', ''), { start: 2, end: 4 });
});

test('requires both context anchors when both were saved', () => {
  assert.equal(resolveQuote('声音频率不同，采样频率相同。', '频率', '声音', '相同'), undefined);
});
