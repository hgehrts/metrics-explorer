import { buildBaseChartSearch, buildBaseSearchSpl, buildFieldSearch, buildSourcetypeSearch, buildTstats, readableFields, relatedEventsSearch } from '../src/spl/buildMstats';
import { needsField, resolveEventFunction } from '../src/spl/functions';
import { createSeries, INHERIT_SPLIT, resolveSeries, resolveSplit } from '../src/model/workspace';

test('the sourcetype list skips nothing it was given and falls back to the internal index', () => {
    expect(buildSourcetypeSearch(['_internal', 'main'])).toBe(
        '| tstats count where (index="_internal" OR index="main") by sourcetype'
    );
    expect(buildSourcetypeSearch([])).toBe(
        '| tstats count where (index="_internal" OR index="_audit" OR index="main") by sourcetype'
    );
    expect(buildSourcetypeSearch(['bad name'])).toBe(
        '| tstats count where (index="_internal" OR index="_audit" OR index="main") by sourcetype'
    );
});

test('an event series counts a sourcetype over time', () => {
    expect(
        buildTstats({ source: 'event', name: 'splunkd', aggregation: 'Count', span: '30m', indexes: ['_internal'] })
    ).toBe('| tstats count AS value where (index="_internal") AND sourcetype="splunkd" by _time span=30m');
});

test('a data model series names the model, and a field aggregation quotes the field', () => {
    expect(
        buildTstats({ source: 'dataset', name: 'Internal_Server', aggregation: 'Avg', span: '1h', field: 'bytes' })
    ).toBe('| tstats avg("bytes") AS value from datamodel=Internal_Server by _time span=1h');
});

test('event functions refuse the metric-only rates and accept exactperc and distinct count', () => {
    expect(resolveEventFunction('Rate (Avg)')).toBeNull();
    expect(resolveEventFunction('dc')?.name).toBe('dc');
    expect(resolveEventFunction('exactperc99')?.label).toBe('exact p99');
    expect(needsField('count')).toBe(false);
    expect(needsField('avg')).toBe(true);
});

test('a function that needs a field is refused without one', () => {
    expect(() => buildTstats({ source: 'event', name: 'splunkd', aggregation: 'Avg', span: '30m' })).toThrow(
        'Field is not allowed.'
    );
});

test('related events keep the sourcetype and the include filters', () => {
    expect(
        relatedEventsSearch({
            source: 'event',
            name: 'splunkd',
            filters: [{ dimension: 'host', mode: 'include', values: ['lab-a'] }],
        })
    ).toBe('(index="_internal" OR index="_audit" OR index="main") sourcetype="splunkd" host="lab-a"');
    expect(relatedEventsSearch({ source: 'metric', name: 'lab.cpu.user' })).toBe('index=*');
});

test('a sourcetype field list samples events and drops internal fields', () => {
    expect(buildFieldSearch('event', 'splunkd', ['_internal'])).toBe(
        'search (index="_internal") sourcetype="splunkd" | head 200 | fieldsummary maxvals=0 | fields field'
    );
    expect(readableFields(['_raw', 'bytes', 'component', 'punct', 'bytes'])).toEqual(['bytes', 'component']);
});

test('a base search keeps the metric and filters and the chart adds the aggregation', () => {
    expect(
        buildBaseSearchSpl({
            source: 'metric',
            name: 'lab.cpu.user',
            filters: [{ dimension: 'extracted_host', mode: 'include', values: ['lab-a'] }],
        })
    ).toBe('| mpreview index=* filter="metric_name=lab.cpu.user AND extracted_host=\\"lab-a\\""');
    expect(
        buildBaseChartSearch({
            name: 'cpu',
            mode: 'live',
            owner: 'admin',
            aggregation: 'Avg',
            span: '30m',
            field: '_value',
        })
    ).toBe('| savedsearch "MX Base - cpu" | timechart span=30m avg("_value") AS value');
});

test('an event series starts with Count and does not inherit a metric split', () => {
    const event = createSeries('splunkd', [], 'event');
    expect(event).toMatchObject({ source: 'event', aggregation: 'Count', field: '', splitBy: '' });
    expect(createSeries('internal_server', [], 'dataset').splitBy).toBe('');
    const inherited = { ...event, splitBy: INHERIT_SPLIT };
    expect(resolveSplit(inherited, 'server')).toBe('');
    expect(resolveSeries([inherited], 'server', true)[0].splitBy).toBe('');
});
