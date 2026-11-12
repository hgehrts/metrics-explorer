import { boundSeconds } from '../spl/timeRange';

/**
 * The chart window in epoch milliseconds.
 * Splunk's column, line, and area charts scale the time axis to the data unless xAxisMin and xAxisMax are set,
 * and those options are epoch milliseconds, the same unit moment uses for `_time`.
 */
export function chartTimeBounds(
    earliest: string,
    latest: string,
    nowSeconds = Date.now() / 1000
): { xAxisMin: number; xAxisMax: number } | null {
    const start = boundSeconds(earliest, nowSeconds);
    const end = boundSeconds(latest, nowSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
    }
    return { xAxisMin: Math.round(start * 1000), xAxisMax: Math.round(end * 1000) };
}
