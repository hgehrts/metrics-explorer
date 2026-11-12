import { chartTimeBounds } from '../src/chart/timeAxis';

test('the time axis covers the selected window in milliseconds', () => {
    const now = 1_700_000_000;
    expect(chartTimeBounds('-30d', 'now', now)).toEqual({
        xAxisMin: (now - 30 * 86400) * 1000,
        xAxisMax: now * 1000,
    });
    expect(chartTimeBounds('100', '100', now)).toBeNull();
    expect(chartTimeBounds('200', '100', now)).toBeNull();
});
