import { describe, expect, it } from 'vitest';
import { MAX_INPUT_CHARS } from '../src/constants';
import { displayFileName, formatBytes, formatConfidence } from '../src/format';
import { mapClassification, UnexpectedModelOutput } from '../src/result';
import { initialState, reduce, type AppState } from '../src/state';
import { validateInput } from '../src/validation';

function readyState(): AppState {
  const loaded = reduce(initialState(), { type: 'load' });
  const ready = reduce(loaded.state, { type: 'model-ready' });
  return ready.state;
}

describe('validateInput', () => {
  it('rejects empty and whitespace-only text', () => {
    const empty = validateInput('');
    const spaces = validateInput('   \n\t');
    expect(empty.ok).toBe(false);
    expect(spaces.ok).toBe(false);
    if (!spaces.ok) expect(spaces.reason).toBe('empty');
  });

  it('trims a valid sentence and accepts the character limit exactly', () => {
    const text = `  ${'a'.repeat(MAX_INPUT_CHARS)}  `;
    const result = validateInput(text);
    expect(result).toEqual({ ok: true, text: 'a'.repeat(MAX_INPUT_CHARS) });
  });

  it('rejects text past the limit instead of truncating it', () => {
    const result = validateInput('a'.repeat(MAX_INPUT_CHARS + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too_long');
      expect(result.message).toContain(String(MAX_INPUT_CHARS));
    }
  });
});

describe('mapClassification', () => {
  it('maps the winning pipeline label and clamps a score of 1', () => {
    expect(mapClassification([{ label: 'POSITIVE', score: 1 }])).toEqual({
      label: 'positive',
      score: 1,
    });
    expect(mapClassification({ label: 'negative', score: 0.25 })).toEqual({
      label: 'negative',
      score: 0.25,
    });
  });

  it('rejects unknown labels and scores that are not probabilities', () => {
    expect(() => mapClassification([{ label: 'NEUTRAL', score: 0.4 }])).toThrow(UnexpectedModelOutput);
    expect(() => mapClassification([{ label: 'POSITIVE', score: Number.NaN }])).toThrow(
      UnexpectedModelOutput,
    );
    expect(() => mapClassification([{ label: 'POSITIVE', score: 1.2 }])).toThrow(UnexpectedModelOutput);
    expect(() => mapClassification(null)).toThrow(UnexpectedModelOutput);
  });
});

describe('formatters', () => {
  it('formats sizes, confidence, and file names without keeping a url query', () => {
    expect(formatBytes(67_581_197)).toBe('67.6 MB');
    expect(formatConfidence(0.98764)).toBe('98.8%');
    expect(formatConfidence(0.9998)).toBe('99.9%');
    expect(formatConfidence(1)).toBe('100.0%');
    expect(displayFileName('https://example.test/onnx/model_quantized.onnx?download=1')).toBe(
      'model_quantized.onnx',
    );
  });
});

describe('reduce', () => {
  it('loads once, records progress, and can retry after an error', () => {
    const first = reduce(initialState(), { type: 'load' });
    expect(first.effect).toEqual({ type: 'load' });
    expect(first.state.model.status).toBe('loading');

    const second = reduce(first.state, { type: 'load' });
    expect(second.effect).toEqual({ type: 'none' });

    const progressed = reduce(first.state, {
      type: 'progress',
      file: 'onnx/model_quantized.onnx',
      loaded: 10,
      total: 100,
      progress: 10,
    });
    expect(progressed.state.model).toMatchObject({ status: 'loading', progress: 10 });

    const ignored = reduce(initialState(), {
      type: 'progress',
      file: 'onnx/model_quantized.onnx',
      loaded: 10,
      total: 100,
      progress: 10,
    });
    expect(ignored.state.model.status).toBe('unloaded');

    const failed = reduce(first.state, { type: 'model-error', reason: 'network' });
    expect(failed.state.model).toEqual({ status: 'error', reason: 'network' });
    const retry = reduce(failed.state, { type: 'load' });
    expect(retry.effect).toEqual({ type: 'load' });
    expect(retry.state.model.status).toBe('loading');
  });

  it('does not let a late error replace a ready model', () => {
    const next = reduce(readyState(), { type: 'model-error', reason: 'network' });
    expect(next.state.model.status).toBe('ready');
  });

  it('classifies trimmed text once and ignores a repeated request for the same text', () => {
    const started = reduce(readyState(), { type: 'draft', value: '  I enjoyed it.  ' });
    const first = reduce(started.state, { type: 'classify' });
    expect(first.effect).toEqual({ type: 'classify', requestId: 1, text: 'I enjoyed it.' });

    const duplicate = reduce(first.state, { type: 'classify' });
    expect(duplicate.effect).toEqual({ type: 'none' });

    const finished = reduce(first.state, {
      type: 'result',
      requestId: 1,
      label: 'positive',
      score: 0.9,
    });
    expect(finished.state.result).toMatchObject({ text: 'I enjoyed it.', label: 'positive', score: 0.9 });
    expect(finished.state.inflight).toBeNull();

    const again = reduce(finished.state, { type: 'classify' });
    expect(again.effect).toEqual({ type: 'none' });
  });

  it('shows a length error while typing and an empty error on classify', () => {
    const tooLong = reduce(readyState(), { type: 'draft', value: 'b'.repeat(MAX_INPUT_CHARS + 5) });
    expect(tooLong.state.validationMessage).toContain(String(MAX_INPUT_CHARS));
    const blocked = reduce(tooLong.state, { type: 'classify' });
    expect(blocked.effect).toEqual({ type: 'none' });

    const empty = reduce(readyState(), { type: 'classify' });
    expect(empty.state.validationMessage).toContain('Enter some English text');
    expect(empty.effect).toEqual({ type: 'none' });
  });

  it('drops a stale result when the text changed, then accepts the next request', () => {
    const drafted = reduce(readyState(), { type: 'draft', value: 'alpha' });
    const running = reduce(drafted.state, { type: 'classify' });
    const edited = reduce(running.state, { type: 'draft', value: 'beta' });
    expect(edited.state.inflight).toEqual({ requestId: 1, text: 'alpha' });
    expect(edited.state.result).toBeNull();

    const stale = reduce(edited.state, {
      type: 'result',
      requestId: 1,
      label: 'positive',
      score: 0.99,
    });
    expect(stale.state.result).toBeNull();
    expect(stale.state.inflight).toBeNull();

    const mismatch = reduce(running.state, {
      type: 'result',
      requestId: 99,
      label: 'negative',
      score: 0.2,
    });
    expect(mismatch.state.inflight?.requestId).toBe(1);
    expect(mismatch.state.result).toBeNull();

    const next = reduce(stale.state, { type: 'classify' });
    expect(next.effect).toEqual({ type: 'classify', requestId: 2, text: 'beta' });
  });

  it('clears the draft and result without applying an in-flight response', () => {
    const drafted = reduce(readyState(), { type: 'draft', value: 'alpha' });
    const running = reduce(drafted.state, { type: 'classify' });
    const withResult = reduce(running.state, {
      type: 'result',
      requestId: 1,
      label: 'negative',
      score: 0.4,
    });
    const cleared = reduce(withResult.state, { type: 'clear' });
    expect(cleared.state.draft).toBe('');
    expect(cleared.state.result).toBeNull();
    expect(cleared.state.validationMessage).toBeNull();

    const restarted = reduce(readyState(), { type: 'draft', value: 'alpha' });
    const inflight = reduce(restarted.state, { type: 'classify' });
    const wiped = reduce(inflight.state, { type: 'clear' });
    const late = reduce(wiped.state, {
      type: 'result',
      requestId: 1,
      label: 'positive',
      score: 0.7,
    });
    expect(late.state.draft).toBe('');
    expect(late.state.result).toBeNull();
    expect(late.state.inflight).toBeNull();
  });

  it('shows a classification error only for the text that was running', () => {
    const drafted = reduce(readyState(), { type: 'draft', value: 'alpha' });
    const running = reduce(drafted.state, { type: 'classify' });
    const failed = reduce(running.state, { type: 'classify-error', requestId: 1 });
    expect(failed.state.classifyError).toBe(true);
    expect(failed.state.inflight).toBeNull();

    const moved = reduce(running.state, { type: 'draft', value: 'beta' });
    const ignored = reduce(moved.state, { type: 'classify-error', requestId: 1 });
    expect(ignored.state.classifyError).toBe(false);
  });

  it('does not classify before the model is ready', () => {
    const drafted = reduce(initialState(), { type: 'draft', value: 'hello' });
    const blocked = reduce(drafted.state, { type: 'classify' });
    expect(blocked.effect).toEqual({ type: 'none' });
    expect(blocked.state.inflight).toBeNull();
  });
});
