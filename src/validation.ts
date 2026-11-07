import { MAX_INPUT_CHARS } from './constants';

export type ValidationResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too_long'; message: string };

export function normalizeInput(raw: string): string {
  return raw.trim();
}

export function validateInput(raw: string): ValidationResult {
  const text = normalizeInput(raw);
  if (text.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      message: 'Enter some English text to classify.',
    };
  }
  if (text.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      reason: 'too_long',
      message: `Use ${MAX_INPUT_CHARS} characters or fewer. Longer text is rejected instead of being cut off.`,
    };
  }
  return { ok: true, text };
}
