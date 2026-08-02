function toUnixTimestamp(dateOrSeconds: Date | number): number {
  if (typeof dateOrSeconds === 'number') {
    return Math.floor(dateOrSeconds);
  }
  return Math.floor(dateOrSeconds.getTime() / 1000);
}

export function formatDiscordRelative(dateOrSeconds: Date | number): string {
  return `<t:${toUnixTimestamp(dateOrSeconds)}:R>`;
}

export function formatDiscordShortDateTime(dateOrSeconds: Date | number): string {
  return `<t:${toUnixTimestamp(dateOrSeconds)}:f>`;
}

export function formatDiscordLongDateTime(dateOrSeconds: Date | number): string {
  return `<t:${toUnixTimestamp(dateOrSeconds)}:F>`;
}

export function formatUtcFooterTimestamp(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = new Map(
    formatter
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.get('day')}.${parts.get('month')}.${parts.get('year')} ${parts.get('hour')}:${parts.get('minute')} UTC`;
}
