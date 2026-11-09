/**
 * Time bounds for the chart range. A bound is a Splunk time token: `-4h`, `-7d`, `now`, or epoch seconds.
 * Typed dates are read in the time zone of this browser and sent as epoch seconds, so no text reaches SPL.
 */

const RELATIVE = /^-(\d{1,4})(s|m|h|d|w|mon|y)$/;
const ABSOLUTE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
/** Months and years are calendar units in Splunk. Here they only size spans and compare bounds, so an average is enough. */
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mon: 2592000, y: 31536000 };

/** Units of the relative custom range, as the original workspace offers them. A quarter is sent as three months. */
export const RELATIVE_UNITS = [
    { id: 's', label: 'Seconds ago', factor: 1, token: 's' },
    { id: 'm', label: 'Minutes ago', factor: 1, token: 'm' },
    { id: 'h', label: 'Hours ago', factor: 1, token: 'h' },
    { id: 'd', label: 'Days ago', factor: 1, token: 'd' },
    { id: 'w', label: 'Weeks ago', factor: 1, token: 'w' },
    { id: 'mon', label: 'Months ago', factor: 1, token: 'mon' },
    { id: 'q', label: 'Quarters ago', factor: 3, token: 'mon' },
    { id: 'y', label: 'Years ago', factor: 1, token: 'y' },
] as const;

export type RelativeUnit = (typeof RELATIVE_UNITS)[number]['id'];

/** The start token for "N units ago", or null when the amount is not a whole number from 1 to 9999. */
export function relativeStart(amount: string, unit: RelativeUnit): string | null {
    const text = amount.trim();
    const chosen = RELATIVE_UNITS.find((item) => item.id === unit);
    if (!chosen || !/^\d{1,4}$/.test(text) || Number(text) < 1) {
        return null;
    }
    const value = Number(text) * chosen.factor;
    return value > 9999 ? null : `-${value}${chosen.token}`;
}

/** Splits a relative start back into amount and unit, for reopening the dialog. */
export function parseRelativeStart(token: string): { amount: string; unit: RelativeUnit } | null {
    const match = RELATIVE.exec(token);
    return match ? { amount: match[1], unit: match[2] as RelativeUnit } : null;
}

export function isRelativeBound(token: string): boolean {
    return RELATIVE.test(token);
}

export type BoundResult = { token: string } | { error: string };

/** Turns a typed bound into a token. Accepts `-4h`, `-7d`, `now`, or a date like `2026-11-06 14:00`. */
export function parseBound(text: string): BoundResult {
    const value = text.trim();
    if (value === 'now' || RELATIVE.test(value)) {
        return { token: value };
    }
    const match = ABSOLUTE.exec(value);
    if (!match) {
        return { error: 'Use a time like -4h, -7d, now, or a date like 2026-11-06 14:00.' };
    }
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const hour = Number(match[4] ?? 0);
    const minute = Number(match[5] ?? 0);
    const second = Number(match[6] ?? 0);
    const date = new Date(year, month - 1, day, hour, minute, second);
    const exists =
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date.getHours() === hour &&
        date.getMinutes() === minute;
    if (!exists) {
        return { error: 'That date does not exist.' };
    }
    return { token: String(Math.floor(date.getTime() / 1000)) };
}

/** The bound as epoch seconds. `now` is passed in, so the result is the same for every search of one render. */
export function boundSeconds(token: string, nowSeconds: number): number {
    if (token === 'now') {
        return nowSeconds;
    }
    const relative = RELATIVE.exec(token);
    if (relative) {
        return nowSeconds - Number(relative[1]) * UNIT_SECONDS[relative[2]];
    }
    return Number(token);
}

/** A custom range from two typed bounds. The start must be a real time before the end. */
export function customRange(
    earliestText: string,
    latestText: string,
    nowSeconds: number
): { earliest: string; latest: string } | { error: string } {
    const earliest = parseBound(earliestText);
    const latest = parseBound(latestText);
    if ('error' in earliest) {
        return { error: `Start: ${earliest.error}` };
    }
    if ('error' in latest) {
        return { error: `End: ${latest.error}` };
    }
    if (earliest.token === 'now') {
        return { error: 'Start: use a time before now.' };
    }
    if (boundSeconds(earliest.token, nowSeconds) >= boundSeconds(latest.token, nowSeconds)) {
        return { error: 'The start must be before the end.' };
    }
    return { earliest: earliest.token, latest: latest.token };
}

/** Text for an input field: epoch seconds become a local date and time, other tokens stay as they are. */
export function boundForInput(token: string): string {
    if (!/^\d{6,11}$/.test(token)) {
        return token;
    }
    const date = new Date(Number(token) * 1000);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
