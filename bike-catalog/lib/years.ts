/**
 * A catalog row covers a span of model years: a build sheet usually holds for a
 * whole generation (or until the brand swaps the groupset), so one row per
 * generation replaces one row per year. `yearEnd` null means a single year.
 */
export type YearSpan = {
  yearStart: number | null;
  yearEnd: number | null;
};

export function spanEnd(span: YearSpan): number | null {
  return span.yearEnd ?? span.yearStart;
}

/**
 * Years between a job bike's year and a catalog span: 0 inside the span, the
 * distance to the nearest end outside it, null when either side has no year.
 */
export function yearGap(year: number | null | undefined, span: YearSpan): number | null {
  if (year == null || span.yearStart == null) return null;
  const end = spanEnd(span) ?? span.yearStart;
  if (year < span.yearStart) return span.yearStart - year;
  if (year > end) return year - end;
  return 0;
}

/** "2019" or "2017–2020"; null when the row is undated. */
export function formatYearSpan(span: YearSpan): string | null {
  if (span.yearStart == null) return null;
  const end = spanEnd(span);
  return end != null && end !== span.yearStart ? `${span.yearStart}–${end}` : String(span.yearStart);
}

/** Normalise a span so yearEnd is always set when yearStart is, and start <= end. */
export function normalizeYearSpan(
  yearStart: number | null | undefined,
  yearEnd: number | null | undefined
): YearSpan {
  const start = yearStart ?? yearEnd ?? null;
  const end = yearEnd ?? yearStart ?? null;
  if (start == null || end == null) return { yearStart: start, yearEnd: end };
  return start <= end ? { yearStart: start, yearEnd: end } : { yearStart: end, yearEnd: start };
}
