/** Hugging Face repo that publishes Transformers.js ONNX weights for SST-2 DistilBERT. */
export const MODEL_ID = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';

/**
 * WASM default in Transformers.js. `q8` resolves to `onnx/model_quantized.onnx`.
 * Checked against the Hub listing: 67,581,197 bytes (shown there as 67.6 MB).
 */
export const MODEL_DTYPE = 'q8' as const;

export const MODEL_ONNX_FILE = 'onnx/model_quantized.onnx';

export const MODEL_ONNX_BYTES = 67_581_197;

/** Reject rather than silently truncate. See README for why this bound is safe. */
export const MAX_INPUT_CHARS = 500;

export const EXAMPLES = [
  { id: 'warm', text: 'I loved this film from the opening scene.' },
  { id: 'cold', text: 'The food was cold and the service was rude.' },
  { id: 'mixed', text: 'The acting was great, but the story went nowhere.' },
] as const;
