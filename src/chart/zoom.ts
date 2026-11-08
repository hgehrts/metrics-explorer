/**
 * The time window a range selection on a chart zooms to. The visualization reports the selected start and end,
 * as epoch milliseconds, epoch seconds, or a date text. Anything else is ignored, so no zoom happens.
 */

function toSeconds(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? (value > 1e11 ? value / 1000 : value) : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        if (/^\d+(\.\d+)?$/.test(value.trim())) {
            return toSeconds(Number(value.trim()));
        }
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed / 1000 : null;
    }
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.getTime() / 1000 : null;
    }
    return null;
}

/** Window for a range selection. Returns null for a selection that is empty or shorter than one second. */
export function zoomWindow(payload: Record<string, unknown> | undefined, nowSeconds: number): { earliest: string; latest: string } | null {
    const start = toSeconds(payload?.startXValue);
    const end = toSeconds(payload?.endXValue);
    if (start === null || end === null || end - start < 1) {
        return null;
    }
    const earliest = String(Math.floor(start));
    const latest = end >= nowSeconds ? 'now' : String(Math.ceil(end));
    return { earliest, latest };
}
