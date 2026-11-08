import { addReferenceLines, referenceLegend, referenceNumber, referenceSummary, referenceWindow } from '../src/chart/reference';

const table = {
    fields: [{ name: '_time' }, { name: 'Avg' }],
    columns: [
        ['t1', 't2', 't3'],
        ['1', '3', '5'],
    ],
};

test('draws a constant as the same value on every time', () => {
    expect(
        addReferenceLines(table, [{ kind: 'constant', value: '25', label: 'mark', includeValue: true }])
    ).toEqual({
        fields: [{ name: '_time' }, { name: 'Avg' }, { name: 'mark: 25' }],
        columns: [
            ['t1', 't2', 't3'],
            ['1', '3', '5'],
            ['25', '25', '25'],
        ],
    });
});

test('averages the points already on the chart', () => {
    expect(referenceNumber(table, { kind: 'aggregation', value: 'Avg', label: '', includeValue: true })).toBe(3);
    expect(referenceLegend({ kind: 'aggregation', value: 'Avg', label: 'Avg', includeValue: true }, 3)).toBe('Avg: 3');
});

test('uses a supplied window value and ignores text that is not a relative time', () => {
    expect(referenceWindow('-7d', 'now')).toEqual({ earliest: '-7d', latest: 'now' });
    expect(referenceWindow('-3d', '-1d')).toEqual({ earliest: '-3d', latest: '-1d' });
    expect(referenceWindow('-1d', '-7d')).toBeNull();
    expect(referenceWindow('-7d | delete', 'now')).toBeNull();
    expect(
        addReferenceLines(table, [{ kind: 'aggregation', value: 'Avg', label: 'Week', includeValue: true, earliest: '-7d', latest: 'now' }], [9])
            .fields.map((field) => field.name)
    ).toEqual(['_time', 'Avg', 'Week: 9']);
    expect(referenceSummary({ kind: 'aggregation', value: 'Avg', label: 'Avg', includeValue: true, earliest: '-7d', latest: 'now' })).toBe(
        'Avg (-7d to now)'
    );
});

test('rejects a rate function as a horizontal reference line', () => {
    expect(referenceNumber(table, { kind: 'aggregation', value: 'Rate', label: '', includeValue: false })).toBeNull();
});
