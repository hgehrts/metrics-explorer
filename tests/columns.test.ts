import { toLineTable } from '../src/chart/columns';

test('names a single series after the aggregation', () => {
    expect(
        toLineTable([{ _time: 't1', 'avg(lab.cpu.user)': '12' }], 'Avg')
    ).toEqual({
        fields: [{ name: '_time' }, { name: 'Avg' }],
        columns: [['t1'], ['12']],
    });
});

test('pivots a split search into one column per value', () => {
    expect(
        toLineTable(
            [
                { _time: 't1', host: 'lab-a', value: '1' },
                { _time: 't1', host: 'lab-b', value: '2' },
                { _time: 't2', host: 'lab-a', value: '3' },
            ],
            'Avg',
            'host'
        )
    ).toEqual({
        fields: [{ name: '_time' }, { name: 'lab-a' }, { name: 'lab-b' }],
        columns: [
            ['t1', 't2'],
            ['1', '3'],
            ['2', ''],
        ],
    });
});

test('keeps wide chart results as separate series', () => {
    expect(
        toLineTable([{ _time: 't1', 'lab-a': '1', 'lab-b': '2' }], 'Avg')
    ).toEqual({
        fields: [{ name: '_time' }, { name: 'lab-a' }, { name: 'lab-b' }],
        columns: [['t1'], ['1'], ['2']],
    });
});
