import { mergeTables, toCsv } from '../src/export/table';
import { refreshStatus } from '../src/model/workspace';

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
