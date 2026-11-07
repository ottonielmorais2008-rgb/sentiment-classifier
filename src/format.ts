export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function formatConfidence(score: number): string {
  const percent = score * 100;
  if (score < 1 && percent >= 99.95) return '99.9%';
  return `${percent.toFixed(1)}%`;
}

/** Show a file name, never a full download URL. */
export function displayFileName(file: string): string {
  const trimmed = file.trim();
  if (!trimmed) return 'model file';
  const withoutQuery = trimmed.split('?')[0] ?? trimmed;
  const slash = Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'));
  const base = slash >= 0 ? withoutQuery.slice(slash + 1) : withoutQuery;
  return base.slice(0, 80) || 'model file';
}

export function formatModelSizeMb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}
