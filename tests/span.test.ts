import { estimatedPoints, searchWindow, spanForDuration, spanForRange } from '../src/spl/span';

test('uses 10s for one hour so the chart stays under 1000 points', () => {
    expect(spanForDuration(3600)).toBe('10s');
});

test('keeps a one second span for a short range', () => {
    expect(spanForDuration(600)).toBe('1s');
});

test('shifts the search window back without changing its length', () => {
    expect(searchWindow('-60m', '60m')).toEqual({ earliest: '-7200s', latest: '-3600s' });
});

test('keeps months and years as calendar units in the search window', () => {
    expect(searchWindow('-7d', '2mon')).toEqual({ earliest: '-7d-2mon', latest: '-2mon' });
    expect(searchWindow('-24h', '1y')).toEqual({ earliest: '-24h-1y', latest: '-1y' });
});

test('rejects a time shift that is not on the allowlist', () => {
    expect(() => searchWindow('-60m', '2mon | delete')).toThrow('Time shift is not allowed.');
});

test('uses 30 minutes for a week so the chart stays under 1000 points', () => {
    expect(spanForDuration(7 * 86400)).toBe('30m');
});

test('a custom range with a shift moves both epoch bounds back', () => {
    const now = 1_800_000_000;
    expect(searchWindow('1799990000', '1h', '1799996400', now)).toEqual({
        earliest: String(1799990000 - 3600),
        latest: String(1799996400 - 3600),
    });
});

test('a custom range that ends now shifts the end with a relative token', () => {
    const now = 1_800_000_000;
    expect(searchWindow('1799990000', '1h', 'now', now)).toEqual({
        earliest: String(1799990000 - 3600),
        latest: '-3600s',
    });
});

test('months need a relative range, not an absolute one', () => {
    expect(() => searchWindow('1799990000', '1mon', '1799996400', 1_800_000_000)).toThrow(
        'Months and years need a relative time range.'
    );
});

test('a manual span that is too fine is counted before the search starts', () => {
    const now = 1_800_000_000;
    expect(estimatedPoints('-7d', 'now', '10s', now)).toBeGreaterThan(1000);
    expect(estimatedPoints('-60m', 'now', '10s', now)).toBeLessThanOrEqual(1000);
    expect(estimatedPoints('-7d', 'now', '30m', now)).toBeLessThanOrEqual(1000);
});

test('the span follows the length of a custom range', () => {
    const now = 1_800_000_000;
    expect(spanForRange('-24h', 'now', now)).toBe('5m');
    expect(spanForRange(String(now - 7 * 86400), String(now - 86400), now)).toBe('10m');
});
