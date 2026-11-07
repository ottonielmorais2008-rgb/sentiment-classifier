import { env, pipeline, type TextClassificationPipeline } from '@huggingface/transformers';
import { MODEL_DTYPE, MODEL_ID } from './constants';
import type { WorkerInbound, WorkerOutbound } from './protocol';
import { mapClassification } from './result';

env.allowLocalModels = false;
env.useBrowserCache = true;

const wasmBackend = env.backends.onnx.wasm;
if (wasmBackend) {
  wasmBackend.numThreads = 1;
  wasmBackend.proxy = false;
  // Stable names copied next to the build. Overrides the jsDelivr default.
  wasmBackend.wasmPaths = `${import.meta.env.BASE_URL}ort/`;
}

type Scope = {
  onmessage: ((event: MessageEvent<WorkerInbound>) => void) | null;
  postMessage(message: WorkerOutbound): void;
};

const scope = globalThis as unknown as Scope;

let classifierPromise: Promise<TextClassificationPipeline> | null = null;
let loadTask: Promise<void> | null = null;

function post(message: WorkerOutbound): void {
  scope.postMessage(message);
}

function reportProgress(info: unknown): void {
  if (!info || typeof info !== 'object') return;
  const record = info as Record<string, unknown>;
  const status = record.status;
  if (
    status !== 'initiate' &&
    status !== 'download' &&
    status !== 'progress' &&
    status !== 'done'
  ) {
    return;
  }
  const file = typeof record.file === 'string' ? record.file : '';
  if (!file) return;
  const loaded = typeof record.loaded === 'number' ? record.loaded : null;
  const total = typeof record.total === 'number' ? record.total : null;
  const fraction = typeof record.progress === 'number' ? record.progress : null;
  post({
    type: 'progress',
    file,
    loaded,
    total,
    progress: status === 'done' ? 100 : fraction,
  });
}

function getClassifier(): Promise<TextClassificationPipeline> {
  if (!classifierPromise) {
    const created = pipeline('sentiment-analysis', MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'wasm',
      progress_callback: reportProgress,
    });
    classifierPromise = created.catch((error: unknown) => {
      classifierPromise = null;
      throw error;
    });
  }
  return classifierPromise;
}

async function loadModel(): Promise<void> {
  try {
    await getClassifier();
    post({ type: 'ready' });
  } catch {
    post({ type: 'load-error' });
  }
}

function requestLoad(): void {
  if (!loadTask) {
    loadTask = loadModel().finally(() => {
      loadTask = null;
    });
  }
}

async function classify(requestId: number, text: string): Promise<void> {
  if (!classifierPromise) {
    post({ type: 'classify-error', requestId });
    return;
  }
  try {
    const classifier = await classifierPromise;
    const output: unknown = await classifier(text, { top_k: 1 });
    const mapped = mapClassification(output);
    post({
      type: 'result',
      requestId,
      label: mapped.label === 'positive' ? 'POSITIVE' : 'NEGATIVE',
      score: mapped.score,
    });
  } catch {
    post({ type: 'classify-error', requestId });
  }
}

scope.onmessage = (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object' || !('type' in data)) return;
  switch (data.type) {
    case 'load':
      requestLoad();
      return;
    case 'classify':
      if (typeof data.requestId !== 'number' || typeof data.text !== 'string') return;
      void classify(data.requestId, data.text);
      return;
    default: {
      const unreachable: never = data;
      return unreachable;
    }
  }
};
