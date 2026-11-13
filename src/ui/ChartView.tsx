import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Area from '@splunk/visualizations/Area';
import Column from '@splunk/visualizations/Column';
import Line from '@splunk/visualizations/Line';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';
import { mergeCategoryTables, toCategoryTable, toLineTable } from '../chart/columns';
import { addReferenceLines, referenceWindow } from '../chart/reference';
import { axisOptions, isCategorical, visualFor } from '../chart/settings';
import { chartTimeBounds } from '../chart/timeAxis';
import { heatmapTable } from '../chart/heatmap';
import { formatStatColumns, formatTimeCell } from '../chart/stats';
import { HeatmapChart } from './HeatmapChart';
import { mergeTables, splunkSearchUrl, toCsv } from '../export/table';
import { chartPng, chartSvg, safeFileName } from '../export/png';
import { ChartModel, globalFiltersFor, GlobalSplitLimit, hasSplitValues, resolveSeries, SeriesFilter, seriesLegend } from '../model/workspace';
import { DropdownMenu, MenuItem } from './Menu';
import { runSearch, SearchRow } from '../search/runSearch';
import { buildReferenceValueSearch, relatedEventsSearch } from '../spl/buildMstats';
import { resolveForSource } from '../spl/functions';
import { estimatedPoints, spanForRange } from '../spl/span';
import { buildSeriesSearch } from '../spl/seriesSearch';
import { t } from '../i18n';
import { zoomWindow } from '../chart/zoom';
import { formatTooltipValue } from '../chart/tooltip';
import { chartCardLayout } from './chartFrame';
import { abbreviateMetricTitle, titleFits } from '../chart/metricLabel';
import { timechartProblem } from '../chart/timechartShape';

const Card = styled.section<{ $selected: boolean; $compact: boolean }>`
    margin: 0;
    box-sizing: ${chartCardLayout.boxSizing};
    min-width: ${chartCardLayout.minWidth};
    height: ${chartCardLayout.height};
    align-self: ${chartCardLayout.alignSelf};
    padding: 12px 12px 4px;
    border: 1px solid ${variables.neutral200};
    ${(props) =>
        props.$selected &&
        css`
            border-color: ${variables.interactiveColorPrimary};
        `}
    border-radius: 2px;
    background: ${variables.backgroundColorSection};
    min-height: ${(props) => (props.$compact ? 0 : '220px')};
`;

const TitleRow = styled.div`
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: flex-start;
`;

const Actions = styled.div`
    display: flex;
    flex: none;
    gap: 6px;
    position: relative;
`;

const SmallButton = styled.button`
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 12px;
    cursor: pointer;
`;

const IconAction = styled.button`
    padding: 2px 6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: ${variables.contentColorDefault};
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    &:hover {
        background: ${variables.interactiveColorOverlayHover};
    }
`;

/** A metric name that stays whole when the line is wide enough and shortens only when it is not. */
export function FittingTitle(props: { text: string }): React.ReactElement {
    const ref = useRef<HTMLHeadingElement>(null);
    const [fits, setFits] = useState(true);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) {
            return undefined;
        }
        const measure = (): void => {
            const probe = document.createElement('span');
            probe.textContent = props.text;
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-weight:700;font-size:12px;';
            document.body.appendChild(probe);
            const needed = probe.getBoundingClientRect().width;
            probe.remove();
            setFits(titleFits(needed + 6, node.clientWidth));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [props.text]);
    const shown = fits ? props.text : abbreviateMetricTitle(props.text);
    return (
        <h2
            ref={ref}
            title={shown === props.text ? undefined : props.text}
            aria-label={props.text}
            style={{
                margin: 0,
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: fits ? 'nowrap' : 'normal',
                overflow: 'hidden',
            }}
        >
            {shown}
        </h2>
    );
}

const Title = styled.div`
    min-width: ${chartCardLayout.titleMinWidth};
    flex: 1 1 auto;
    overflow-wrap: ${chartCardLayout.titleOverflowWrap};
    font-size: 12px;

    h2 {
        display: inline;
        margin: 0 6px 0 0;
        font-size: 12px;
        font-weight: 700;
        overflow-wrap: inherit;
    }

    span {
        color: ${variables.contentColorMuted};
    }
`;

// The visualization draws its own tooltip only when its tooltip option is on, and hover events need that option.
// The tooltip stays in the DOM but is hidden, so the exact formatted value in HoverTip is the only one shown.
const PlotArea = styled.div`
    position: relative;

    .highcharts-tooltip-container {
        opacity: 0 !important;
        pointer-events: none !important;
    }
`;

const HoverTip = styled.div`
    position: absolute;
    z-index: 3;
    pointer-events: none;
    padding: 6px 8px;
    border: 1px solid ${variables.neutral200};
    border-radius: 6px;
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    font-size: 12px;
    white-space: nowrap;
`;

type HoverPoint = { name: string; value: number; time: string };

/** Reads the hovered point from a visualization event. Points without a numeric value show nothing. */
function hoverPoint(payload: Record<string, unknown> | undefined): HoverPoint | null {
    const value = Number(payload?.value);
    if (payload?.value === undefined || payload?.value === null || !Number.isFinite(value)) {
        return null;
    }
    const row = (payload.rowContext ?? {}) as Record<string, unknown>;
    const time = row._time ?? payload._time;
    return {
        name: typeof payload.name === 'string' ? payload.name : '',
        value,
        time: typeof time === 'string' ? time : '',
    };
}

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

const Empty = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: ${variables.contentColorMuted};
    font-size: 13px;
`;

export type ChartSaveMode = 'report' | 'panel-classic' | 'panel-studio' | 'base' | 'alert-scheduled' | 'alert-streaming';

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
    latest: string;
    span: string;
    refreshToken: number;
    globalSplit: string;
    globalLimit: GlobalSplitLimit;
    /** The window every chart shows after a drag across one of them. Null shows the time range. */
    zoom: { earliest: string; latest: string } | null;
    onZoom: (window: { earliest: string; latest: string }) => void;
    /** Filters that apply to every chart. A series gets only those whose dimension its metric has. */
    globalFilters: SeriesFilter[];
    /** Dimensions per metric. A metric not in here yet takes every global filter until its dimensions arrive. */
    metricDims: Record<string, string[]>;
    eventIndexes: string[];
    /** Metric indexes this user may search. Undefined keeps `index=*`. */
    metricIndexes?: string[];
    selected: boolean;
    onSelect: () => void;
    onRemove: () => void;
    onClone: () => void;
    minimized: boolean;
    maximized: boolean;
    onMinimize: () => void;
    onMaximize: () => void;
    /** The toolbar span was chosen by the user, so a span that is too fine can be widened. */
    spanManual?: boolean;
    /** Replaces a manual span that would draw too many points. */
    onWidenSpan: (span: string) => void;
    onSave: (mode: ChartSaveMode) => void;
    /** A trellis tile: the value is the title, and the plot uses the chosen row height. */
    compact?: boolean;
    plotHeight?: number;
    titleText?: string;
}): React.ReactElement {
    const [results, setResults] = useState<SeriesResult[]>([]);
    const [referenceNumbers, setReferenceNumbers] = useState<Array<number | null | undefined>>([]);
    const [loading, setLoading] = useState(false);
    const [exportNote, setExportNote] = useState('');
    const zoom = props.zoom;
    /** The point under the pointer. The visualization's own tooltip is off, so this one shows exact, formatted values. */
    const [hover, setHover] = useState<HoverPoint | null>(null);
    // The pointer position is not React state: a state update on every mouse move re-renders the chart and drops its hover.
    const pointerAt = useRef({ x: 0, y: 0 });
    const tipRef = useRef<HTMLDivElement | null>(null);
    const cardRef = useRef<HTMLElement>(null);
    /** Series with the split they actually use, so inherited splits behave like chosen ones. */
    const series = resolveSeries(props.chart.series, props.globalSplit, props.chart.useGlobalSplit, props.globalLimit).map((item) => ({
        ...item,
        filters: [...globalFiltersFor(item, props.globalFilters, props.metricDims), ...item.filters],
    }));
    const signature = JSON.stringify(series);
    const categorical = isCategorical(props.chart.settings.type);
    const timeWindow = zoom ?? { earliest: props.range, latest: props.latest };
    const span = props.chart.settings.span || props.span;
    const manualSpan = Boolean(props.chart.settings.span) || Boolean(props.spanManual);
    // The global refresh waits while the charts are zoomed. Zooming out makes the next refresh count again.
    const refreshToken = zoom ? 0 : props.refreshToken;

    useEffect(() => {
        const stops: Array<() => void> = [];
        const next: SeriesResult[] = series.map(() => ({ rows: [], error: '', search: '', earliest: timeWindow.earliest, latest: timeWindow.latest }));
        setLoading(true);
        series.forEach((item, index) => {
            let search = '';
            let earliest = timeWindow.earliest;
            let latest = timeWindow.latest;
            try {
                const built = buildSeriesSearch(
                    item,
                    span,
                    timeWindow.earliest,
                    timeWindow.latest,
                    props.eventIndexes,
                    props.metricIndexes,
                    categorical
                );
                search = built.search;
                earliest = built.earliest;
                latest = built.latest;
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
                        const rows = payload.results ?? [];
                        const problem = item.source === 'search' ? timechartProblem(rows) : '';
                        next[index] = { ...next[index], rows: problem ? [] : rows, error: problem };
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
    }, [signature, categorical, timeWindow.earliest, timeWindow.latest, span, refreshToken, props.eventIndexes, props.metricIndexes]);

    const referenceJobs = props.chart.series.flatMap((item) =>
        (item.source ?? 'metric') === 'metric'
            ? item.referenceLines.map((line) => ({ line, metric: item.metric, filters: item.filters }))
            : []
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
                search = buildReferenceValueSearch({
                    aggregation: job.line.value,
                    metric: job.metric,
                    filters: job.filters,
                    indexes: props.metricIndexes,
                });
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
    }, [referenceKey, props.metricIndexes]);

    const locale = typeof window === 'undefined' ? undefined : window.location.pathname.match(/\/([a-z]{2}-[A-Z]{2})\//)?.[1];
    // A split only applies to a series whose metric has that dimension. Other series draw unsplit, and their legend says so.
    const shown = series.map((item, index) => ({
        ...item,
        splitBy: hasSplitValues(results[index]?.rows ?? [], item.splitBy) ? item.splitBy : '',
    }));
    const tables = shown.map((item, index) => {
        // A split charted wide has one column per value. With only one value, that value names the line.
        const rows = results[index]?.rows ?? [];
        const values = series[index].splitBy && !item.splitBy ? [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !key.startsWith('_'))))] : [];
        const label = !categorical && values.length === 1 ? values[0] : seriesLegend(item, shown);
        const table = categorical
            ? toCategoryTable(rows, label, item.splitBy || undefined)
            : toLineTable(rows, label, item.splitBy || undefined);
        return formatStatColumns(table, item.aggregation, locale);
    });
    const hasRows = (table: (typeof tables)[number]): boolean => (table.columns[0]?.length ?? 0) > 0;
    const plotIndexes = shown.flatMap((item, index) =>
        resolveForSource(item.source, item.aggregation)?.chart === 'line' ? [index] : []
    );
    const tableOnly = shown.flatMap((item, index) =>
        resolveForSource(item.source, item.aggregation)?.chart === 'table' ? [index] : []
    );
    const content = props.chart.settings.content;
    const tableIndexes = content === 'chart' ? tableOnly : shown.map((_, index) => index);
    const showChart = content !== 'table' && plotIndexes.some((index) => hasRows(tables[index]));
    const showTable = tableIndexes.some((index) => hasRows(tables[index]));
    const plotTables = plotIndexes.map((index) => tables[index]).filter(hasRows);
    const merged = categorical ? mergeCategoryTables(plotTables) : mergeTables(plotTables);
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
    const statTables = tableIndexes.map((index) => tables[index]).filter(hasRows);
    const stats = categorical ? mergeCategoryTables(statTables) : mergeTables(statTables);
    if (!categorical && stats.columns[0]) {
        stats.columns[0] = stats.columns[0].map((value) => formatTimeCell(value, locale));
    }
    const title = props.titleText ?? [...new Set(props.chart.series.map((item) => item.metric))].join(', ');
    const titleBox = useRef<HTMLDivElement>(null);
    const [fits, setFits] = useState(true);
    useLayoutEffect(() => {
        const box = titleBox.current;
        if (!box) {
            return undefined;
        }
        const measure = (): void => {
            const span = box.querySelector('span');
            const spanWidth = span ? span.getBoundingClientRect().width + 8 : 0;
            const available = box.clientWidth - spanWidth;
            const probe = document.createElement('span');
            probe.textContent = title;
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-weight:700;font-size:12px;';
            document.body.appendChild(probe);
            const needed = probe.getBoundingClientRect().width;
            probe.remove();
            setFits(titleFits(needed + 6, Math.max(0, available)));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(box);
        return () => observer.disconnect();
    }, [title]);
    const shownTitle = fits ? title : abbreviateMetricTitle(title);
    const visual = visualFor(props.chart.settings.type);
    const Viz = (visual.kind === 'area' ? Area : visual.kind === 'column' ? Column : Line) as typeof Line;
    const first = results[0];

    return (
        <Card ref={cardRef} $selected={props.selected} $compact={Boolean(props.compact)} onClick={props.onSelect}>
            <TitleRow>
                <Title ref={titleBox}>
                    <h2
                        title={shownTitle === title ? undefined : title}
                        aria-label={title}
                        style={{ whiteSpace: fits ? 'nowrap' : 'normal' }}
                    >
                        {shownTitle}
                    </h2>
                    {categorical ? null : <span>({t('Time span')}={span})</span>}
                </Title>
                {props.compact ? null : (
                <Actions onClick={(event) => event.stopPropagation()}>
                    <IconAction
                        type="button"
                        aria-label={props.minimized ? t('Restore chart') : t('Minimize chart')}
                        title={props.minimized ? t('Restore chart') : t('Minimize chart')}
                        onClick={props.onMinimize}
                    >
                        {props.minimized ? '▸' : '▾'}
                    </IconAction>
                    <IconAction
                        type="button"
                        aria-label={props.maximized ? t('Restore chart size') : t('Maximize chart')}
                        title={props.maximized ? t('Restore chart size') : t('Maximize chart')}
                        onClick={props.onMaximize}
                    >
                        {props.maximized ? '⤡' : '⤢'}
                    </IconAction>
                    <DropdownMenu
                        label={t('Chart actions')}
                        alignRight
                        trigger={(isOpen, toggle) => (
                            <IconAction type="button" aria-label={t('Chart actions')} title={t('Chart actions')} aria-expanded={isOpen} onClick={toggle}>
                                ⋯
                            </IconAction>
                        )}
                    >
                        {(close) => (
                            <>
                                <MenuItem
                                    disabled={!first?.search}
                                    onClick={() => {
                                        close();
                                        if (!first?.search) {
                                            return;
                                        }
                                        window.open(splunkSearchUrl(locale ?? 'en-US', first.search, first.earliest, first.latest), '_blank', 'noopener');
                                    }}
                                >
                                    {t('Open in Search')}
                                </MenuItem>
                                <MenuItem
                                    onClick={() => {
                                        close();
                                        props.onClone();
                                    }}
                                >
                                    {t('Clone this panel')}
                                </MenuItem>
                                <MenuItem
                                    onClick={() => {
                                        close();
                                        const item = props.chart.series[0];
                                        window.open(
                                            splunkSearchUrl(
                                                locale ?? 'en-US',
                                                relatedEventsSearch({
                                                    source: item?.source,
                                                    name: item?.metric ?? '',
                                                    filters: item?.filters,
                                                    indexes: props.eventIndexes,
                                                }),
                                                timeWindow.earliest,
                                                timeWindow.latest
                                            ),
                                            '_blank',
                                            'noopener'
                                        );
                                    }}
                                >
                                    {t('Search related events')}
                                </MenuItem>
                                {(
                                    [
                                        ['alert-scheduled', 'Save as scheduled alert'],
                                        ['alert-streaming', 'Save as streaming alert'],
                                        ['panel-classic', 'Save to Classic Dashboards'],
                                        ['panel-studio', 'Save to Dashboard Studio'],
                                        ['report', 'Save as report'],
                                        ['base', 'Save as base search'],
                                    ] as Array<[ChartSaveMode, string]>
                                ).map(([mode, label]) => (
                                    <MenuItem
                                        key={mode}
                                        onClick={() => {
                                            close();
                                            props.onSave(mode);
                                        }}
                                    >
                                        {t(label)}
                                    </MenuItem>
                                ))}
                                <MenuItem
                                    disabled={visual.kind === 'heatmap' || !showChart}
                                    title={visual.kind === 'heatmap' || !showChart ? t('PNG export needs a line, area, or column chart.') : undefined}
                                    onClick={async () => {
                                        close();
                                        const svg = chartSvg(cardRef.current);
                                        if (!svg) {
                                            setExportNote(t('The chart is not drawn yet.'));
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
                                            setExportNote(error instanceof Error ? error.message : t('The PNG could not be created.'));
                                        }
                                    }}
                                >
                                    {t('Export as PNG')}
                                </MenuItem>
                                <MenuItem
                                    onClick={() => {
                                        close();
                                        const blob = new Blob([toCsv(showChart ? data : stats)], { type: 'text/csv' });
                                        const url = URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.href = url;
                                        link.download = `${props.chart.series[0]?.metric || 'chart'}.csv`;
                                        link.click();
                                        URL.revokeObjectURL(url);
                                    }}
                                >
                                    {t('Export as CSV')}
                                </MenuItem>
                            </>
                        )}
                    </DropdownMenu>
                    <IconAction type="button" aria-label={t('Remove chart')} title={t('Remove chart')} onClick={props.onRemove}>
                        ×
                    </IconAction>
                </Actions>
                )}
            </TitleRow>
            {props.minimized ? null : (
                <>
            {results.map((result, index) =>
                result.error ? <Note key={`${index}-${result.error}`}>{t(result.error)}</Note> : null
            )}
            {loading ? <Note>{results.some((result) => result.rows.length > 0) ? t('Refreshing…') : t('Loading…')}</Note> : null}
            {!loading && results.length > 0 && results.every((result) => !result.error && result.rows.length === 0) ? (
                <Empty role="status">{t('No results found.')}</Empty>
            ) : null}
            {manualSpan && estimatedPoints(timeWindow.earliest, timeWindow.latest, span) > 1000 ? (
                <Note role="status">
                    {t('This span draws about {0} points.').replace(
                        '{0}',
                        String(estimatedPoints(timeWindow.earliest, timeWindow.latest, span))
                    )}{' '}
                    {t('A chart stays readable under 1,000.')}{' '}
                    <SmallButton
                        type="button"
                        onClick={() => props.onWidenSpan(spanForRange(timeWindow.earliest, timeWindow.latest))}
                    >
                        {t('Use a wider span')}
                    </SmallButton>
                </Note>
            ) : null}
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
                <PlotArea
                    onMouseMove={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        pointerAt.current = { x: event.clientX - box.left, y: event.clientY - box.top };
                        if (tipRef.current) {
                            tipRef.current.style.left = `${pointerAt.current.x + 14}px`;
                            tipRef.current.style.top = `${pointerAt.current.y + 14}px`;
                        }
                    }}
                    onMouseLeave={() => setHover(null)}
                >
                <Viz
                    key={props.chart.settings.type}
                    width="100%"
                    height={props.compact ? Math.max(120, (props.plotHeight ?? 220) - 48) : props.maximized ? 560 : 260}
                    y2Fields={y2Fields}
                    dataSources={{
                        primary: {
                            requestParams: { count: data.columns[0].length },
                            data,
                            meta: { totalCount: data.columns[0].length },
                        },
                    }}
                    hasEventHandlers
                    eventHandlers={categorical ? [] : [{ type: 'zoom', options: { events: ['range.select'] } }]}
                    onEventTrigger={(event: { type?: string; payload?: Record<string, unknown> }) => {
                        if (event?.type === 'point.mouseover') {
                            setHover(hoverPoint(event.payload));
                            return;
                        }
                        if (event?.type === 'point.mouseout') {
                            setHover(null);
                            return;
                        }
                        // Only a drag across the plot zooms. Clicks and other events change nothing.
                        if (event?.type !== 'range.select') {
                            return;
                        }
                        const next = zoomWindow(event.payload, Date.now() / 1000);
                        if (next) {
                            props.onZoom(next);
                        }
                    }}
                    options={{
                        showTooltip: true,
                        legendDisplay: 'bottom',
                        xAxisTitleVisibility: 'collapsed',
                        yAxisTitleVisibility: 'collapsed',
                        ...axisOptions(props.chart.settings),
                        ...(categorical ? {} : (chartTimeBounds(timeWindow.earliest, timeWindow.latest) ?? {})),
                        ...(visual.stacked ? { stackMode: 'stacked' } : {}),
                        ...(categorical ? { dataValuesDisplay: 'all' } : {}),
                    }}
                />
                {hover ? (
                    <HoverTip
                        ref={tipRef}
                        role="tooltip"
                        style={{ left: pointerAt.current.x + 14, top: pointerAt.current.y + 14 }}
                    >
                        {hover.time ? <div>{hover.time}</div> : null}
                        <div>
                            {hover.name ? `${hover.name}: ` : ''}
                            {formatTooltipValue(hover.value, props.chart.settings.decimals, locale ?? 'en-US')}
                        </div>
                    </HoverTip>
                ) : null}
                </PlotArea>
            ) : null}
            {showTable ? (
                <Grid>
                    <Stats aria-label={t('Statistics table')}>
                        <thead>
                            <tr>
                                {stats.fields.map((field) => (
                                    <th key={field.name} scope="col">
                                        {field.name === '_time' ? t('Time') : field.name}
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
                </>
            )}
        </Card>
    );
}
