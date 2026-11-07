export type SentimentLabel = 'positive' | 'negative';

export type MappedResult = {
  label: SentimentLabel;
  score: number;
};

export class UnexpectedModelOutput extends Error {
  constructor() {
    super('Unexpected model output');
    this.name = 'UnexpectedModelOutput';
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as Record<string, unknown>;
}

/** Map a Transformers.js text-classification item to the two labels this UI can show. */
export function mapClassification(raw: unknown): MappedResult {
  const record = readRecord(raw);
  if (!record) throw new UnexpectedModelOutput();

  const labelRaw = typeof record.label === 'string' ? record.label.toUpperCase() : '';
  const score = record.score;
  if (labelRaw !== 'POSITIVE' && labelRaw !== 'NEGATIVE') throw new UnexpectedModelOutput();
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1.000001) {
    throw new UnexpectedModelOutput();
  }

  return {
    label: labelRaw === 'POSITIVE' ? 'positive' : 'negative',
    score: Math.min(1, score),
  };
}
