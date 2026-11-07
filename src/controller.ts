import { EXAMPLES, MAX_INPUT_CHARS, MODEL_ONNX_BYTES } from './constants';
import { displayFileName, formatBytes, formatConfidence, formatModelSizeMb } from './format';
import type { WorkerOutbound } from './protocol';
import { mapClassification } from './result';
import { initialState, reduce, type Action, type AppState, type Effect } from './state';

export interface ModelClient {
  load(): void;
  classify(requestId: number, text: string): void;
  onMessage(handler: (message: WorkerOutbound) => void): void;
}

export type MountOptions = {
  supportsWasm?: () => boolean;
};

const CLASSIFY_FAILED =
  'Classification failed on this device. The text was not sent to a server. You can try again.';

function wasmAvailable(): boolean {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

function el<T extends HTMLElement>(root: ParentNode, id: string): T {
  const node = root.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

export function mount(root: HTMLElement, client: ModelClient, options: MountOptions = {}): void {
  const supportsWasm = options.supportsWasm ?? wasmAvailable;
  root.replaceChildren(buildShell());

  const loadButton = el<HTMLButtonElement>(root, 'load-model');
  const retryButton = el<HTMLButtonElement>(root, 'retry-model');
  const modelMessage = el<HTMLParagraphElement>(root, 'model-message');
  const modelDetail = el<HTMLParagraphElement>(root, 'model-detail');
  const progress = el<HTMLProgressElement>(root, 'model-progress');
  const textarea = el<HTMLTextAreaElement>(root, 'text-input');
  const charCount = el<HTMLParagraphElement>(root, 'char-count');
  const validation = el<HTMLParagraphElement>(root, 'validation');
  const classifyButton = el<HTMLButtonElement>(root, 'classify');
  const clearButton = el<HTMLButtonElement>(root, 'clear-text');
  const result = el<HTMLDivElement>(root, 'result');
  const resultLabel = el<HTMLParagraphElement>(root, 'result-label');
  const resultConfidence = el<HTMLParagraphElement>(root, 'result-confidence');
  const resultNote = el<HTMLParagraphElement>(root, 'result-note');
  const confidenceMeter = el<HTMLDivElement>(root, 'confidence-meter');
  const confidenceBar = el<HTMLDivElement>(root, 'confidence-bar');
  const runNote = el<HTMLParagraphElement>(root, 'run-note');

  let state = initialState();
  let lastProgressKey = '';

  function runEffect(effect: Effect): void {
    switch (effect.type) {
      case 'none':
        return;
      case 'load':
        if (!supportsWasm()) {
          dispatch({ type: 'model-error', reason: 'wasm' });
          return;
        }
        client.load();
        return;
      case 'classify':
        client.classify(effect.requestId, effect.text);
        return;
      default: {
        const unreachable: never = effect;
        throw new Error(`Unhandled effect: ${JSON.stringify(unreachable)}`);
      }
    }
  }

  function dispatch(action: Action): void {
    const next = reduce(state, action);
    state = next.state;
    render();
    runEffect(next.effect);
  }

  function render(): void {
    const model = state.model;
    loadButton.hidden = model.status !== 'unloaded';
    retryButton.hidden = model.status !== 'error';
    loadButton.disabled = model.status !== 'unloaded';
    retryButton.disabled = model.status !== 'error';

    modelMessage.textContent = modelStatusText(model);
    modelDetail.textContent = modelDetailText(state);
    const showProgress = model.status === 'loading';
    progress.hidden = !showProgress;
    if (model.status === 'loading' && model.progress !== null) {
      progress.value = Math.max(0, Math.min(100, model.progress));
      progress.removeAttribute('data-indeterminate');
    } else if (showProgress) {
      progress.removeAttribute('value');
      progress.dataset.indeterminate = 'true';
    }

    const normalizedLength = state.draft.trim().length;
    charCount.textContent = `${normalizedLength} / ${MAX_INPUT_CHARS} characters`;
    textarea.setAttribute('aria-invalid', state.validationMessage ? 'true' : 'false');
    validation.hidden = !state.validationMessage;
    validation.textContent = state.validationMessage ?? '';

    const sameResult =
      state.result !== null && state.result.text === state.draft.trim() && state.draft.trim().length > 0;
    const busy = state.inflight !== null;
    classifyButton.disabled = state.model.status !== 'ready' || busy || sameResult;
    classifyButton.textContent = classifyLabel(state, sameResult);
    clearButton.disabled = state.draft.length === 0 && state.result === null && !state.classifyError;

    const showRun = state.inflight !== null && state.inflight.text !== state.draft.trim();
    runNote.hidden = !showRun;
    runNote.textContent = showRun ? 'Finishing the previous run before another classification can start.' : '';

    const activeResult = state.result;
    const showResult = activeResult !== null;
    result.dataset.state = showResult ? 'result' : state.classifyError ? 'error' : busy && !showRun ? 'running' : 'empty';
    resultLabel.hidden = !showResult;
    resultConfidence.hidden = !showResult;
    confidenceMeter.hidden = !showResult;
    if (activeResult) {
      const name = activeResult.label === 'positive' ? 'Positive' : 'Negative';
      resultLabel.textContent = name;
      resultLabel.dataset.label = activeResult.label;
      const percent = formatConfidence(activeResult.score);
      resultConfidence.textContent = `Model confidence: ${percent}`;
      confidenceBar.style.width = percent;
      confidenceBar.dataset.label = activeResult.label;
      resultNote.textContent =
        'This score is how strongly the model prefers the label it picked. It is not factual certainty, and a high score can still be wrong.';
    } else if (state.classifyError) {
      resultLabel.hidden = true;
      resultNote.textContent = CLASSIFY_FAILED;
    } else if (busy && !showRun) {
      resultNote.textContent = 'Classifying on this device…';
    } else {
      resultNote.textContent = 'No classification yet.';
    }
  }

  loadButton.addEventListener('click', () => {
    lastProgressKey = '';
    dispatch({ type: 'load' });
  });
  retryButton.addEventListener('click', () => {
    lastProgressKey = '';
    dispatch({ type: 'load' });
  });
  textarea.addEventListener('input', () => {
    dispatch({ type: 'draft', value: textarea.value });
  });
  classifyButton.addEventListener('click', () => {
    dispatch({ type: 'classify' });
  });
  clearButton.addEventListener('click', () => {
    textarea.value = '';
    dispatch({ type: 'clear' });
  });

  const exampleHost = el<HTMLDivElement>(root, 'examples');
  for (const example of EXAMPLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.dataset.example = example.id;
    button.textContent = example.text;
    button.addEventListener('click', () => {
      textarea.value = example.text;
      dispatch({ type: 'draft', value: example.text });
      textarea.focus();
    });
    exampleHost.appendChild(button);
  }

  client.onMessage((message) => {
    switch (message.type) {
      case 'progress': {
        const percent = message.progress === null ? 'na' : String(Math.floor(message.progress));
        const key = `${message.file}:${percent}`;
        if (key === lastProgressKey) return;
        lastProgressKey = key;
        dispatch({
          type: 'progress',
          file: message.file,
          loaded: message.loaded,
          total: message.total,
          progress: message.progress,
        });
        return;
      }
      case 'ready':
        dispatch({ type: 'model-ready' });
        return;
      case 'load-error':
        dispatch({ type: 'model-error', reason: 'network' });
        return;
      case 'result':
        try {
          const mapped = mapClassification({ label: message.label, score: message.score });
          dispatch({
            type: 'result',
            requestId: message.requestId,
            label: mapped.label,
            score: mapped.score,
          });
        } catch {
          dispatch({ type: 'classify-error', requestId: message.requestId });
        }
        return;
      case 'classify-error':
        dispatch({ type: 'classify-error', requestId: message.requestId });
        return;
      default: {
        const unreachable: never = message;
        throw new Error(`Unhandled worker message: ${JSON.stringify(unreachable)}`);
      }
    }
  });

  render();
}

function modelStatusText(model: AppState['model']): string {
  switch (model.status) {
    case 'unloaded':
      return 'The model is not loaded yet.';
    case 'loading':
      return 'Loading the model on this device…';
    case 'ready':
      return 'The model is ready on this device.';
    case 'error':
      return 'The model could not be loaded.';
    default: {
      const unreachable: never = model;
      return unreachable;
    }
  }
}

function modelDetailText(state: AppState): string {
  const size = formatModelSizeMb(MODEL_ONNX_BYTES);
  if (state.model.status === 'loading') {
    const file = state.model.file ? displayFileName(state.model.file) : 'model files';
    if (state.model.loaded !== null && state.model.total) {
      return `${file}: ${formatBytes(state.model.loaded)} of ${formatBytes(state.model.total)}.`;
    }
    if (state.model.progress !== null) {
      return `${file}: ${Math.floor(state.model.progress)}%.`;
    }
    return `Preparing ${file}. The first visit downloads about ${size} MB.`;
  }
  if (state.model.status === 'error') {
    if (state.model.reason === 'wasm') {
      return 'This browser does not provide WebAssembly, so the model cannot run here.';
    }
    return 'Check your connection, then try again. Loading the model does not upload your text.';
  }
  if (state.model.status === 'ready') {
    return 'Classification runs locally. The text in the box is not sent to a server. Model files stay in this browser’s cache until you clear site data.';
  }
  return `Choose “Load model” to download it. The first load fetches about ${size} MB (${MODEL_ONNX_BYTES.toLocaleString('en-US')} bytes for the quantized weights, plus a tokenizer under 1 MB) from Hugging Face and stores those files in this browser’s cache. Later visits on this browser can reuse that cache. Your text is not part of the download. This needs WebAssembly and enough free memory; phones and low-memory devices can be slow or fail. Inference uses this device’s CPU.`;
}

function classifyLabel(state: AppState, sameResult: boolean): string {
  if (state.inflight && state.inflight.text === state.draft.trim()) return 'Classifying…';
  if (sameResult) return 'Already classified';
  return 'Classify sentiment';
}

function buildShell(): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'wrap';
  shell.innerHTML = `
    <a class="skip" href="#text-input">Skip to text</a>
    <header class="hero">
      <p class="kicker">In this browser · English · Positive or negative</p>
      <h1>Sentiment classifier</h1>
      <p class="lede">
        A small DistilBERT model labels one short English passage as positive or negative.
        It runs here, after you load it. Nothing you type is submitted anywhere.
      </p>
    </header>
    <main>
      <section class="card" aria-labelledby="model-heading">
        <h2 id="model-heading">Model</h2>
        <p id="model-message" role="status"></p>
        <p id="model-detail" class="fine"></p>
        <progress id="model-progress" max="100" aria-label="Model download progress" hidden></progress>
        <div class="actions">
          <button type="button" id="load-model">Load model</button>
          <button type="button" id="retry-model" hidden>Try again</button>
        </div>
      </section>
      <section class="card" aria-labelledby="classify-heading">
        <h2 id="classify-heading">Text</h2>
        <label for="text-input">English text</label>
        <textarea
          id="text-input"
          maxlength="4000"
          rows="5"
          spellcheck="true"
          autocomplete="off"
          aria-describedby="char-count text-hint validation"
        ></textarea>
        <p id="char-count" class="fine"></p>
        <p id="text-hint" class="fine">
          Whitespace at the ends is ignored. The limit is ${MAX_INPUT_CHARS} characters so the text is not silently cut off.
          This model has no neutral label.
        </p>
        <p id="validation" class="alert" role="alert" hidden></p>
        <h3 id="examples-heading">Examples</h3>
        <div id="examples" class="examples" role="group" aria-labelledby="examples-heading"></div>
        <div class="actions">
          <button type="button" id="classify">Classify sentiment</button>
          <button type="button" id="clear-text" class="secondary">Clear</button>
        </div>
        <p id="run-note" class="fine" role="status" hidden></p>
      </section>
      <section class="card" aria-labelledby="result-heading">
        <h2 id="result-heading">Result</h2>
        <div id="result" aria-live="polite" aria-atomic="true">
          <p id="result-label" class="verdict" hidden></p>
          <div id="confidence-meter" class="meter" aria-hidden="true" hidden><div id="confidence-bar"></div></div>
          <p id="result-confidence" hidden></p>
          <p id="result-note" class="fine"></p>
        </div>
      </section>
      <section class="card limits" aria-labelledby="limits-heading">
        <h2 id="limits-heading">Read this before you rely on a label</h2>
        <ul>
          <li>English only. Other languages are outside what this model was trained on.</li>
          <li>It is a binary classifier. Every input is forced to positive or negative. There is no neutral class.</li>
          <li>Sarcasm, mixed sentiment, and ambiguous wording can be labeled wrongly.</li>
          <li>It was fine-tuned on short movie-review sentences and can reproduce bias from that data. A country or group mentioned in a sentence can swing the label even when the sentence is not expressing sentiment about them.</li>
          <li>Do not use it for hiring, health, credit, moderation, or any other consequential decision.</li>
          <li>The percentage is the model’s confidence in the label it chose, not proof the label is correct. This site has not measured the model’s accuracy.</li>
        </ul>
      </section>
    </main>
    <footer>
      <p>
        Weights:
        <a href="https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english">Xenova/distilbert-base-uncased-finetuned-sst-2-english</a>
        (quantized ONNX, about ${formatModelSizeMb(MODEL_ONNX_BYTES)} MB), converted for Transformers.js from
        <a href="https://huggingface.co/distilbert/distilbert-base-uncased-finetuned-sst-2-english">distilbert/distilbert-base-uncased-finetuned-sst-2-english</a>
        (Apache-2.0).
      </p>
      <p>No account, no analytics, and no application server. The model files come from Hugging Face when you load them.</p>
    </footer>
  `;
  return shell;
}
