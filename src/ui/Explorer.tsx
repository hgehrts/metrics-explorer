import React, { useEffect, useMemo, useState } from 'react';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';
import { buildMetricTree, filterMetricTree, MetricNode } from '../catalog/metricTree';
import { METRIC_FUNCTIONS, resolveMetricFunction } from '../spl/functions';
import { buildDimensionSearch, buildDimensionValueSearch, SPLIT_LIMITS } from '../spl/buildMstats';
import { spanForRange } from '../spl/span';
import { collectFieldValues, collectMetricNames, runSearch } from '../search/runSearch';
import { ReferenceLine } from '../chart/reference';
import { buildSpan, ChartSettings, CHART_CONTENT, CHART_TYPES, SPAN_UNITS, validateAxis } from '../chart/settings';
import { AUTO_REFRESH_MS, ChartModel, cloneChart, createChart, createSeries, refreshStatus, Series } from '../model/workspace';
import { ChartView } from './ChartView';

const SHIFTS = [
    { id: '', label: 'None' },
    { id: '30m', label: '30 minutes before' },
    { id: '60m', label: '60 minutes before' },
    { id: '2h', label: '2 hours before' },
    { id: '24h', label: '24 hours before' },
    { id: '2d', label: '2 days before' },
    { id: '7d', label: '7 days before' },
];

const RANGES = [
    { id: '-15m', label: 'Last 15 minutes' },
    { id: '-60m', label: 'Last 60 minutes' },
    { id: '-4h', label: 'Last 4 hours' },
    { id: '-24h', label: 'Last 24 hours' },
    { id: '-7d', label: 'Last 7 days' },
    { id: '-2d', label: 'Last 2 days' },
];

const Shell = styled.div`
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr) 300px;
    height: 100vh;
    background: ${variables.backgroundColorPage};
    color: ${variables.contentColorDefault};
`;

const Pane = styled.aside`
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid ${variables.neutral200};
    background: ${variables.backgroundColorSidebar};
`;

const Analysis = styled(Pane)`
    border-right: 0;
    border-left: 1px solid ${variables.neutral200};
    overflow: auto;
`;

const PaneHeader = styled.div`
    padding: 14px 16px 8px;
    font-size: 16px;
    font-weight: 600;
`;

const SearchBox = styled.input`
    margin: 0 12px 8px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
`;

const Tree = styled.div`
    overflow: auto;
    padding: 0 8px 12px;
`;

const RowButton = styled.button<{ $depth: number; $selected: boolean }>`
    display: flex;
    width: 100%;
    text-align: left;
    gap: 6px;
    border: 0;
    border-radius: 4px;
    padding: 6px 8px 6px ${(props) => 8 + props.$depth * 14}px;
    background: transparent;
    ${(props) =>
        props.$selected &&
        css`
            background: ${variables.interactiveColorOverlaySelected};
        `}
    color: ${variables.contentColorDefault};
    cursor: pointer;
    &:hover {
        background: ${variables.interactiveColorOverlayHover};
    }
`;

const Stage = styled.main`
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
`;

const Toolbar = styled.div`
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding: 10px 16px;
    border-bottom: 1px solid ${variables.neutral200};
`;

const ToolButton = styled.button<{ $pressed?: boolean }>`
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    ${(props) =>
        props.$pressed &&
        css`
            background: ${variables.interactiveColorOverlaySelected};
        `}
    color: ${variables.contentColorDefault};
    border-radius: 6px;
    padding: 6px 10px;
    cursor: pointer;
    &:disabled {
        cursor: default;
        opacity: 0.45;
    }
`;

const ChartList = styled.div<{ $grid: boolean }>`
    display: grid;
    grid-template-columns: ${(props) => (props.$grid ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)')};
    gap: 16px;
    padding: 16px;
    overflow: auto;
`;

const Empty = styled.div`
    margin: auto;
    max-width: 460px;
    text-align: center;
    padding: 32px;
`;

const Field = styled.label`
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 16px 16px;
    font-size: 12px;
`;

const Select = styled.select`
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
`;

const SplitRow = styled.div`
    display: flex;
    gap: 8px;
    align-items: center;

    > * {
        min-width: 0;
        flex: 1 1 0;
    }
`;

const FilterChoices = styled.div`
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 160px;
    overflow: auto;
`;

const TextInput = styled.input`
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
`;

const Note = styled.p`
    margin: 8px 16px;
    color: ${variables.contentColorMuted};
    font-size: 12px;
`;

const Footer = styled.div`
    margin-top: auto;
    padding: 12px 16px;
    border-top: 1px solid ${variables.neutral200};
    font-size: 12px;
`;

function referenceValueReady(kind: ReferenceLine['kind'], value: string): boolean {
    if (kind === 'constant') {
        return value.trim() !== '' && Number.isFinite(Number(value));
    }
    const chosen = resolveMetricFunction(value);
    return Boolean(chosen && chosen.chart === 'line' && !chosen.rate && !chosen.name.startsWith('upperperc'));
}

function RefreshLabel(props: { refreshedAt: number; auto: boolean }): React.ReactElement {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return <>{refreshStatus(now, props.refreshedAt, props.auto)}</>;
}

function TreeRows(props: {
    nodes: MetricNode[];
    depth: number;
    open: Set<string>;
    selected?: string;
    onToggle: (id: string) => void;
    onSelect: (metricName: string) => void;
    onAdd: (metricName: string) => void;
}): React.ReactElement {
    return (
        <>
            {props.nodes.map((node) => (
                <React.Fragment key={node.id}>
                    <RowButton
                        type="button"
                        data-isfolder={node.folder}
                        data-metric={node.metricName ?? ''}
                        $depth={props.depth}
                        $selected={node.metricName === props.selected}
                        onClick={() => (node.folder ? props.onToggle(node.id) : props.onSelect(node.metricName ?? ''))}
                    >
                        <span>{node.folder ? (props.open.has(node.id) ? '▾' : '▸') : ''}</span>
                        <span>{node.label}</span>
                        {node.folder ? null : (
                            <span
                                role="button"
                                aria-label={`Add ${node.label} to selected chart`}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    props.onAdd(node.metricName ?? '');
                                }}
                            >
                                +
                            </span>
                        )}
                    </RowButton>
                    {node.folder && props.open.has(node.id) ? (
                        <TreeRows
                            nodes={node.children}
                            depth={props.depth + 1}
                            open={props.open}
                            selected={props.selected}
                            onToggle={props.onToggle}
                            onSelect={props.onSelect}
                            onAdd={props.onAdd}
                        />
                    ) : null}
                </React.Fragment>
            ))}
        </>
    );
}


export function Explorer(): React.ReactElement {
    const [query, setQuery] = useState('');
    const [names, setNames] = useState<string[]>([]);
    const [catalogReady, setCatalogReady] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [charts, setCharts] = useState<ChartModel[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [selectedSeriesId, setSelectedSeriesId] = useState('');
    const [layout, setLayout] = useState<'stack' | 'grid'>('stack');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [refreshedAt, setRefreshedAt] = useState(0);
    const [dimensions, setDimensions] = useState<string[]>([]);
    const [filterOpen, setFilterOpen] = useState(false);
    const [filterDimension, setFilterDimension] = useState('');
    const [filterMode, setFilterMode] = useState<'include' | 'exclude'>('include');
    const [filterChoices, setFilterChoices] = useState<string[]>([]);
    const [filterPicked, setFilterPicked] = useState<string[]>([]);
    const [spanCount, setSpanCount] = useState('');
    const [spanUnit, setSpanUnit] = useState('m');
    const [referenceOpen, setReferenceOpen] = useState(false);
    const [referenceKind, setReferenceKind] = useState<ReferenceLine['kind']>('aggregation');
    const [referenceValue, setReferenceValue] = useState('Avg');
    const [referenceLabel, setReferenceLabel] = useState('Avg');
    const [referenceInclude, setReferenceInclude] = useState(true);
    const [range, setRange] = useState('-60m');
    const [catalogRange, setCatalogRange] = useState('-2d');

    useEffect(() => {
        setCatalogError('');
        setCatalogReady(false);
        return runSearch(
            '| mcatalog values(metric_name) WHERE index=*',
            catalogRange,
            (payload) => {
                setNames(collectMetricNames(payload));
                setCatalogReady(true);
            },
            (message) => {
                setCatalogError(message);
                setCatalogReady(true);
            }
        );
    }, [catalogRange]);

    const tree = useMemo(
        () => filterMetricTree(buildMetricTree(names), query),
        [names, query]
    );
    const selected = charts.find((chart) => chart.id === selectedId) ?? charts[0];
    const series = selected?.series.find((item) => item.id === selectedSeriesId) ?? selected?.series[0];
    const chosen = resolveMetricFunction(series?.aggregation ?? '');
    const span = spanForRange(range);
    const seriesLabel = !series
        ? ''
        : series.splitBy
          ? `${chosen?.label ?? series.aggregation} by ${series.splitBy}`
          : chosen?.label ?? series.aggregation;

    useEffect(() => {
        if (!autoRefresh) {
            return undefined;
        }
        const timer = window.setInterval(() => {
            setRefreshToken((token) => token + 1);
            setRefreshedAt(Date.now());
        }, AUTO_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [autoRefresh]);

    useEffect(() => {
        setDimensions([]);
        if (!series?.metric) {
            return undefined;
        }
        try {
            return runSearch(
                buildDimensionSearch(series.metric),
                range,
                (payload) => setDimensions(collectFieldValues(payload, '_dims')),
                () => setDimensions([])
            );
        } catch {
            return undefined;
        }
    }, [series?.metric, range]);

    useEffect(() => {
        setFilterChoices([]);
        setFilterPicked([]);
        if (!filterOpen || !series?.metric || !filterDimension) {
            return undefined;
        }
        try {
            return runSearch(
                buildDimensionValueSearch(series.metric, filterDimension),
                range,
                (payload) => setFilterChoices(collectFieldValues(payload, filterDimension)),
                () => setFilterChoices([])
            );
        } catch {
            return undefined;
        }
    }, [filterOpen, series?.metric, filterDimension, range]);

    function refreshNow(): void {
        setRefreshToken((token) => token + 1);
        setRefreshedAt(Date.now());
    }

    function addChart(metricName: string): void {
        const chart = createChart(metricName);
        setCharts((current) => [...current, chart]);
        setSelectedId(chart.id);
        setSelectedSeriesId(chart.series[0].id);
        refreshNow();
    }

    function addToSelected(metricName: string): void {
        if (!selected) {
            addChart(metricName);
            return;
        }
        const created = createSeries(metricName);
        setCharts((current) =>
            current.map((chart) =>
                chart.id === selected.id ? { ...chart, series: [...chart.series, created] } : chart
            )
        );
        setSelectedSeriesId(created.id);
    }

    function patchSettings(patch: Partial<ChartSettings>): void {
        if (!selected) {
            return;
        }
        setCharts((current) =>
            current.map((chart) =>
                chart.id === selected.id ? { ...chart, settings: { ...chart.settings, ...patch } } : chart
            )
        );
    }

    function patchSeries(patch: Partial<Series>): void {
        if (!selected || !series) {
            return;
        }
        setCharts((current) =>
            current.map((chart) =>
                chart.id === selected.id
                    ? {
                          ...chart,
                          series: chart.series.map((item) => (item.id === series.id ? { ...item, ...patch } : item)),
                      }
                    : chart
            )
        );
    }

    return (
        <Shell>
            <Pane>
                <PaneHeader>Data</PaneHeader>
                <SearchBox
                    value={query}
                    placeholder="Search data to analyze"
                    aria-label="Search data to analyze"
                    onChange={(event) => setQuery(event.target.value)}
                />
                <Tree>
                    {catalogError ? <Note>{catalogError}</Note> : null}
                    {catalogReady && !catalogError && tree.length === 0 ? (
                        <Note>No metrics in this time range.</Note>
                    ) : null}
                    <TreeRows
                        nodes={tree}
                        depth={0}
                        open={open}
                        selected={series?.metric}
                        onToggle={(id) => {
                            const next = new Set(open);
                            if (next.has(id)) {
                                next.delete(id);
                            } else {
                                next.add(id);
                            }
                            setOpen(next);
                        }}
                        onSelect={addChart}
                        onAdd={addToSelected}
                    />
                </Tree>
                <Footer>
                    Data ingested from{' '}
                    <select
                        aria-label="Catalog time range"
                        value={catalogRange}
                        onChange={(event) => setCatalogRange(event.target.value)}
                    >
                        {RANGES.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.label}
                            </option>
                        ))}
                    </select>
                    <div>Changing this time setting will affect performance.</div>
                </Footer>
            </Pane>
            <Stage>
                <Toolbar>
                    <select aria-label="Time range" value={range} onChange={(event) => setRange(event.target.value)}>
                        {RANGES.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.label}
                            </option>
                        ))}
                    </select>
                    <ToolButton type="button" aria-label="Refresh chart data" onClick={refreshNow} disabled={charts.length === 0}>
                        Refresh <RefreshLabel refreshedAt={refreshedAt} auto={autoRefresh} />
                    </ToolButton>
                    <Select
                        aria-label="Auto-refresh"
                        value={autoRefresh ? 'on' : 'off'}
                        onChange={(event) => {
                            const enabled = event.target.value === 'on';
                            setAutoRefresh(enabled);
                            if (enabled) {
                                refreshNow();
                            }
                        }}
                    >
                        <option value="off">Auto-refresh off</option>
                        <option value="on">Auto-refresh on</option>
                    </Select>
                    <span>{charts.length > 0 ? `Time span=${span}` : ''}</span>
                    <ToolButton type="button" aria-pressed={layout === 'grid'} $pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
                        Grid layout
                    </ToolButton>
                    <ToolButton type="button" aria-pressed={layout === 'stack'} $pressed={layout === 'stack'} onClick={() => setLayout('stack')}>
                        Stack layout
                    </ToolButton>
                    <ToolButton
                        type="button"
                        disabled={charts.length === 0}
                        onClick={() => {
                            setCharts([]);
                            setSelectedId('');
                        }}
                    >
                        Remove all
                    </ToolButton>
                </Toolbar>
                {charts.length === 0 ? (
                    <Empty>
                        <h1>Start by selecting data.</h1>
                        <p>Find something interesting? Save it to a dashboard, or create an alert.</p>
                    </Empty>
                ) : (
                    <ChartList $grid={layout === 'grid'} data-layout={layout}>
                        {charts.map((chart) => (
                            <ChartView
                                key={chart.id}
                                chart={chart}
                                range={range}
                                span={span}
                                refreshToken={refreshToken}
                                selected={chart.id === selected?.id}
                                onSelect={() => setSelectedId(chart.id)}
                                onRemove={() => {
                                    setCharts((current) => current.filter((item) => item.id !== chart.id));
                                    if (selected?.id === chart.id) {
                                        setSelectedId('');
                                    }
                                }}
                                onClone={() => {
                                    const copy = cloneChart(chart);
                                    setCharts((current) => [...current, copy]);
                                    setSelectedId(copy.id);
                                }}
                            />
                        ))}
                    </ChartList>
                )}
            </Stage>
            <Analysis>
                <PaneHeader>Analysis</PaneHeader>
                {!series ? null : (
                    <>
                        <Note>
                            {(selected?.series ?? []).map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    aria-pressed={item.id === series.id}
                                    onClick={() => setSelectedSeriesId(item.id)}
                                >
                                    {item.metric}
                                </button>
                            ))}
                            <br />
                            {seriesLabel}
                        </Note>
                        <Field>
                            Aggregation
                            <TextInput
                                aria-label="Aggregation"
                                list="metric-aggregations"
                                value={series.aggregation}
                                onChange={(event) => {
                                    const aggregation = event.target.value;
                                    const next = resolveMetricFunction(aggregation);
                                    patchSeries({ aggregation });
                                    if (next?.chart === 'table' && selected.settings.content === 'chart') {
                                        const othersPlot = selected.series.some(
                                            (item) =>
                                                item.id !== series.id &&
                                                resolveMetricFunction(item.aggregation)?.chart !== 'table'
                                        );
                                        patchSettings({ content: othersPlot ? 'both' : 'table' });
                                    }
                                }}
                            />
                            <datalist id="metric-aggregations">
                                {METRIC_FUNCTIONS.map((item) => (
                                    <option key={item.name} value={item.label} />
                                ))}
                            </datalist>
                            <span>Select or type an aggregation.</span>
                        </Field>
                        <Field>
                            Split by
                            <Select
                                aria-label="Split by"
                                value={series.splitBy}
                                onChange={(event) => patchSeries({ splitBy: event.target.value })}
                            >
                                <option value="">None</option>
                                {dimensions.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Select>
                            <span>Display this series as separate values.</span>
                            {series.splitBy ? (
                                <SplitRow>
                                    <Select
                                        aria-label="Split limit type"
                                        value={series.splitDirection}
                                        onChange={(event) =>
                                            patchSeries({
                                                splitDirection: event.target.value === 'lowest' ? 'lowest' : 'highest',
                                            })
                                        }
                                    >
                                        <option value="highest">Highest</option>
                                        <option value="lowest">Lowest</option>
                                    </Select>
                                    <Select
                                        aria-label="Split limit"
                                        value={series.splitLimit}
                                        onChange={(event) => patchSeries({ splitLimit: Number(event.target.value) })}
                                    >
                                        {SPLIT_LIMITS.map((limit) => (
                                            <option key={limit} value={limit}>
                                                {limit}
                                            </option>
                                        ))}
                                    </Select>
                                </SplitRow>
                            ) : null}
                        </Field>
                        <Field>
                            Time shift
                            <Select
                                aria-label="Time shift"
                                value={series.timeShift}
                                onChange={(event) => patchSeries({ timeShift: event.target.value })}
                            >
                                {SHIFTS.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.label}
                                    </option>
                                ))}
                            </Select>
                            <span>Display an earlier time range.</span>
                        </Field>
                        <Field>
                            Filter
                            <span>Include or exclude dimension values.</span>
                            {series.filters.map((filter) => (
                                <SplitRow key={`${filter.dimension}-${filter.mode}`}>
                                    <span>
                                        {filter.dimension} {filter.mode === 'include' ? 'includes' : 'excludes'}{' '}
                                        {filter.values.join(', ')}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`Remove ${filter.dimension} filter`}
                                        onClick={() =>
                                            patchSeries({
                                                filters: series.filters.filter((item) => item !== filter),
                                            })
                                        }
                                    >
                                        Remove
                                    </button>
                                </SplitRow>
                            ))}
                            {filterOpen ? (
                                <>
                                    <Select
                                        aria-label="Filter dimension"
                                        value={filterDimension}
                                        onChange={(event) => setFilterDimension(event.target.value)}
                                    >
                                        <option value="">Select a dimension</option>
                                        {dimensions.map((name) => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                    </Select>
                                    <Select
                                        aria-label="Filter mode"
                                        value={filterMode}
                                        onChange={(event) =>
                                            setFilterMode(event.target.value === 'exclude' ? 'exclude' : 'include')
                                        }
                                    >
                                        <option value="include">Include</option>
                                        <option value="exclude">Exclude</option>
                                    </Select>
                                    <FilterChoices>
                                        {filterChoices.map((value) => (
                                            <label key={value}>
                                                <input
                                                    type="checkbox"
                                                    checked={filterPicked.includes(value)}
                                                    onChange={(event) =>
                                                        setFilterPicked((current) =>
                                                            event.target.checked
                                                                ? [...current, value]
                                                                : current.filter((item) => item !== value)
                                                        )
                                                    }
                                                />{' '}
                                                {value}
                                            </label>
                                        ))}
                                    </FilterChoices>
                                    <SplitRow>
                                        <button
                                            type="button"
                                            disabled={filterPicked.length === 0 || !filterDimension}
                                            onClick={() => {
                                                patchSeries({
                                                    filters: [
                                                        ...series.filters.filter((item) => item.dimension !== filterDimension),
                                                        { dimension: filterDimension, mode: filterMode, values: filterPicked },
                                                    ],
                                                });
                                                setFilterOpen(false);
                                                setFilterDimension('');
                                                setFilterPicked([]);
                                            }}
                                        >
                                            Add
                                        </button>
                                        <button type="button" onClick={() => setFilterOpen(false)}>
                                            Cancel
                                        </button>
                                    </SplitRow>
                                </>
                            ) : (
                                <button type="button" onClick={() => setFilterOpen(true)}>
                                    Add filter
                                </button>
                            )}
                        </Field>
                        <Field>
                            Reference lines
                            <span>Add a horizontal line for a threshold or a value from this chart.</span>
                            {series.referenceLines.map((line, index) => (
                                <SplitRow key={`${line.kind}-${line.label}-${index}`}>
                                    <span>{line.label || line.value}</span>
                                    <button
                                        type="button"
                                        aria-label={`Remove reference line ${line.label || line.value}`}
                                        onClick={() =>
                                            patchSeries({
                                                referenceLines: series.referenceLines.filter((_, itemIndex) => itemIndex !== index),
                                            })
                                        }
                                    >
                                        Remove
                                    </button>
                                </SplitRow>
                            ))}
                            {referenceOpen ? (
                                <>
                                    <Select
                                        aria-label="Reference calculation"
                                        value={referenceKind}
                                        onChange={(event) => {
                                            const kind = event.target.value === 'constant' ? 'constant' : 'aggregation';
                                            setReferenceKind(kind);
                                            setReferenceValue(kind === 'constant' ? '' : 'Avg');
                                            setReferenceLabel(kind === 'constant' ? '' : 'Avg');
                                        }}
                                    >
                                        <option value="aggregation">Raw data</option>
                                        <option value="constant">Constant value</option>
                                    </Select>
                                    <TextInput
                                        aria-label="Reference value"
                                        value={referenceValue}
                                        placeholder={referenceKind === 'constant' ? '25' : 'Avg'}
                                        onChange={(event) => setReferenceValue(event.target.value)}
                                    />
                                    <TextInput
                                        aria-label="Reference label"
                                        value={referenceLabel}
                                        placeholder="Label"
                                        onChange={(event) => setReferenceLabel(event.target.value)}
                                    />
                                    <span>
                                        <input
                                            type="checkbox"
                                            aria-label="Include value"
                                            checked={referenceInclude}
                                            onChange={(event) => setReferenceInclude(event.target.checked)}
                                        />{' '}
                                        Include value
                                    </span>
                                    <SplitRow>
                                        <button
                                            type="button"
                                            disabled={!referenceValueReady(referenceKind, referenceValue)}
                                            onClick={() => {
                                                const line: ReferenceLine = {
                                                    kind: referenceKind,
                                                    value: referenceValue.trim(),
                                                    label: referenceLabel.trim(),
                                                    includeValue: referenceInclude,
                                                };
                                                patchSeries({ referenceLines: [...series.referenceLines, line] });
                                                setReferenceOpen(false);
                                            }}
                                        >
                                            Add
                                        </button>
                                        <button type="button" onClick={() => setReferenceOpen(false)}>
                                            Cancel
                                        </button>
                                    </SplitRow>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReferenceKind('aggregation');
                                        setReferenceValue('Avg');
                                        setReferenceLabel('Avg');
                                        setReferenceInclude(true);
                                        setReferenceOpen(true);
                                    }}
                                >
                                    Add reference line
                                </button>
                            )}
                        </Field>
                        <Field>
                            <span>
                                <input
                                    type="checkbox"
                                    aria-label="Overlay on right axis"
                                    checked={series.overlay}
                                    onChange={(event) => patchSeries({ overlay: event.target.checked })}
                                />{' '}
                                Overlay on right axis
                            </span>
                        </Field>
                        {chosen?.rate ? (
                            <Note>This aggregation should only be used with accumulating counter metrics.</Note>
                        ) : null}
                    </>
                )}
                {selected ? (
                    <Field as="div">
                        <details>
                            <summary>Chart settings</summary>
                            <Field as="div">
                                Chart type
                                <Select
                                    aria-label="Chart type"
                                    value={selected.settings.type}
                                    onChange={(event) =>
                                        patchSettings({ type: event.target.value as ChartSettings['type'] })
                                    }
                                >
                                    {CHART_TYPES.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.label}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field as="div">
                                Show
                                <Select
                                    aria-label="Chart content"
                                    value={selected.settings.content}
                                    onChange={(event) => {
                                        const content = event.target.value;
                                        patchSettings({
                                            content: content === 'table' || content === 'both' ? content : 'chart',
                                        });
                                    }}
                                >
                                    {CHART_CONTENT.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.label}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field as="div">
                                Time span = {selected.settings.span || 'Auto'}
                                <span>Refer to the time range to set an appropriate time span.</span>
                                <SplitRow>
                                    <TextInput
                                        aria-label="Span count"
                                        value={spanCount}
                                        inputMode="numeric"
                                        onChange={(event) => setSpanCount(event.target.value)}
                                    />
                                    <Select
                                        aria-label="Span unit"
                                        value={spanUnit}
                                        onChange={(event) => setSpanUnit(event.target.value)}
                                    >
                                        {SPAN_UNITS.map((item) => (
                                            <option key={item.id} value={item.id}>
                                                {item.label}
                                            </option>
                                        ))}
                                    </Select>
                                </SplitRow>
                                <SplitRow>
                                    <button
                                        type="button"
                                        disabled={buildSpan(spanCount, spanUnit) === null}
                                        onClick={() => patchSettings({ span: buildSpan(spanCount, spanUnit) ?? '' })}
                                    >
                                        Apply span
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!selected.settings.span}
                                        onClick={() => {
                                            patchSettings({ span: '' });
                                            setSpanCount('');
                                        }}
                                    >
                                        Revert span
                                    </button>
                                </SplitRow>
                            </Field>
                            {selected.settings.content === 'table' ? null : (
                            <Field as="div">
                                Y-axis
                                <span>Set the minimum and maximum, for example 1000, 1k or 3m.</span>
                                <SplitRow>
                                    <TextInput
                                        aria-label="Y-axis minimum"
                                        placeholder="Min"
                                        value={selected.settings.yMin}
                                        onChange={(event) => patchSettings({ yMin: event.target.value })}
                                    />
                                    <TextInput
                                        aria-label="Y-axis maximum"
                                        placeholder="Max"
                                        value={selected.settings.yMax}
                                        onChange={(event) => patchSettings({ yMax: event.target.value })}
                                    />
                                </SplitRow>
                                <Select
                                    aria-label="Y-axis scale"
                                    value={selected.settings.yScale}
                                    onChange={(event) =>
                                        patchSettings({ yScale: event.target.value === 'log' ? 'log' : 'linear' })
                                    }
                                >
                                    <option value="linear">Linear</option>
                                    <option value="log">Log</option>
                                </Select>
                                {validateAxis(selected.settings) ? <span role="alert">{validateAxis(selected.settings)}</span> : null}
                                <button
                                    type="button"
                                    onClick={() => patchSettings({ yMin: '', yMax: '', yScale: 'linear' })}
                                >
                                    Revert y-axis
                                </button>
                            </Field>
                            )}
                        </details>
                    </Field>
                ) : null}
            </Analysis>
        </Shell>
    );
}
