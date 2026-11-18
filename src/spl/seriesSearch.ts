import { Series, seriesLegend } from '../model/workspace';
import { boundSeconds } from './timeRange';
import { buildBaseChartSearch, buildCalcMstats, buildMstats, buildTstats, quoteSpl } from './buildMstats';
import { resolveForSource } from './functions';
import { searchWindow } from './span';
import { formulaMetrics, parseTitleLine } from './titleFormula';

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

const TIME_TOKEN = /^(now|-\d{1,11}(?:s|m|h|d|w|mon|y)|\d{1,11})$/;

/** Puts a series window on generating searches that already have a WHERE/where clause. */
export function injectTimeBounds(search: string, earliest: string, latest: string): string {
    if (!TIME_TOKEN.test(earliest) || !TIME_TOKEN.test(latest)) {
        throw new Error('Time range is not allowed.');
    }
    const clause = `earliest=${earliest} latest=${latest}`;
    if (/\bWHERE\b/.test(search)) {
        return search.replace(/\bWHERE\b/, `WHERE ${clause}`);
    }
    if (/\bwhere\b/.test(search)) {
        return search.replace(/\bwhere\b/, `where ${clause}`);
    }
    return search;
}

function unionWindow(windows: SeriesQuery[], nowSeconds = Date.now() / 1000): { earliest: string; latest: string } {
    if (windows.length === 0) {
        return { earliest: '-60m', latest: 'now' };
    }
    let earliest = windows[0].earliest;
    let latest = windows[0].latest;
    for (const window of windows.slice(1)) {
        if (boundSeconds(window.earliest, nowSeconds) < boundSeconds(earliest, nowSeconds)) {
            earliest = window.earliest;
        }
        if (boundSeconds(window.latest, nowSeconds) > boundSeconds(latest, nowSeconds)) {
            latest = window.latest;
        }
    }
    return { earliest, latest };
}

function suffixColumns(search: string, legend: string, categorical: boolean): string {
    const suffix = legend.replace(/"/g, '').slice(0, 120) || 'series';
    const renamed = `${search} | fields - _span* | rename * AS ${quoteSpl(`* - ${suffix}`)}`;
    return categorical ? renamed : `${renamed} | rename ${quoteSpl(`_time - ${suffix}`)} AS _time`;
}

function asSubsearch(search: string): string {
    const body = search.trim().startsWith('|') ? search.trim() : `| ${search.trim()}`;
    return `[ ${body} ]`;
}

function uniqueLegends(series: Series[]): string[] {
    const raw = series.map((item) => seriesLegend(item, series));
    const counts = new Map<string, number>();
    raw.forEach((legend) => counts.set(legend, (counts.get(legend) ?? 0) + 1));
    return raw.map((legend, index) => ((counts.get(legend) ?? 0) > 1 ? `${legend} (${index + 1})` : legend));
}

function calcEval(item: Series): { metrics: string[]; evalExpr: string } {
    const parts = parseTitleLine(item.field || item.metric);
    const part = parts.find((entry) => entry.kind === 'calc') ?? parts[0];
    if (!part || part.kind !== 'calc' || !part.evalExpr) {
        const metrics = formulaMetrics(item.field || item.metric);
        throw new Error(metrics.length === 0 ? 'A formula needs a metric.' : 'Formula is not allowed.');
    }
    return { metrics: part.metrics, evalExpr: part.evalExpr };
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
        item.source === 'calc'
            ? (() => {
                  const calc = calcEval(item);
                  return buildCalcMstats({
                      aggregation: item.aggregation,
                      metrics: calc.metrics,
                      evalExpr: calc.evalExpr,
                      span,
                      splitBy: item.splitBy || undefined,
                      splitDirection: item.splitDirection,
                      splitLimit: item.splitLimit,
                      timeShift: item.timeShift || undefined,
                      filters: item.filters,
                      indexes: metricIndexes,
                      categorical,
                      trellisBy: trellisBy || undefined,
                  });
              })()
            : (item.source ?? 'metric') === 'metric'
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

/**
 * The search a whole chart exports. One series stays byte-identical to `buildSeriesSearch`.
 * Several series are renamed, appended, and joined so every metric reaches Search and dashboards.
 */
export function buildChartSearch(
    series: Series[],
    span: string,
    earliest: string,
    latest: string,
    indexes: string[],
    metricIndexes?: string[],
    categorical = false,
    trellisBy = ''
): SeriesQuery {
    const plottable = series.filter((item) => resolveForSource(item.source, item.aggregation)?.chart === 'line');
    const items = plottable.length > 0 ? plottable : series;
    if (items.length === 0) {
        throw new Error('Nothing to save.');
    }
    if (items.length === 1) {
        return buildSeriesSearch(items[0], span, earliest, latest, indexes, metricIndexes, categorical, trellisBy);
    }
    const queries = items.map((item) =>
        buildSeriesSearch(item, span, earliest, latest, indexes, metricIndexes, categorical, trellisBy)
    );
    const combined = unionWindow(queries);
    const legends = uniqueLegends(items);
    const prepared = queries.map((query, index) => {
        const bounded =
            query.earliest === combined.earliest && query.latest === combined.latest
                ? query.search
                : injectTimeBounds(query.search, query.earliest, query.latest);
        return suffixColumns(bounded, legends[index], categorical);
    });
    const splitField = items.find((item) => item.splitBy)?.splitBy ?? '';
    let search = prepared[0];
    for (const part of prepared.slice(1)) {
        search += categorical && !splitField ? ` | appendcols ${asSubsearch(part)}` : ` | append ${asSubsearch(part)}`;
    }
    if (!categorical) {
        search += ' | stats first(*) AS * BY _time';
    } else if (splitField) {
        search += ` | stats first(*) AS * BY ${splitField}`;
    }
    return { search, earliest: combined.earliest, latest: combined.latest };
}
