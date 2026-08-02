export function blockquoteLine(value: string): string {
  const trimmed = value.trimEnd();
  if (trimmed === '') return '>';
  return `> ${trimmed}`;
}

export function formatBlockquote(lines: readonly string[]): string {
  if (lines.length === 0) return '';
  return lines.map((line) => blockquoteLine(line)).join('\n');
}
