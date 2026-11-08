import { formatHeatTick, heatColor, heatRange, heatmapTable } from '../src/chart/heatmap';

test('colors the minimum red, the middle yellow, and the maximum green', () => {
    expect(heatColor(0, 0, 100)).toBe('rgb(220, 78, 65)');
    expect(heatColor(50, 0, 100)).toBe('rgb(248, 190, 52)');
    expect(heatColor(100, 0, 100)).toBe('rgb(83, 160, 81)');
});

test('reads the range from the value columns and skips blanks', () => {
    expect(heatRange([['t'], ['', '2'], ['10']])).toEqual({ min: 2, max: 10 });
    expect(heatRange([['t'], ['']])).toEqual({ min: 0, max: 0 });
});

test('names heatmap rows after the metric unless the series is split', () => {
    const named = heatmapTable(
        [
            { metric: 'lab.cpu.user', splitBy: '' },
            { metric: 'lab.net.bytes_total', splitBy: 'host' },
        ],
        [
            { fields: [{ name: '_time' }, { name: 'Avg' }], columns: [['t'], ['1']] },
            { fields: [{ name: '_time' }, { name: 'a' }, { name: 'b' }], columns: [['t'], ['2'], ['3']] },
        ],
        [0, 1],
        {
            fields: [{ name: '_time' }, { name: '1 Avg' }, { name: 'a' }, { name: 'b' }],
            columns: [['t'], ['1'], ['2'], ['3']],
        }
    );
    expect(named.fields.map((field) => field.name)).toEqual(['_time', 'lab.cpu.user', 'a', 'b']);
});

test('abbreviates the color axis the way the original heatmap does', () => {
    expect(formatHeatTick(0)).toBe('0');
    expect(formatHeatTick(500_000_000)).toBe('500.0m');
    expect(formatHeatTick(1_500_000_000)).toBe('1.5b');
});
