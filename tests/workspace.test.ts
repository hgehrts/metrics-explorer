import { mergeTables, toCsv } from '../src/export/table';
import {
    createSeries,
    globalFiltersFor,
    hasSplitValues,
    INHERIT_SPLIT,
    refreshStatus,
    resolveSplit,
    seriesLegend,
} from '../src/model/workspace';

test('a split applies only when the rows carry that dimension', () => {
    expect(hasSplitValues([{ extracted_host: 'lab-a' }], 'extracted_host')).toBe(true);
    expect(hasSplitValues([{ value: 1 }], 'extracted_host')).toBe(false);
    expect(hasSplitValues([{ extracted_host: '' }], 'extracted_host')).toBe(false);
    expect(hasSplitValues([{ extracted_host: 'lab-a' }], '')).toBe(false);
});

test('a new series inherits the global split, and a chosen split overrides it', () => {
    const series = createSeries('lab.net.bytes_total');
    expect(series.splitBy).toBe(INHERIT_SPLIT);
    expect(resolveSplit(series, 'host')).toBe('host');
    expect(resolveSplit(series, '')).toBe('');
    expect(resolveSplit({ splitBy: 'c' }, 'host')).toBe('c');
    expect(resolveSplit({ splitBy: '' }, 'host')).toBe('');
});

test('counts down from ten seconds while auto-refresh is on', () => {
    expect(refreshStatus(1_000, 0, true)).toBe('');
    expect(refreshStatus(12_500, 10_000, true)).toBe('8s to refresh');
});

test('shows the age after a manual refresh', () => {
    expect(refreshStatus(45_000, 10_000, false)).toBe('35s ago');
    expect(refreshStatus(130_000, 10_000, false)).toBe('2m ago');
});

test('writes one csv row per time and keeps commas inside quotes', () => {
    expect(
        toCsv({
            fields: [{ name: '_time' }, { name: 'lab, a' }],
            columns: [['t1'], ['12']],
        })
    ).toBe('_time,"lab, a"\nt1,12');
});

test('aligns several series on the same time column', () => {
    expect(
        mergeTables([
            { fields: [{ name: '_time' }, { name: 'Avg' }], columns: [['t1'], ['1']] },
            { fields: [{ name: '_time' }, { name: 'Avg' }], columns: [['t1', 't2'], ['2', '3']] },
        ])
    ).toEqual({
        fields: [{ name: '_time' }, { name: '1 Avg' }, { name: '2 Avg' }],
        columns: [
            ['t1', 't2'],
            ['1', ''],
            ['2', '3'],
        ],
    });
});

test('keeps distinct series names and shows a time shift in the legend', () => {
    expect(
        mergeTables([
            { fields: [{ name: '_time' }, { name: 'Avg (-30m)' }], columns: [['t1'], ['1']] },
            { fields: [{ name: '_time' }, { name: 'Avg' }], columns: [['t1'], ['2']] },
        ]).fields.map((field) => field.name)
    ).toEqual(['_time', 'Avg (-30m)', 'Avg']);
    expect(seriesLegend({ metric: 'cpu.user', aggregation: 'Max', splitBy: '', timeShift: '30m' })).toBe('Max (-30m)');
    expect(
        seriesLegend({ metric: 'cpu.user', aggregation: 'Avg', splitBy: '', timeShift: '' }, [
            { metric: 'cpu.user' },
            { metric: 'cpu.idle' },
        ])
    ).toBe('cpu.user Avg');
});

test('a chart that does not follow the global split draws inherited series unsplit', () => {
    const inherited = { splitBy: '*global*' };
    expect(resolveSplit(inherited, 'host', false)).toBe('');
    expect(resolveSplit(inherited, 'host', true)).toBe('host');
    expect(resolveSplit({ splitBy: 'c' }, 'host', false)).toBe('c');
});

test('global filters skip a metric that lacks the dimension', () => {
    const filters = [
        { dimension: 'extracted_host', mode: 'include' as const, values: ['lab-a'] },
        { dimension: 'host', mode: 'include' as const, values: ['0a5dac8e81ff'] },
    ];
    const dims = { 'lab.net.bytes_total': ['extracted_host'] };
    expect(globalFiltersFor({ metric: 'lab.net.bytes_total' }, filters, dims)).toEqual([filters[0]]);
    expect(globalFiltersFor({ metric: 'lab.unknown' }, filters, dims)).toEqual(filters);
    expect(globalFiltersFor({ metric: 'lab.net.bytes_total', source: 'event' }, filters, dims)).toEqual([]);
});
