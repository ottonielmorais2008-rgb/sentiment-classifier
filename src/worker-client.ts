import type { WorkerInbound, WorkerOutbound } from './protocol';

type WorkerScope = {
  postMessage(message: WorkerInbound): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerOutbound>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
};

export function createWorkerClient(): {
  load(): void;
  classify(requestId: number, text: string): void;
  onMessage(handler: (message: WorkerOutbound) => void): void;
} {
  let worker: WorkerScope | null = null;
  let handler: (message: WorkerOutbound) => void = () => {};

  function ensureWorker(): WorkerScope {
    if (worker) return worker;
    const created = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as WorkerScope;
    created.addEventListener('message', (event) => {
      handler(event.data);
    });
    created.addEventListener('error', () => {
      handler({ type: 'load-error' });
    });
    worker = created;
    return created;
  }

  return {
    load() {
      ensureWorker().postMessage({ type: 'load' });
    },
    classify(requestId, text) {
      ensureWorker().postMessage({ type: 'classify', requestId, text });
    },
    onMessage(next) {
      handler = next;
    },
  };
}
