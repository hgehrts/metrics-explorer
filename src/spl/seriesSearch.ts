import { Series } from '../model/workspace';
import { buildBaseChartSearch, buildMstats, buildTstats } from './buildMstats';
import { resolveForSource } from './functions';
import { searchWindow } from './span';

export type SeriesQuery = { search: string; earliest: string; latest: string };

/** Commands a saved event search may start with. Anything else is a normal search and must not gain a leading pipe. */
const PIPE_COMMANDS = new Set([
    'bin',
    'chart',
    'datamodel',
    'from',
    'gentimes',
    'inputlookup',
    'loadjob',
    'makeresults',
    'mcatalog',
    'metadata',
    'metasearch',
    'mpreview',
    'mstats',
    'rest',
    'savedsearch',
    'search',
    'stats',
    'timechart',
    'tstats',
    'union',
    'walklex',
]);

/**
 * A free event search. `timechart count` becomes `| timechart count`.
 * `index=_internal | timechart count by host` stays as written, because a leading pipe would make `index=` a command.
 */
export function freeSearchSpl(spl: string): string {
    const trimmed = spl.trim();
    if (!trimmed) {
        throw new Error('Search is empty.');
    }
    if (trimmed.startsWith('|')) {
        return trimmed;
    }
    const head = trimmed.split('|', 1)[0]?.trim() ?? '';
    const command = (head.split(/\s+/)[0] ?? '').toLowerCase();
    if (/^[a-z_][a-z0-9_]*$/.test(command) && PIPE_COMMANDS.has(command)) {
        return `| ${trimmed}`;
    }
    return trimmed;
}

/** The search one series runs, including its time shift. Throws when the series cannot be searched. */
export function buildSeriesSearch(
    item: Series,
    span: string,
    earliest: string,
    latest: string,
    indexes: string[],
    metricIndexes?: string[],
    categorical = false,
    trellisBy = ''
): SeriesQuery {
    if (item.source === 'search') {
        return { search: freeSearchSpl(item.field), earliest, latest };
    }
    const chosen = resolveForSource(item.source, item.aggregation);
    if (!chosen) {
        throw new Error('Unknown aggregation.');
    }
    const search =
        (item.source ?? 'metric') === 'metric'
            ? buildMstats({
                  aggregation: item.aggregation,
                  metric: item.metric,
                  span,
                  splitBy: item.splitBy || undefined,
                  splitDirection: item.splitDirection,
                  splitLimit: item.splitLimit,
                  timeShift: item.timeShift || undefined,
                  filters: item.filters,
                  indexes: metricIndexes,
                  categorical,
                  trellisBy: trellisBy || undefined,
              })
            : item.source === 'base'
              ? buildBaseChartSearch({
                    name: item.metric,
                    mode: item.baseMode === 'cached' ? 'cached' : 'live',
                    owner: item.baseOwner || 'nobody',
                    aggregation: item.aggregation,
                    span,
                    field: item.field,
                    splitBy: item.splitBy || undefined,
                    splitDirection: item.splitDirection,
                    splitLimit: item.splitLimit,
                    categorical,
                })
              : buildTstats({
                    source: item.source === 'dataset' ? 'dataset' : 'event',
                    name: item.metric,
                    aggregation: item.aggregation,
                    span,
                    field: item.field,
                    splitBy: item.splitBy || undefined,
                    splitDirection: item.splitDirection,
                    splitLimit: item.splitLimit,
                    timeShift: item.timeShift || undefined,
                    filters: item.filters,
                    indexes,
                    categorical,
                });
    const bounds = searchWindow(earliest, item.timeShift, latest);
    return { search, earliest: bounds.earliest, latest: bounds.latest };
}
