import React, { useEffect, useRef, useState } from 'react';
import Area from '@splunk/visualizations/Area';
import Column from '@splunk/visualizations/Column';
import Line from '@splunk/visualizations/Line';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';
import { toLineTable } from '../chart/columns';
import { addReferenceLines, referenceWindow } from '../chart/reference';
import { axisOptions, visualFor } from '../chart/settings';
import { heatmapTable } from '../chart/heatmap';
import { formatStatColumns, formatTimeCell } from '../chart/stats';
import { HeatmapChart } from './HeatmapChart';
import { mergeTables, splunkSearchUrl, toCsv } from '../export/table';
import { chartPng, chartSvg, safeFileName } from '../export/png';
import { ChartModel, hasSplitValues, resolveSeries, seriesLegend } from '../model/workspace';
import { runSearch, SearchRow } from '../search/runSearch';
import { buildMstats, buildReferenceValueSearch } from '../spl/buildMstats';
import { resolveMetricFunction } from '../spl/functions';
import { searchWindow } from '../spl/span';

const Card = styled.section<{ $selected: boolean }>`
    margin: 0;
    padding: 12px 12px 4px;
    border: 1px solid ${variables.neutral200};
    ${(props) =>
        props.$selected &&
        css`
            border-color: ${variables.interactiveColorPrimary};
        `}
    border-radius: 8px;
    background: ${variables.backgroundColorSection};
    min-height: 280px;
`;

const TitleRow = styled.div`
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: flex-start;
`;

const Actions = styled.div`
    display: flex;
    gap: 6px;
    position: relative;
`;

const SmallButton = styled.button`
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
`;

const Menu = styled.div`
    position: absolute;
    right: 0;
    top: 32px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    min-width: 180px;
    padding: 6px;
    border: 1px solid ${variables.neutral200};
    border-radius: 8px;
    background: ${variables.backgroundColorSection};
`;

const Note = styled.p`
    margin: 8px 0;
    color: ${variables.contentColorMuted};
    font-size: 12px;
`;

const Grid = styled.div`
    max-height: 260px;
    overflow: auto;
    margin-top: 8px;
`;

const Stats = styled.table`
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;

    th,
    td {
        padding: 4px 8px;
        border-bottom: 1px solid ${variables.neutral200};
        text-align: left;
        white-space: nowrap;
    }
`;

type SeriesResult = {
    rows: SearchRow[];
    error: string;
    search: string;
    earliest: string;
    latest: string;
};

export function ChartView(props: {
    chart: ChartModel;
    range: string;
    span: string;
    refreshToken: number;
    globalSplit: string;
    selected: boolean;
    onSelect: () => void;
    onRemove: () => void;
    onClone: () => void;
}): React.ReactElement {
    const [results, setResults] = useState<SeriesResult[]>([]);
    const [referenceNumbers, setReferenceNumbers] = useState<Array<number | null | undefined>>([]);
    const [loading, setLoading] = useState(false);
    const [menu, setMenu] = useState(false);
    const [exportNote, setExportNote] = useState('');
    const cardRef = useRef<HTMLElement>(null);
    /** Series with the split they actually use, so inherited splits behave like chosen ones. */
    const series = resolveSeries(props.chart.series, props.globalSplit);
    const signature = JSON.stringify(series);
    const span = props.chart.settings.span || props.span;

    useEffect(() => {
        const stops: Array<() => void> = [];
        const next: SeriesResult[] = series.map(() => ({ rows: [], error: '', search: '', earliest: props.range, latest: 'now' }));
        setLoading(true);
        series.forEach((item, index) => {
            const chosen = resolveMetricFunction(item.aggregation);
            if (!chosen) {
                next[index] = { ...next[index], error: 'Unknown aggregation.' };
                setResults([...next]);
                setLoading(false);
                return;
            }
            let search = '';
            let earliest = props.range;
            let latest = 'now';
            try {
                search = buildMstats({
                    aggregation: item.aggregation,
                    metric: item.metric,
                    span,
                    splitBy: item.splitBy || undefined,
                    splitDirection: item.splitDirection,
                    splitLimit: item.splitLimit,
                    timeShift: item.timeShift || undefined,
                    filters: item.filters,
                });
                const bounds = searchWindow(props.range, item.timeShift);
                earliest = bounds.earliest;
                latest = bounds.latest;
            } catch (error) {
                next[index] = {
                    ...next[index],
                    error: error instanceof Error ? error.message : 'Could not build the search.',
                };
                setResults([...next]);
                setLoading(false);
                return;
            }
            next[index] = { ...next[index], search, earliest, latest };
            stops.push(
                runSearch(
                    search,
                    earliest,
                    (payload) => {
                        next[index] = { ...next[index], rows: payload.results ?? [], error: '' };
                        setResults([...next]);
                        setLoading(false);
                    },
                    (message) => {
                        next[index] = { ...next[index], error: message };
                        setResults([...next]);
                        setLoading(false);
                    },
                    latest
                )
            );
        });
        setResults([...next]);
        if (stops.length === 0) {
            setLoading(false);
        }
        return () => stops.forEach((stop) => stop());
    }, [signature, props.range, span, props.refreshToken]);

    const referenceJobs = props.chart.series.flatMap((item) =>
        item.referenceLines.map((line) => ({ line, metric: item.metric, filters: item.filters }))
    );
    const referenceKey = JSON.stringify(
        referenceJobs.map((job) => ({
            kind: job.line.kind,
            value: job.line.value,
            earliest: job.line.earliest ?? '',
            latest: job.line.latest ?? '',
            metric: job.metric,
            filters: job.filters,
        }))
    );
    useEffect(() => {
        const stops: Array<() => void> = [];
        const next: Array<number | null | undefined> = referenceJobs.map((job) =>
            job.line.kind === 'aggregation' && job.line.earliest ? null : undefined
        );
        referenceJobs.forEach((job, index) => {
            const bounds = job.line.earliest ? referenceWindow(job.line.earliest, job.line.latest || 'now') : null;
            if (job.line.kind !== 'aggregation' || !bounds) {
                return;
            }
            let search = '';
            try {
                search = buildReferenceValueSearch({ aggregation: job.line.value, metric: job.metric, filters: job.filters });
            } catch {
                return;
            }
            stops.push(
                runSearch(
                    search,
                    bounds.earliest,
                    (payload) => {
                        const row = payload.results?.[0];
                        const raw = row ? Object.entries(row).find(([key]) => !key.startsWith('_'))?.[1] : undefined;
                        const numeric = typeof raw === 'number' ? raw : Number(raw);
                        next[index] = Number.isFinite(numeric) ? numeric : null;
                        setReferenceNumbers([...next]);
                    },
                    () => {
                        next[index] = null;
                        setReferenceNumbers([...next]);
                    },
                    bounds.latest
                )
            );
        });
        setReferenceNumbers([...next]);
        return () => stops.forEach((stop) => stop());
    }, [referenceKey]);

    const locale = typeof window === 'undefined' ? undefined : window.location.pathname.match(/\/([a-z]{2}-[A-Z]{2})\//)?.[1];
    // A split only applies to a series whose metric has that dimension. Other series draw unsplit, and their legend says so.
    const shown = series.map((item, index) => ({
        ...item,
        splitBy: hasSplitValues(results[index]?.rows ?? [], item.splitBy) ? item.splitBy : '',
    }));
    const tables = shown.map((item, index) => {
        const label = seriesLegend(item, shown);
        return formatStatColumns(
            toLineTable(results[index]?.rows ?? [], label, item.splitBy || undefined),
            item.aggregation,
            locale
        );
    });
    const hasRows = (table: (typeof tables)[number]): boolean => (table.columns[0]?.length ?? 0) > 0;
    const plotIndexes = shown.flatMap((item, index) =>
        resolveMetricFunction(item.aggregation)?.chart === 'line' ? [index] : []
    );
    const tableOnly = shown.flatMap((item, index) =>
        resolveMetricFunction(item.aggregation)?.chart === 'table' ? [index] : []
    );
    const content = props.chart.settings.content;
    const tableIndexes = content === 'chart' ? tableOnly : shown.map((_, index) => index);
    const showChart = content !== 'table' && plotIndexes.some((index) => hasRows(tables[index]));
    const showTable = tableIndexes.some((index) => hasRows(tables[index]));
    const merged = mergeTables(plotIndexes.map((index) => tables[index]).filter(hasRows));
    const data = addReferenceLines(
        merged,
        referenceJobs.map((job) => job.line),
        referenceJobs.map((job, index) => (job.line.kind === 'aggregation' && job.line.earliest ? (referenceNumbers[index] ?? null) : undefined))
    );
    const plotted = plotIndexes.map((index) => tables[index]).filter(hasRows);
    let fieldCursor = 1;
    const y2Fields = plotted.flatMap((table, position) => {
        const seriesIndex = plotIndexes.filter((index) => hasRows(tables[index]))[position];
        const overlay = props.chart.series[seriesIndex]?.overlay;
        const names = table.fields.slice(1).map((_, offset) => data.fields[fieldCursor + offset]?.name ?? '');
        fieldCursor += table.fields.length - 1;
        return overlay ? names.filter((name) => name !== '') : [];
    });
    const stats = mergeTables(tableIndexes.map((index) => tables[index]).filter(hasRows));
    if (stats.columns[0]) {
        stats.columns[0] = stats.columns[0].map((value) => formatTimeCell(value, locale));
    }
    const title = [...new Set(props.chart.series.map((item) => item.metric))].join(', ');
    const visual = visualFor(props.chart.settings.type);
    const Viz = (visual.kind === 'area' ? Area : visual.kind === 'column' ? Column : Line) as typeof Line;
    const first = results[0];

    return (
        <Card ref={cardRef} $selected={props.selected} onClick={props.onSelect}>
            <TitleRow>
                <strong>
                    {title} (Time span={span})
                </strong>
                <Actions>
                    <SmallButton type="button" aria-label="Chart actions" onClick={() => setMenu((open) => !open)}>
                        Actions
                    </SmallButton>
                    <SmallButton type="button" aria-label="Remove chart" onClick={props.onRemove}>
                        Remove
                    </SmallButton>
                    {menu ? (
                        <Menu>
                            <SmallButton
                                type="button"
                                onClick={() => {
                                    if (!first?.search) {
                                        return;
                                    }
                                    const locale = window.location.pathname.match(/\/([a-z]{2}-[A-Z]{2})\//)?.[1] ?? 'en-US';
                                    window.open(
                                        splunkSearchUrl(locale, first.search, first.earliest, first.latest),
                                        '_blank',
                                        'noopener'
                                    );
                                    setMenu(false);
                                }}
                            >
                                Open in Search
                            </SmallButton>
                            <SmallButton type="button" onClick={props.onClone}>
                                Clone chart
                            </SmallButton>
                            <SmallButton
                                type="button"
                                onClick={() => {
                                    const blob = new Blob([toCsv(showChart ? data : stats)], { type: 'text/csv' });
                                    const url = URL.createObjectURL(blob);
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = `${props.chart.series[0]?.metric || 'chart'}.csv`;
                                    link.click();
                                    URL.revokeObjectURL(url);
                                    setMenu(false);
                                }}
                            >
                                Export CSV
                            </SmallButton>
                            <SmallButton
                                type="button"
                                disabled={visual.kind === 'heatmap' || !showChart}
                                title={
                                    visual.kind === 'heatmap' || !showChart
                                        ? 'PNG export needs a line, area, or column chart.'
                                        : 'Save the chart as a PNG image.'
                                }
                                onClick={async () => {
                                    const svg = chartSvg(cardRef.current);
                                    setMenu(false);
                                    if (!svg) {
                                        setExportNote('The chart is not drawn yet.');
                                        return;
                                    }
                                    try {
                                        const blob = await chartPng(svg, title);
                                        const url = URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.href = url;
                                        link.download = `${safeFileName(props.chart.series[0]?.metric || 'chart')}.png`;
                                        link.click();
                                        URL.revokeObjectURL(url);
                                        setExportNote('');
                                    } catch (error) {
                                        setExportNote(error instanceof Error ? error.message : 'The PNG could not be created.');
                                    }
                                }}
                            >
                                Export PNG
                            </SmallButton>
                        </Menu>
                    ) : null}
                </Actions>
            </TitleRow>
            {results.map((result, index) =>
                result.error ? <Note key={`${index}-${result.error}`}>{result.error}</Note> : null
            )}
            {loading ? <Note>Refreshing</Note> : null}
            {exportNote ? <Note>{exportNote}</Note> : null}
            {showChart && visual.kind === 'heatmap' ? (
                <HeatmapChart
                    table={heatmapTable(
                        shown,
                        tables,
                        plotIndexes.filter((index) => hasRows(tables[index])),
                        merged
                    )}
                    locale={locale}
                />
            ) : null}
            {showChart && visual.kind !== 'heatmap' && data.columns[0] && data.columns[0].length > 0 ? (
                <Viz
                    key={props.chart.settings.type}
                    width="100%"
                    height={260}
                    y2Fields={y2Fields}
                    dataSources={{
                        primary: {
                            requestParams: { count: data.columns[0].length },
                            data,
                            meta: { totalCount: data.columns[0].length },
                        },
                    }}
                    options={{
                        legendDisplay: 'bottom',
                        xAxisTitleVisibility: 'collapsed',
                        yAxisTitleVisibility: 'collapsed',
                        ...axisOptions(props.chart.settings),
                        ...(visual.stacked ? { stackMode: 'stacked' } : {}),
                    }}
                />
            ) : null}
            {showTable ? (
                <Grid>
                    <Stats aria-label="Statistics table">
                        <thead>
                            <tr>
                                {stats.fields.map((field) => (
                                    <th key={field.name} scope="col">
                                        {field.name === '_time' ? 'Time' : field.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(stats.columns[0] ?? []).map((_, row) => (
                                <tr key={`${stats.columns[0]?.[row] ?? ''}-${row}`}>
                                    {stats.fields.map((field, column) => (
                                        <td key={field.name}>{stats.columns[column]?.[row] ?? ''}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </Stats>
                </Grid>
            ) : null}
        </Card>
    );
}
