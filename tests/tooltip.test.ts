import { clampDecimals, formatTooltipValue } from '../src/chart/tooltip';
import { defaultSettings } from '../src/chart/settings';

test('tooltip values get thousands separators and drop trailing zeros', () => {
    expect(formatTooltipValue(214200, 4)).toBe('214,200');
    expect(formatTooltipValue(1.5, 4)).toBe('1.5');
    expect(formatTooltipValue(1.23456789, 4)).toBe('1.2346');
});

test('the decimal places setting limits the fraction digits', () => {
    expect(formatTooltipValue(1.23456789, 2)).toBe('1.23');
    expect(formatTooltipValue(1.5, 0)).toBe('2');
    expect(formatTooltipValue(1234.5, 0)).toBe('1,235');
});

test('decimal places stay within zero to four, and default to four', () => {
    expect(clampDecimals(undefined)).toBe(4);
    expect(clampDecimals(9)).toBe(4);
    expect(clampDecimals(-1)).toBe(0);
    expect(clampDecimals(2.5)).toBe(4);
    expect(defaultSettings().decimals).toBe(4);
});

test('a value that is not a number shows nothing', () => {
    expect(formatTooltipValue(Number.NaN, 2)).toBe('');
});
