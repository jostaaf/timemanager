export function isUtcIsoTimestamp(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function assertUtcIsoTimestamp(value: string, field: string): void {
  if (!isUtcIsoTimestamp(value)) {
    throw new TypeError(
      `${field} must be a UTC ISO-8601 timestamp, for example 2026-11-06T15:30:00.000Z`,
    );
  }
}
