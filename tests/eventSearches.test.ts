import { eventSearchNameOk, eventSearchesFrom, savedSearchSpl, searchesByApp } from '../src/model/eventSearches';
import { buildSeriesSearch } from '../src/spl/seriesSearch';
import { buildTrellisValueSearch } from '../src/spl/buildMstats';
import { aggregationMenu, METRIC_FUNCTIONS } from '../src/spl/functions';
import { createSeries } from '../src/model/workspace';

test('event searches keep complete KV rows and sort them by name', () => {
    expect(
        eventSearchesFrom([
            { _key: 'b', name: ' Bytes ', spl: ' | timechart sum(bytes) ' },
            { name: 'missing key', spl: 'timechart count' },
            { _key: 'a', name: 'Errors', spl: 'timechart count' },
        ])
    ).toEqual([
        { key: 'b', name: 'Bytes', spl: '| timechart sum(bytes)' },
        { key: 'a', name: 'Errors', spl: 'timechart count' },
    ]);
    expect(eventSearchNameOk('')).toBe(false);
    expect(eventSearchNameOk('a\nb')).toBe(false);
    expect(eventSearchNameOk('Errors')).toBe(true);
});

test('saved searches from other apps are grouped, and this app is left out', () => {
    expect(
        searchesByApp(
            {
                entry: [
                    { name: 'MX Base - cpu', acl: { app: 'search' } },
                    { name: 'Disk', acl: { app: 'search' } },
                    { name: 'Own', acl: { app: 'metric_explorer_ng' } },
                    { name: 'Web', acl: { app: 'search' } },
                ],
            },
            'metric_explorer_ng'
        )
    ).toEqual([{ app: 'search', searches: ['Disk', 'Web'] }]);
    expect(savedSearchSpl('Disk usage')).toBe('| savedsearch "Disk usage"');
});

test('a free search is run in the chart window, and an empty one is refused', () => {
    const series = createSeries('Errors', [], 'search');
    series.field = 'timechart count';
    expect(buildSeriesSearch(series, 'auto', '-24h', 'now', [], []).search).toBe('| timechart count');
    series.field = '| timechart sum(bytes)';
    expect(buildSeriesSearch(series, 'auto', '-1h', 'now', [], []).search).toBe('| timechart sum(bytes)');
    series.field = '  ';
    expect(() => buildSeriesSearch(series, 'auto', '-1h', 'now', [], [])).toThrow('Search is empty.');
});

test('trellis values come from every metric on the chart', () => {
    expect(buildTrellisValueSearch(['cpu', 'mem'], 'region', ['_metrics'])).toBe(
        '| mcatalog values(metric_name) WHERE (metric_name="cpu" OR metric_name="mem") AND index="_metrics" AND NOT metric_name="*_mrollup_*" BY "region" | fields "region"'
    );
});

test('the aggregation menu lists every metric function once, in a group', () => {
    const menu = aggregationMenu('metric', false);
    const names = menu.flatMap((group) => group.items.map((item) => item.name));
    expect(names.sort()).toEqual(METRIC_FUNCTIONS.map((item) => item.name).sort());
    expect(new Set(names).size).toBe(names.length);
    expect(menu.map((group) => group.label)).toEqual(['Basic', 'Percentiles', 'Rate', 'Time']);
    expect(aggregationMenu('metric', true).some((group) => group.group === 'rate')).toBe(false);
    expect(aggregationMenu('event', false).some((group) => group.label === 'Events')).toBe(true);
});
