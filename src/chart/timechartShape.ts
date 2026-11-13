import { SearchRow } from '../search/runSearch';

function isNumber(value: unknown): boolean {
    if (value === '' || value === null || value === undefined) {
        return false;
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric);
}

/**
 * A free SPL search can be drawn when it has time and at least one number.
 * An empty result is a valid chart with nothing in the window.
 */
export function timechartProblem(rows: SearchRow[]): string {
    if (rows.length === 0) {
        return '';
    }
    const hasTime = rows.some((row) => row._time !== undefined && row._time !== null && String(row._time) !== '');
    const hasNumber = rows.some((row) =>
        Object.entries(row).some(([key, value]) => key !== '_time' && !key.startsWith('_') && isNumber(value))
    );
    if (!hasTime || !hasNumber) {
        return 'This search does not return a time chart.';
    }
    return '';
}
