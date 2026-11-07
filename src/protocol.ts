export type WorkerInbound =
  | { type: 'load' }
  | { type: 'classify'; requestId: number; text: string };

export type WorkerProgress = {
  type: 'progress';
  file: string;
  loaded: number | null;
  total: number | null;
  /** 0–100 when the runtime reports it, otherwise null. */
  progress: number | null;
};

export type WorkerOutbound =
  | WorkerProgress
  | { type: 'ready' }
  | { type: 'load-error' }
  | { type: 'result'; requestId: number; label: 'POSITIVE' | 'NEGATIVE'; score: number }
  | { type: 'classify-error'; requestId: number };
