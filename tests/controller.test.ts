import { afterEach, describe, expect, it } from 'vitest';
import { MAX_INPUT_CHARS } from '../src/constants';
import { mount, type ModelClient } from '../src/controller';
import type { WorkerOutbound } from '../src/protocol';

class FakeClient implements ModelClient {
  loads = 0;
  classifications: Array<{ requestId: number; text: string }> = [];
  private handler: (message: WorkerOutbound) => void = () => {};

  load(): void {
    this.loads += 1;
  }

  classify(requestId: number, text: string): void {
    this.classifications.push({ requestId, text });
  }

  onMessage(handler: (message: WorkerOutbound) => void): void {
    this.handler = handler;
  }

  emit(message: WorkerOutbound): void {
    this.handler(message);
  }
}

function setup(supportsWasm = true): { client: FakeClient } {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app');
  if (!root) throw new Error('missing app');
  const client = new FakeClient();
  mount(root, client, { supportsWasm: () => supportsWasm });
  return { client };
}

function button(id: string): HTMLButtonElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`missing ${id}`);
  return node;
}

function textbox(): HTMLTextAreaElement {
  const node = document.getElementById('text-input');
  if (!(node instanceof HTMLTextAreaElement)) throw new Error('missing text');
  return node;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('controller', () => {
  it('loads only after the explicit action and renders progress, failure, and retry', () => {
    const { client } = setup();
    expect(client.loads).toBe(0);
    expect(document.body.textContent).toContain('67.6 MB');
    expect(document.body.textContent).toContain('not part of the download');
    expect(document.getElementById('confidence-meter')?.hasAttribute('hidden')).toBe(true);

    button('load-model').click();
    expect(client.loads).toBe(1);
    expect(button('load-model').disabled).toBe(true);

    client.emit({
      type: 'progress',
      file: 'https://huggingface.co/onnx/model_quantized.onnx?download=true',
      loaded: 1_000_000,
      total: 67_581_197,
      progress: 1.2,
    });
    client.emit({
      type: 'progress',
      file: 'https://huggingface.co/onnx/model_quantized.onnx?download=true',
      loaded: 1_100_000,
      total: 67_581_197,
      progress: 1.4,
    });
    expect(document.getElementById('model-detail')?.textContent).toContain('model_quantized.onnx');
    expect(document.getElementById('model-detail')?.textContent).not.toContain('download=true');

    client.emit({ type: 'load-error' });
    expect(document.getElementById('model-message')?.textContent).toContain('could not be loaded');
    expect(button('retry-model').hidden).toBe(false);

    button('retry-model').click();
    expect(client.loads).toBe(2);
    client.emit({ type: 'ready' });
    expect(document.getElementById('model-message')?.textContent).toContain('ready');
    expect(button('retry-model').hidden).toBe(true);
  });

  it('explains a missing WebAssembly implementation without starting a download', () => {
    const { client } = setup(false);
    button('load-model').click();
    expect(client.loads).toBe(0);
    expect(document.getElementById('model-detail')?.textContent).toContain('WebAssembly');
  });

  it('classifies an example once, ignores a repeated click, and resets on clear', () => {
    const { client } = setup();
    button('load-model').click();
    client.emit({ type: 'ready' });

    const example = document.querySelector<HTMLButtonElement>('[data-example="warm"]');
    example?.click();
    expect(textbox().value).toContain('loved this film');
    expect(client.classifications).toHaveLength(0);

    button('classify').click();
    expect(client.classifications).toEqual([
      { requestId: 1, text: 'I loved this film from the opening scene.' },
    ]);
    expect(button('classify').disabled).toBe(true);

    button('classify').click();
    expect(client.classifications).toHaveLength(1);

    client.emit({ type: 'result', requestId: 1, label: 'POSITIVE', score: 0.991 });
    expect(document.getElementById('result-label')?.textContent).toBe('Positive');
    expect(document.getElementById('result-confidence')?.textContent).toContain('99.1%');
    expect(document.getElementById('result-note')?.textContent).toContain('not factual certainty');
    expect(button('classify').textContent).toBe('Already classified');

    button('classify').click();
    expect(client.classifications).toHaveLength(1);

    button('clear-text').click();
    expect(textbox().value).toBe('');
    expect(document.getElementById('result-label')?.hidden).toBe(true);
    expect(document.getElementById('result-note')?.textContent).toContain('No classification yet');
  });

  it('shows validation and does not dispatch an inference', () => {
    const { client } = setup();
    button('load-model').click();
    client.emit({ type: 'ready' });

    button('classify').click();
    expect(client.classifications).toHaveLength(0);
    expect(document.getElementById('validation')?.textContent).toContain('Enter some English text');

    textbox().value = 'c'.repeat(MAX_INPUT_CHARS + 2);
    textbox().dispatchEvent(new Event('input'));
    expect(document.getElementById('validation')?.textContent).toContain(String(MAX_INPUT_CHARS));
    button('classify').click();
    expect(client.classifications).toHaveLength(0);
  });

  it('ignores a stale result after the text changes and after clear', () => {
    const { client } = setup();
    button('load-model').click();
    client.emit({ type: 'ready' });

    textbox().value = 'alpha';
    textbox().dispatchEvent(new Event('input'));
    button('classify').click();

    textbox().value = 'beta';
    textbox().dispatchEvent(new Event('input'));
    client.emit({ type: 'result', requestId: 1, label: 'NEGATIVE', score: 0.8 });
    expect(document.getElementById('result-label')?.hidden).toBe(true);
    expect(document.body.textContent).not.toContain('Negative');

    button('classify').click();
    expect(client.classifications[1]).toEqual({ requestId: 2, text: 'beta' });
    button('clear-text').click();
    client.emit({ type: 'result', requestId: 2, label: 'POSITIVE', score: 0.6 });
    expect(document.getElementById('result-label')?.hidden).toBe(true);
    expect(textbox().value).toBe('');
  });

  it('surfaces a classification failure without echoing the typed text in the result', () => {
    const { client } = setup();
    button('load-model').click();
    client.emit({ type: 'ready' });
    textbox().value = 'private sentence';
    textbox().dispatchEvent(new Event('input'));
    button('classify').click();
    client.emit({ type: 'classify-error', requestId: 1 });
    const note = document.getElementById('result-note')?.textContent ?? '';
    expect(note).toContain('not sent to a server');
    expect(note).not.toContain('private sentence');
  });
});
