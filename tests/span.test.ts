import { searchWindow, spanForDuration } from '../src/spl/span';

test('uses 10s for one hour so the chart stays under 1000 points', () => {
    expect(spanForDuration(3600)).toBe('10s');
});

test('keeps a one second span for a short range', () => {
    expect(spanForDuration(600)).toBe('1s');
});

test('shifts the search window back without changing its length', () => {
    expect(searchWindow('-60m', '60m')).toEqual({ earliest: '-7200s', latest: '-3600s' });
});

test('uses 30 minutes for a week so the chart stays under 1000 points', () => {
    expect(spanForDuration(7 * 86400)).toBe('30m');
});
