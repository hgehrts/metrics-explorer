import { parseTimeShift, shiftSeconds } from './timeShift';
import { boundSeconds, isRelativeBound } from './timeRange';

const SPANS: { seconds: number; spl: string }[] = [
    { seconds: 1, spl: '1s' },
    { seconds: 10, spl: '10s' },
    { seconds: 30, spl: '30s' },
    { seconds: 60, spl: '1m' },
    { seconds: 300, spl: '5m' },
    { seconds: 600, spl: '10m' },
    { seconds: 1800, spl: '30m' },
    { seconds: 3600, spl: '1h' },
    { seconds: 14400, spl: '4h' },
    { seconds: 86400, spl: '1d' },
    { seconds: 604800, spl: '7d' },
];

export function spanForDuration(durationSeconds: number, maxPoints = 1000): string {
    const duration = Math.max(durationSeconds, 1);
    for (const span of SPANS) {
        if (duration / span.seconds <= maxPoints) {
            return span.spl;
        }
    }
    return SPANS[SPANS.length - 1].spl;
}

/** Span for the range between two bounds. Presets and custom ranges use the same rule. */
export function spanForRange(earliest: string, latest = 'now', nowSeconds = Date.now() / 1000): string {
    const duration = boundSeconds(latest, nowSeconds) - boundSeconds(earliest, nowSeconds);
    return spanForDuration(duration > 0 ? duration : 3600);
}

/**
 * The window one series searches. A time shift moves both bounds back. Relative ranges keep relative tokens;
 * custom ranges with a shift use epoch seconds. Months and years are calendar units and need a relative range.
 */
export function searchWindow(
    range: string,
    shift = '',
    latest = 'now',
    nowSeconds = Date.now() / 1000
): { earliest: string; latest: string } {
    if (!shift) {
        return { earliest: range, latest };
    }
    const parsed = parseTimeShift(shift);
    if (!parsed) {
        throw new Error('Time shift is not allowed.');
    }
    const relativeRange = isRelativeBound(range) && latest === 'now';
    if (parsed.unit === 'mon' || parsed.unit === 'y') {
        if (!relativeRange) {
            throw new Error('Months and years need a relative time range.');
        }
        return { earliest: `${range}-${parsed.token}`, latest: `-${parsed.token}` };
    }
    const seconds = shiftSeconds(shift);
    if (!seconds) {
        throw new Error('Time shift is not allowed.');
    }
    if (relativeRange) {
        const duration = boundSeconds('now', nowSeconds) - boundSeconds(range, nowSeconds);
        return { earliest: `-${duration + seconds}s`, latest: `-${seconds}s` };
    }
    const shiftedLatest = latest === 'now' ? `-${seconds}s` : String(Math.floor(boundSeconds(latest, nowSeconds) - seconds));
    return { earliest: String(Math.floor(boundSeconds(range, nowSeconds) - seconds)), latest: shiftedLatest };
}
