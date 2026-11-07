import { formatStatColumns, formatStatValue, formatTimeCell } from '../src/chart/stats';
import { resolveMetricFunction } from '../src/spl/functions';

const EPOCH = 1_760_000_000;

test('accepts the aggregation label shown in the list', () => {
    expect(resolveMetricFunction('Latest time')?.name).toBe('latest_time');
    expect(resolveMetricFunction('Latest time')?.chart).toBe('table');
    expect(resolveMetricFunction('Rate (Avg)')?.name).toBe('rate_avg');
});

test('formats time aggregations as a local date and leaves other values unchanged', () => {
    const expected = new Date(EPOCH * 1000).toLocaleString();
    expect(formatStatValue('latest_time', String(EPOCH))).toBe(expected);
    expect(formatStatValue('Latest time', `${EPOCH}.000000`)).toBe(expected);
    expect(formatStatValue('earliest_time', String(EPOCH))).toBe(expected);
    expect(formatStatValue('avg', String(EPOCH))).toBe(String(EPOCH));
    expect(formatStatValue('latest_time', '')).toBe('');
    expect(formatStatValue('latest_time', 'not-a-time')).toBe('not-a-time');
});

test('formats a time cell from an epoch or an ISO string', () => {
    expect(formatTimeCell(String(EPOCH))).toBe(new Date(EPOCH * 1000).toLocaleString());
    const iso = '2026-11-07T15:00:00.000Z';
    expect(formatTimeCell(iso)).toBe(new Date(iso).toLocaleString());
    expect(formatTimeCell('')).toBe('');
});

test('formats only the value columns of a statistics table', () => {
    const formatted = formatStatColumns(
        {
            fields: [{ name: '_time' }, { name: 'Latest time' }],
            columns: [[String(EPOCH)], [String(EPOCH)]],
        },
        'latest_time'
    );
    expect(formatted.columns[0]).toEqual([String(EPOCH)]);
    expect(formatted.columns[1]).toEqual([new Date(EPOCH * 1000).toLocaleString()]);
});
