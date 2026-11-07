import { normalizeInput, validateInput } from './validation';
import type { SentimentLabel } from './result';

export type ModelErrorReason = 'network' | 'wasm';

export type ModelPhase =
  | { status: 'unloaded' }
  | {
      status: 'loading';
      file: string | null;
      loaded: number | null;
      total: number | null;
      progress: number | null;
    }
  | { status: 'ready' }
  | { status: 'error'; reason: ModelErrorReason };

export type Inflight = {
  requestId: number;
  text: string;
};

export type VisibleResult = {
  requestId: number;
  text: string;
  label: SentimentLabel;
  score: number;
};

export type AppState = {
  model: ModelPhase;
  draft: string;
  validationMessage: string | null;
  classifyError: boolean;
  inflight: Inflight | null;
  result: VisibleResult | null;
  nextRequestId: number;
};

export type Action =
  | { type: 'draft'; value: string }
  | { type: 'load' }
  | {
      type: 'progress';
      file: string;
      loaded: number | null;
      total: number | null;
      progress: number | null;
    }
  | { type: 'model-ready' }
  | { type: 'model-error'; reason: ModelErrorReason }
  | { type: 'classify' }
  | { type: 'clear' }
  | { type: 'result'; requestId: number; label: SentimentLabel; score: number }
  | { type: 'classify-error'; requestId: number };

export type Effect =
  | { type: 'none' }
  | { type: 'load' }
  | { type: 'classify'; requestId: number; text: string };

export type Reduction = {
  state: AppState;
  effect: Effect;
};

export function initialState(): AppState {
  return {
    model: { status: 'unloaded' },
    draft: '',
    validationMessage: null,
    classifyError: false,
    inflight: null,
    result: null,
    nextRequestId: 1,
  };
}

function keep(state: AppState): Reduction {
  return { state, effect: { type: 'none' } };
}

export function reduce(state: AppState, action: Action): Reduction {
  switch (action.type) {
    case 'draft': {
      const validation = validateInput(action.value);
      const normalized = normalizeInput(action.value);
      const result = state.result && state.result.text === normalized ? state.result : null;
      return keep({
        ...state,
        draft: action.value,
        result,
        validationMessage: !validation.ok && validation.reason === 'too_long' ? validation.message : null,
        classifyError: false,
      });
    }
    case 'load': {
      if (state.model.status === 'loading' || state.model.status === 'ready') return keep(state);
      return {
        state: {
          ...state,
          model: { status: 'loading', file: null, loaded: null, total: null, progress: null },
        },
        effect: { type: 'load' },
      };
    }
    case 'progress': {
      if (state.model.status !== 'loading') return keep(state);
      return keep({
        ...state,
        model: {
          status: 'loading',
          file: action.file,
          loaded: action.loaded,
          total: action.total,
          progress: action.progress,
        },
      });
    }
    case 'model-ready': {
      if (state.model.status !== 'loading') return keep(state);
      return keep({ ...state, model: { status: 'ready' } });
    }
    case 'model-error': {
      if (state.model.status !== 'loading') return keep(state);
      return keep({ ...state, model: { status: 'error', reason: action.reason } });
    }
    case 'classify': {
      if (state.model.status !== 'ready' || state.inflight) return keep(state);
      const validation = validateInput(state.draft);
      if (!validation.ok) {
        return keep({ ...state, validationMessage: validation.message, classifyError: false });
      }
      if (state.result && state.result.text === validation.text) return keep(state);
      const requestId = state.nextRequestId;
      return {
        state: {
          ...state,
          nextRequestId: requestId + 1,
          validationMessage: null,
          classifyError: false,
          inflight: { requestId, text: validation.text },
        },
        effect: { type: 'classify', requestId, text: validation.text },
      };
    }
    case 'clear':
      return keep({
        ...state,
        draft: '',
        validationMessage: null,
        classifyError: false,
        result: null,
      });
    case 'result': {
      if (!state.inflight || state.inflight.requestId !== action.requestId) return keep(state);
      const text = state.inflight.text;
      const matches = normalizeInput(state.draft) === text;
      return keep({
        ...state,
        inflight: null,
        classifyError: false,
        result: matches
          ? { requestId: action.requestId, text, label: action.label, score: action.score }
          : state.result,
      });
    }
    case 'classify-error': {
      if (!state.inflight || state.inflight.requestId !== action.requestId) return keep(state);
      const matches = normalizeInput(state.draft) === state.inflight.text;
      return keep({
        ...state,
        inflight: null,
        classifyError: matches,
        result: matches ? null : state.result,
      });
    }
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
