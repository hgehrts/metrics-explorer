import { Series } from '../model/workspace';
import { buildBaseChartSearch, buildMstats, buildTstats } from './buildMstats';
import { resolveForSource } from './functions';
import { searchWindow } from './span';

export type SeriesQuery = { search: string; earliest: string; latest: string };

/** The search one series runs, including its time shift. Throws when the series cannot be searched. */
export function buildSeriesSearch(
    item: Series,
    span: string,
    earliest: string,
    latest: string,
    indexes: string[],
    metricIndexes?: string[],
    categorical = false
): SeriesQuery {
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
