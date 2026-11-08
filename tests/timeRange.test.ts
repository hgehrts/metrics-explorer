import { boundForInput, boundSeconds, customRange, parseBound } from '../src/spl/timeRange';

const NOW = 1_800_000_000;

test('relative bounds and now are kept as tokens', () => {
    expect(parseBound('-4h')).toEqual({ token: '-4h' });
    expect(parseBound(' -15m ')).toEqual({ token: '-15m' });
    expect(parseBound('now')).toEqual({ token: 'now' });
});

test('a typed date becomes epoch seconds in this time zone', () => {
    const result = parseBound('2026-11-06 14:30');
    expect(result).toEqual({ token: String(Math.floor(new Date(2026, 10, 6, 14, 30, 0).getTime() / 1000)) });
});

test('unknown dates and free text are rejected, not sent to SPL', () => {
    expect(parseBound('2026-02-30')).toEqual({ error: 'That date does not exist.' });
    expect(parseBound('-4h | delete')).toEqual({
        error: 'Use a time like -4h, -7d, now, or a date like 2026-11-06 14:00.',
    });
    expect(parseBound('yesterday')).toHaveProperty('error');
});

test('bounds convert to epoch seconds against a fixed now', () => {
    expect(boundSeconds('now', NOW)).toBe(NOW);
    expect(boundSeconds('-1h', NOW)).toBe(NOW - 3600);
    expect(boundSeconds('1700000000', NOW)).toBe(1700000000);
});

test('a custom range needs a start before its end', () => {
    expect(customRange('-1d', 'now', NOW)).toEqual({ earliest: '-1d', latest: 'now' });
    expect(customRange('-1h', '-2h', NOW)).toEqual({ error: 'The start must be before the end.' });
    expect(customRange('now', 'now', NOW)).toEqual({ error: 'Start: use a time before now.' });
    expect(customRange('bad', 'now', NOW)).toHaveProperty('error');
    expect(customRange('-1d', 'bad', NOW)).toHaveProperty('error');
});

test('an absolute start and end are both epoch seconds', () => {
    const start = parseBound('2026-11-06 10:00');
    const end = parseBound('2026-11-06 12:00');
    if (!('token' in start) || !('token' in end)) {
        throw new Error('dates should parse');
    }
    expect(customRange('2026-11-06 10:00', '2026-11-06 12:00', NOW)).toEqual({
        earliest: start.token,
        latest: end.token,
    });
});

test('epoch bounds are shown as local dates in the input, tokens unchanged', () => {
    const token = String(Math.floor(new Date(2026, 10, 6, 14, 30).getTime() / 1000));
    expect(boundForInput(token)).toBe('2026-11-06 14:30');
    expect(boundForInput('-4h')).toBe('-4h');
    expect(boundForInput('now')).toBe('now');
});
