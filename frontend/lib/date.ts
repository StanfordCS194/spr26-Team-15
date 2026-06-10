const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseCaseDate(value: string): Date | null {
  if (!value) return null;

  // Treat plain YYYY-MM-DD values as local dates, not UTC midnights, so they do not
  // render as the previous day in western time zones.
  const parsed = ISO_DATE_ONLY_RE.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatCaseDate(value: string, locale?: string | string[]): string {
  const parsed = parseCaseDate(value);
  if (!parsed) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parsed);
}
