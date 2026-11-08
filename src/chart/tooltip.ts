/**
 * Tooltip values for a chart point. Thousands get separators, and the decimal places are capped at four.
 * Trailing zeros are dropped, so 214200 shows as 214,200 and 1.5 as 1.5.
 */
export const MAX_DECIMALS = 4;

export function clampDecimals(value: number | undefined): number {
    if (value === undefined || !Number.isInteger(value)) {
        return MAX_DECIMALS;
    }
    return Math.min(MAX_DECIMALS, Math.max(0, value));
}

export function formatTooltipValue(value: number, decimals: number | undefined, locale = 'en-US'): string {
    if (!Number.isFinite(value)) {
        return '';
    }
    return value.toLocaleString(locale, { maximumFractionDigits: clampDecimals(decimals) });
}
