import React, { useEffect, useMemo, useState } from 'react';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';
import {
    buildMetricTree,
    buildValueTree,
    filterMetricTree,
    HIERARCHY_SEPARATORS,
    limitMetricNames,
    limitValueRows,
    MetricNode,
    ValueRow,
} from '../catalog/metricTree';
import {
    isPercentText,
    functionsFor,
    needsField,
    parsePercentile,
    percentileMethods,
    PercentileKind,
    PERCENTILE_PRESETS,
    rateExplanation,
    resolveForSource,
    resolveMetricFunction,
    SeriesSource,
} from '../spl/functions';
import { parseTimeShift, SHIFT_UNITS, ShiftUnit, timeShiftToken } from '../spl/timeShift';
import { buildAllDimensionSearch, buildDimensionSearch, buildDimensionValueSearch, buildFieldSearch, buildSourcetypeSearch, readableFields, SPLIT_LIMITS } from '../spl/buildMstats';
import { spanForRange } from '../spl/span';
import { boundForInput, customRange } from '../spl/timeRange';
import { isSeriesFilter } from '../model/session';
import { collectFieldValues, collectMetricNames, collectValueMetrics, runSearch } from '../search/runSearch';
import { ReferenceLine, referenceSummary, referenceWindow } from '../chart/reference';
import { buildSpan, ChartSettings, CHART_CONTENT, CHART_TYPES, SPAN_UNITS, validateAxis } from '../chart/settings';
import {
    AUTO_REFRESH_MS,
    ChartModel,
    cloneChart,
    createChart,
    reviveChart,
    createSeries,
    INHERIT_SPLIT,
    refreshStatus,
    resolveSplit,
    Series,
    SeriesFilter,
    seriesLegend,
} from '../model/workspace';
import { ChartView } from './ChartView';
import { DataLists } from './DataLists';
import { SaveDialog, SaveMode } from './SaveDialog';
import { t } from '../i18n';
import { parseSession, SavedSession, serializeSession, sessionKey } from '../model/session';
import { splunkGet } from '../api/splunkd';
import { buildCatalogSearch, DataFilter, filterLabel, indexFromSearch, validateFilter } from '../model/dataFilters';
import { loadAllowedMetricIndexes } from '../model/metricIndexes';
import { DEFAULT_MAX_METRICS, loadSettings } from '../model/loadDefaults';

/** The filter a tree leaf adds: a metric under a dimension value only shows that value. */
function seriesFilters(filter: MetricNode['filter']): SeriesFilter[] {
    return filter ? [{ dimension: filter.dimension, mode: 'include', values: [filter.value] }] : [];
}

/** The dimensions to offer. A value already chosen stays offered while the list is still loading. */
function splitChoices(dimensions: string[], chosen: string): string[] {
    return chosen && !dimensions.includes(chosen) ? [chosen, ...dimensions] : dimensions;
}

function sameFilters(left: DataFilter[], right: DataFilter[]): boolean {
    return (
        left.length === right.length &&
        left.every((item, index) => item.kind === right[index].kind && item.value === right[index].value)
    );
}

/** The signed-in Splunk user, so each user keeps their own saved charts. Empty when Splunk does not expose it. */
function currentUser(): string {
    return (window as unknown as { $C?: { USERNAME?: string } }).$C?.USERNAME ?? '';
}

function readSavedSession(): SavedSession | null {
    try {
        return parseSession(window.localStorage.getItem(sessionKey(currentUser())));
    } catch {
        return null;
    }
}

const SHIFTS = [
    { id: '', label: 'None' },
    { id: '30m', label: '30 minutes before' },
    { id: '60m', label: '60 minutes before' },
    { id: '2h', label: '2 hours before' },
    { id: '24h', label: '24 hours before' },
    { id: '2d', label: '2 days before' },
    { id: '7d', label: '7 days before' },
    { id: 'custom', label: 'Custom' },
];

const RANGES = [
    { id: '-15m', label: 'Last 15 minutes' },
    { id: '-60m', label: 'Last 60 minutes' },
    { id: '-4h', label: 'Last 4 hours' },
    { id: '-24h', label: 'Last 24 hours' },
    { id: '-7d', label: 'Last 7 days' },
    { id: '-2d', label: 'Last 2 days' },
];

const Shell = styled.div<{ $left: boolean; $right: boolean }>`
    display: grid;
    grid-template-columns: ${(props) => (props.$left ? '260px' : '36px')} minmax(0, 1fr) ${(props) => (props.$right ? '280px' : '36px')};
    height: 100%;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 600;
`;

const Rail = styled.div<{ $edge: 'left' | 'right' }>`
    display: flex;
    justify-content: center;
    padding-top: 12px;
    background: ${variables.backgroundColorSidebar};
    ${(props) =>
        props.$edge === 'left'
            ? css`
                  border-right: 1px solid ${variables.neutral200};
              `
            : css`
                  border-left: 1px solid ${variables.neutral200};
              `}
`;

const IconButton = styled.button`
    border: 0;
    background: transparent;
    color: ${variables.contentColorDefault};
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
`;

const SearchBox = styled.input`
    margin: 0 12px 8px;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    font-size: 12px;
`;

const FilterBox = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0 12px 8px;
`;

const Chip = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 8px;
    border-radius: 12px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    font-size: 12px;
`;

const ChipRemove = styled.button`
    border: 0;
    background: transparent;
    color: ${variables.contentColorMuted};
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
`;

const FilterForm = styled.form`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    width: 100%;
`;

const FilterInput = styled.input`
    flex: 1 1 120px;
    min-width: 0;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
`;

const GroupRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 12px 8px;

    select {
        flex: 1 1 0;
        min-width: 0;
        font-size: 12px;
    }
`;

const SectionButton = styled.button`
    display: block;
    width: 100%;
    margin: 0;
    padding: 6px 12px;
    font-size: 12px;
    border: 0;
    border-top: 1px solid ${variables.neutral200};
    background: transparent;
    color: ${variables.contentColorDefault};
    text-align: left;
    cursor: pointer;
    font-weight: 600;
`;

const SectionItem = styled.button`
    display: block;
    width: 100%;
    padding: 4px 12px 4px 28px;
    border: 0;
    background: transparent;
    color: ${variables.contentColorDefault};
    text-align: left;
    cursor: pointer;
`;

const Tree = styled.div`
    overflow: auto;
    padding: 0 8px 12px;
`;

const AddButton = styled.button`
    position: absolute;
    right: 4px;
    top: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
`;

const Row = styled.div<{ $depth: number; $selected: boolean }>`
    position: relative;
    display: flex;
    align-items: center;
    border-radius: 4px;
    ${(props) =>
        props.$selected &&
        css`
            background: ${variables.interactiveColorOverlaySelected};
        `}
    &:hover {
        background: ${variables.interactiveColorOverlayHover};
    }
    &:hover ${AddButton},
    &:focus-within ${AddButton} {
        opacity: 1;
        pointer-events: auto;
    }
`;

const RowButton = styled.button<{ $depth: number }>`
    display: flex;
    width: 100%;
    text-align: left;
    gap: 6px;
    border: 0;
    border-radius: 4px;
    padding: 6px 28px 6px ${(props) => 8 + props.$depth * 14}px;
    background: transparent;
    color: ${variables.contentColorDefault};
    cursor: pointer;
`;

const SeriesHeader = styled.button<{ $open: boolean }>`
    display: flex;
    gap: 8px;
    width: 100%;
    margin: 0;
    padding: 6px 12px;
    text-align: left;
    border: 0;
    border-bottom: 1px solid ${variables.neutral200};
    border-radius: 0;
    background: transparent;
    color: ${variables.contentColorDefault};
    cursor: pointer;
    font-size: 12px;
    ${(props) =>
        props.$open &&
        css`
            background: ${variables.interactiveColorOverlayHover};
        `}
`;

const Stage = styled.main`
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
`;

const Toolbar = styled.div`
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: nowrap;
    padding: 6px 12px;
    border-bottom: 1px solid ${variables.neutral200};
    font-size: 12px;
    overflow-x: auto;

    select,
    input {
        font-size: 12px;
        padding: 4px 8px;
    }
`;

const Overflow = styled.div`
    position: relative;
    margin-left: auto;
`;

const OverflowMenu = styled.div`
    position: absolute;
    right: 0;
    top: 28px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 220px;
    padding: 8px;
    border: 1px solid ${variables.neutral200};
    border-radius: 4px;
    background: ${variables.backgroundColorSection};
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
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
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
    gap: 4px;
    padding: 8px 12px 0;
    font-size: 12px;
`;

const Select = styled.select`
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 4px;
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
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 4px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
`;

const Note = styled.p`
    margin: 4px 12px;
    color: ${variables.contentColorMuted};
    font-size: 12px;
`;

const TextLink = styled.button`
    border: 0;
    background: transparent;
    padding: 0;
    color: ${variables.contentColorActive};
    cursor: pointer;
    font-size: 12px;
    text-align: left;
`;

const SettingsFold = styled.details`
    margin-top: 8px;
    border-top: 1px solid ${variables.neutral200};

    > summary {
        cursor: pointer;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
    }
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
    selected: Set<string>;
    onToggle: (id: string) => void;
    onSelect: (metricName: string, filter?: MetricNode['filter']) => void;
    onAdd: (metricName: string, filter?: MetricNode['filter']) => void;
}): React.ReactElement {
    return (
        <>
            {props.nodes.map((node) => (
                <React.Fragment key={node.id}>
                    <Row
                        data-isfolder={node.folder}
                        data-metric={node.metricName ?? ''}
                        $depth={props.depth}
                        $selected={!node.folder && props.selected.has(node.metricName ?? '')}
                    >
                        <RowButton
                            type="button"
                            $depth={props.depth}
                            onClick={() => (node.folder ? props.onToggle(node.id) : props.onSelect(node.metricName ?? '', node.filter))}
                        >
                            <span>{node.folder ? (props.open.has(node.id) ? '▾' : '▸') : ''}</span>
                            <span>{node.label}</span>
                        </RowButton>
                        {node.folder ? null : (
                            <AddButton
                                type="button"
                                aria-label="Add to selected chart"
                                title="Add to selected chart"
                                onClick={() => props.onAdd(node.metricName ?? '', node.filter)}
                            >
                                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="M1 13V3M1 13h9" stroke="currentColor" fill="none" />
                                    <path d="M3 10l2.2-3 2 1.8L10 5" stroke="currentColor" fill="none" />
                                    <path d="M12 2v5M9.5 4.5h5" stroke="currentColor" />
                                </svg>
                            </AddButton>
                        )}
                    </Row>
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
    const [expandedSeriesId, setExpandedSeriesId] = useState('');
    const [leftOpen, setLeftOpen] = useState(true);
    const [rightOpen, setRightOpen] = useState(true);
    const [layout, setLayout] = useState<'stack' | 'grid'>('stack');
    /** A maximized chart fills the stage alone. Minimized charts show only their title row. Neither is saved. */
    const [maximizedId, setMaximizedId] = useState('');
    const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set());
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [refreshedAt, setRefreshedAt] = useState(0);
    const [dimensions, setDimensions] = useState<string[]>([]);
    const [allDimensions, setAllDimensions] = useState<string[]>([]);
    const [metricDims, setMetricDims] = useState<Record<string, string[]>>({});
    const [globalSplit, setGlobalSplit] = useState('');
    /** Filters for every chart. Each chart's own filters come after them. */
    const [globalFilters, setGlobalFilters] = useState<SeriesFilter[]>([]);
    const [globalDimension, setGlobalDimension] = useState('');
    const [globalMode, setGlobalMode] = useState<'include' | 'exclude'>('include');
    const [globalValues, setGlobalValues] = useState('');
    const [globalFilterError, setGlobalFilterError] = useState('');
    const [savedSession, setSavedSession] = useState<SavedSession | null>(() => readSavedSession());
    const [recovered, setRecovered] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [filterDimension, setFilterDimension] = useState('');
    const [filterMode, setFilterMode] = useState<'include' | 'exclude'>('include');
    const [filterChoices, setFilterChoices] = useState<string[]>([]);
    const [filterPicked, setFilterPicked] = useState<string[]>([]);
    const [customOpen, setCustomOpen] = useState(false);
    const [customText, setCustomText] = useState('');
    const [percentileMethod, setPercentileMethod] = useState<PercentileKind>('perc');
    const [sourceFields, setSourceFields] = useState<string[]>([]);
    const [saveMode, setSaveMode] = useState<SaveMode | null>(null);
    const [shiftCustom, setShiftCustom] = useState(false);
    const [shiftAmount, setShiftAmount] = useState('');
    const [shiftUnit, setShiftUnit] = useState<ShiftUnit>('h');
    const [spanCount, setSpanCount] = useState('');
    const [spanUnit, setSpanUnit] = useState('m');
    const [referenceOpen, setReferenceOpen] = useState(false);
    const [referenceKind, setReferenceKind] = useState<ReferenceLine['kind']>('aggregation');
    const [referenceValue, setReferenceValue] = useState('Avg');
    const [referenceLabel, setReferenceLabel] = useState('Avg');
    const [referenceInclude, setReferenceInclude] = useState(true);
    const [referenceRange, setReferenceRange] = useState('');
    const [referenceEarliestAmount, setReferenceEarliestAmount] = useState('7');
    const [referenceEarliestUnit, setReferenceEarliestUnit] = useState<ShiftUnit>('d');
    const [referenceLatestMode, setReferenceLatestMode] = useState<'now' | 'ago'>('now');
    const [referenceLatestAmount, setReferenceLatestAmount] = useState('1');
    const [referenceLatestUnit, setReferenceLatestUnit] = useState<ShiftUnit>('d');
    const [range, setRange] = useState('-60m');
    /** The end of the chart range. `now` for presets; a custom range can end at a fixed time. */
    const [latest, setLatest] = useState('now');
    const [customTime, setCustomTime] = useState(false);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [customTimeError, setCustomTimeError] = useState('');
    const [catalogRange, setCatalogRange] = useState('-2d');
    const [eventsOpen, setEventsOpen] = useState(false);
    const [datasetsOpen, setDatasetsOpen] = useState(false);
    const [sourcetypes, setSourcetypes] = useState<string[]>([]);
    const [sourcetypesReady, setSourcetypesReady] = useState(false);
    const [eventIndexes, setEventIndexes] = useState<string[]>([]);
    /** Metric indexes this user's Splunk ACL allows. Undefined until loaded, or when the lookup failed. */
    const [metricIndexes, setMetricIndexes] = useState<string[] | undefined>(undefined);
    const [metricIndexesReady, setMetricIndexesReady] = useState(false);
    const [datamodels, setDatamodels] = useState<string[]>([]);
    const [defaultFilters, setDefaultFilters] = useState<DataFilter[]>([]);
    const [groupBy, setGroupBy] = useState('metric_name');
    const [maxMetrics, setMaxMetrics] = useState(DEFAULT_MAX_METRICS);
    const [namesTruncated, setNamesTruncated] = useState(false);
    const [valuesTruncated, setValuesTruncated] = useState(false);
    const [separator, setSeparator] = useState('.');
    const [valueRows, setValueRows] = useState<ValueRow[]>([]);
    const [dataFilters, setDataFilters] = useState<DataFilter[]>([]);
    const [defaultsReady, setDefaultsReady] = useState(false);
    const [filterKind, setFilterKind] = useState<DataFilter['kind']>('exclude');
    const [filterText, setFilterText] = useState('');
    const [metricsOpen, setMetricsOpen] = useState(true);
    const [toolbarMore, setToolbarMore] = useState(false);
    const [dataFilterOpen, setDataFilterOpen] = useState(false);
    const [globalFilterOpen, setGlobalFilterOpen] = useState(false);
    const [percentileOpen, setPercentileOpen] = useState(false);
    const [filterError, setFilterError] = useState('');

    /** The series as its header shows it: a split only counts when the metric has that dimension. */
    function headerSeries(item: Series): Series {
        const split = resolveSplit(item, globalSplit, selected?.useGlobalSplit ?? true);
        const known = metricDims[item.metric];
        return { ...item, splitBy: known && split && !known.includes(split) ? '' : split };
    }

    /** Adds a filter for every chart. The values are typed as a comma separated list. */
    function addGlobalFilter(): void {
        const dimension = globalDimension.trim();
        const values = globalValues
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        if (!dimension) {
            setGlobalFilterError('Select a dimension.');
            return;
        }
        if (values.length === 0) {
            setGlobalFilterError('Enter at least one value.');
            return;
        }
        if (values.length > 50) {
            setGlobalFilterError('Use at most 50 values.');
            return;
        }
        const candidate: SeriesFilter = { dimension, mode: globalMode, values };
        if (!isSeriesFilter(candidate)) {
            setGlobalFilterError('Use letters, digits, dots, colons, dashes, and underscores. Values may not contain line breaks.');
            return;
        }
        if (globalFilters.some((item) => item.dimension === dimension && item.mode === globalMode && item.values.join(',') === values.join(','))) {
            setGlobalFilterError('This global filter is already active.');
            return;
        }
        setGlobalFilters((current) => [...current, candidate]);
        setGlobalValues('');
        setGlobalFilterError('');
        setGlobalFilterOpen(false);
    }

    function addDataFilter(): void {
        const candidate: DataFilter = { kind: filterKind, value: filterText.trim() };
        const problem = validateFilter(candidate);
        if (problem) {
            setFilterError(problem);
            return;
        }
        if (dataFilters.some((item) => item.kind === candidate.kind && item.value === candidate.value)) {
            setFilterError('This filter is already active.');
            return;
        }
        setDataFilters((current) => [...current, candidate]);
        setFilterText('');
        setFilterError('');
        setDataFilterOpen(false);
    }

    useEffect(() => {
        let alive = true;
        loadSettings()
            .catch(() => ({
                filters: [] as DataFilter[],
                hierarchySource: 'metric_name',
                hierarchySeparator: '.',
                maxMetrics: DEFAULT_MAX_METRICS,
            }))
            .then((settings) => {
                if (!alive) {
                    return;
                }
                // Only the controls are enabled after this point, so nothing the user adds is overwritten here.
                // An index from the URL replaces the default index filters, so the explorer opens on that index.
                const urlIndex = indexFromSearch(window.location.search);
                const start = urlIndex
                    ? [...settings.filters.filter((item) => item.kind !== 'index'), { kind: 'index' as const, value: urlIndex }]
                    : settings.filters;
                setDefaultFilters(settings.filters);
                setMaxMetrics(settings.maxMetrics);
                setDataFilters(start);
                setGroupBy(settings.hierarchySource);
                setSeparator(settings.hierarchySeparator);
                setDefaultsReady(true);
            });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        let alive = true;
        const get = async (path: string): Promise<unknown> => {
            const response = await fetch(`/splunkd/__raw${path}`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) {
                throw new Error(String(response.status));
            }
            return response.json() as unknown;
        };
        loadAllowedMetricIndexes(get)
            .then((names) => {
                if (alive) {
                    setMetricIndexes(names);
                    setMetricIndexesReady(true);
                }
            })
            .catch(() => {
                if (alive) {
                    setMetricIndexes(undefined);
                    setMetricIndexesReady(true);
                }
            });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (!defaultsReady || !metricIndexesReady) {
            return undefined;
        }
        setCatalogError('');
        setCatalogReady(false);
        return runSearch(
            buildCatalogSearch(dataFilters, '', metricIndexes),
            catalogRange,
            (payload) => {
                const limited = limitMetricNames(collectMetricNames(payload), maxMetrics);
                setNames(limited.names);
                setNamesTruncated(limited.truncated);
                setCatalogReady(true);
            },
            (message) => {
                setCatalogError(message);
                setCatalogReady(true);
            }
        );
    }, [catalogRange, dataFilters, defaultsReady, metricIndexes, metricIndexesReady]);

    useEffect(() => {
        if (charts.length === 0) {
            return;
        }
        const session = serializeSession(
            { charts, layout, range, latest, catalogRange, globalSplit, globalFilters },
            Date.now()
        );
        try {
            window.localStorage.setItem(sessionKey(currentUser()), session);
            setSavedSession(parseSession(session));
        } catch {
            // Storage can be full or disabled; the workspace still works without it.
        }
    }, [charts, layout, range, latest, catalogRange, globalSplit, globalFilters]);

    function applySession(saved: SavedSession): void {
        const revived = saved.charts.map(reviveChart);
        setCharts(revived);
        setSelectedId(revived[0]?.id ?? '');
        setSelectedSeriesId('');
        setExpandedSeriesId('');
        setLayout(saved.layout);
        setRange(saved.range);
        setLatest(saved.latest);
        const preset = RANGES.some((item) => item.id === saved.range) && saved.latest === 'now';
        setCustomTime(!preset);
        setCustomStart(boundForInput(saved.range));
        setCustomEnd(boundForInput(saved.latest));
        setCustomTimeError('');
        setCatalogRange(saved.catalogRange);
        setGlobalSplit(saved.globalSplit);
        setGlobalFilters(saved.globalFilters);
        setRecovered(false);
    }

    function openSaved(): void {
        if (!savedSession) {
            return;
        }
        applySession(savedSession);
        setRecovered(true);
    }

    useEffect(() => {
        const key = new URLSearchParams(window.location.search).get('workspace');
        if (!key) {
            return undefined;
        }
        let alive = true;
        splunkGet(`storage/collections/data/mx_workspaces/${encodeURIComponent(key)}`)
            .then((body) => {
                if (!alive || !body || typeof body !== 'object') {
                    return;
                }
                const state = (body as { state?: unknown }).state;
                const session = parseSession(typeof state === 'string' ? state : null);
                if (session) {
                    applySession(session);
                }
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (!metricIndexesReady) {
            return undefined;
        }
        setAllDimensions([]);
        return runSearch(
            buildAllDimensionSearch(metricIndexes),
            catalogRange,
            (payload) => setAllDimensions(collectFieldValues(payload, '_dims')),
            () => setAllDimensions([])
        );
    }, [catalogRange, metricIndexes, metricIndexesReady]);

    useEffect(() => {
        setValueRows([]);
        if (!defaultsReady || !metricIndexesReady || groupBy === 'metric_name') {
            return undefined;
        }
        return runSearch(
            buildCatalogSearch(dataFilters, groupBy, metricIndexes),
            catalogRange,
            (payload) => {
                const limited = limitValueRows(collectValueMetrics(payload, groupBy), maxMetrics);
                setValueRows(limited.rows);
                setValuesTruncated(limited.truncated);
            },
            () => setValueRows([])
        );
    }, [groupBy, dataFilters, catalogRange, defaultsReady, metricIndexes, metricIndexesReady]);

    useEffect(() => {
        if (!eventsOpen) {
            return undefined;
        }
        let alive = true;
        let stop = (): void => undefined;
        setSourcetypesReady(false);
        fetch('/splunkd/__raw/services/data/indexes?output_mode=json&count=0', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        })
            .then((response) => (response.ok ? response.json() : { entry: [] }))
            .then((body: { entry?: Array<{ name?: string; content?: { datatype?: string } }> }) => {
                if (!alive) {
                    return;
                }
                const indexes = (body.entry ?? [])
                    .filter((entry) => entry.content?.datatype !== 'metric')
                    .map((entry) => entry.name ?? '')
                    .filter((name) => /^[A-Za-z0-9_.-]+$/.test(name));
                setEventIndexes(indexes);
                stop = runSearch(
                    buildSourcetypeSearch(indexes),
                    catalogRange,
                    (payload) => {
                        setSourcetypes(collectFieldValues(payload, 'sourcetype'));
                        setSourcetypesReady(true);
                    },
                    () => {
                        setSourcetypes([]);
                        setSourcetypesReady(true);
                    }
                );
            })
            .catch(() => {
                if (alive) {
                    setSourcetypes([]);
                    setSourcetypesReady(true);
                }
            });
        return () => {
            alive = false;
            stop();
        };
    }, [eventsOpen, catalogRange]);

    useEffect(() => {
        if (!datasetsOpen) {
            return undefined;
        }
        let alive = true;
        fetch('/splunkd/__raw/services/datamodel/model?output_mode=json&count=0', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        })
            .then((response) => (response.ok ? response.json() : { entry: [] }))
            .then((body: { entry?: Array<{ name?: string }> }) => {
                if (!alive) {
                    return;
                }
                setDatamodels(
                    (body.entry ?? [])
                        .map((entry) => entry.name ?? '')
                        .filter((name) => /^[A-Za-z0-9_.:-]+$/.test(name))
                        .sort()
                );
            })
            .catch(() => {
                if (alive) {
                    setDatamodels([]);
                }
            });
        return () => {
            alive = false;
        };
    }, [datasetsOpen]);

    const tree = useMemo(
        () =>
            filterMetricTree(
                groupBy === 'metric_name' ? buildMetricTree(names, separator) : buildValueTree(groupBy, valueRows, separator),
                query
            ),
        [names, valueRows, groupBy, separator, query]
    );
    const selected = charts.find((chart) => chart.id === selectedId) ?? charts[0];
    const series = selected?.series.find((item) => item.id === selectedSeriesId) ?? selected?.series[0];

    useEffect(() => {
        const source = series?.source ?? 'metric';
        if (!series || (source !== 'event' && source !== 'dataset')) {
            setSourceFields([]);
            return undefined;
        }
        let search = '';
        try {
            search = buildFieldSearch(source, series.metric, eventIndexes);
        } catch {
            setSourceFields([]);
            return undefined;
        }
        return runSearch(
            search,
            catalogRange,
            (payload) => setSourceFields(readableFields(collectFieldValues(payload, 'field'))),
            () => setSourceFields([])
        );
    }, [series?.id, series?.source, series?.metric, catalogRange, eventIndexes]);
    const chosen = resolveForSource(series?.source, series?.aggregation ?? '');
    const span = spanForRange(range, latest);
    const selectedMetrics = new Set(selected?.series.map((item) => item.metric) ?? []);

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

    // Metric series of every chart. Their dimensions decide which global filters and splits apply to them.
    const chartMetricKey = [
        ...new Set(
            charts.flatMap((chart) =>
                chart.series.filter((item) => (item.source ?? 'metric') === 'metric').map((item) => item.metric)
            )
        ),
    ]
        .sort()
        .join('\n');

    useEffect(() => {
        // Dimensions of every metric in the charts, so each series names only splits its metric has and global filters skip the rest.
        const metrics = chartMetricKey ? chartMetricKey.split('\n') : [];
        const stops = metrics.map((metric) =>
            runSearch(
                buildDimensionSearch(metric, metricIndexes),
                range,
                (payload) =>
                    setMetricDims((current) => ({ ...current, [metric]: collectFieldValues(payload, '_dims') })),
                () => setMetricDims((current) => ({ ...current, [metric]: [] })),
                latest
            )
        );
        return () => stops.forEach((stop) => stop());
    }, [chartMetricKey, range, latest, metricIndexes]);

    useEffect(() => {
        setDimensions([]);
        if (!series?.metric) {
            return undefined;
        }
        try {
            return runSearch(
                buildDimensionSearch(series.metric, metricIndexes),
                range,
                (payload) => setDimensions(collectFieldValues(payload, '_dims')),
                () => setDimensions([]),
                latest
            );
        } catch {
            return undefined;
        }
    }, [series?.metric, range, latest, metricIndexes]);

    useEffect(() => {
        setFilterChoices([]);
        setFilterPicked([]);
        if (!filterOpen || !series?.metric || !filterDimension) {
            return undefined;
        }
        try {
            return runSearch(
                buildDimensionValueSearch(series.metric, filterDimension, metricIndexes),
                range,
                (payload) => setFilterChoices(collectFieldValues(payload, filterDimension)),
                () => setFilterChoices([]),
                latest
            );
        } catch {
            return undefined;
        }
    }, [filterOpen, series?.metric, filterDimension, range, latest, metricIndexes]);

    function refreshNow(): void {
        setRefreshToken((token) => token + 1);
        setRefreshedAt(Date.now());
    }

    function addChart(metricName: string, filter?: MetricNode['filter'], source: SeriesSource = 'metric'): void {
        const chart = createChart(metricName, seriesFilters(filter), source);
        setCharts((current) => [...current, chart]);
        setSelectedId(chart.id);
        setSelectedSeriesId(chart.series[0].id);
        setExpandedSeriesId('');
        refreshNow();
    }

    function addBaseChart(name: string, field: string, mode: 'live' | 'cached', owner: string): void {
        const chart = createChart(name, [], 'base');
        chart.series[0].field = field;
        chart.series[0].aggregation = 'Avg';
        chart.series[0].baseMode = mode;
        chart.series[0].baseOwner = owner;
        setCharts((current) => [...current, chart]);
        setSelectedId(chart.id);
        setSelectedSeriesId(chart.series[0].id);
        setExpandedSeriesId('');
        refreshNow();
    }

    function addToSelected(metricName: string, filter?: MetricNode['filter'], source: SeriesSource = 'metric'): void {
        if (!selected) {
            addChart(metricName, filter, source);
            return;
        }
        const created = createSeries(metricName, seriesFilters(filter), source);
        setCharts((current) =>
            current.map((chart) =>
                chart.id === selected.id ? { ...chart, series: [...chart.series, created] } : chart
            )
        );
        setSelectedSeriesId(created.id);
        setExpandedSeriesId('');
    }

    function toggleSeries(id: string): void {
        setSelectedSeriesId(id);
        setExpandedSeriesId((current) => (current === id ? '' : id));
    }

    function patchChart(patch: Partial<Pick<ChartModel, 'useGlobalSplit'>>): void {
        if (!selected) {
            return;
        }
        setCharts((current) => current.map((chart) => (chart.id === selected.id ? { ...chart, ...patch } : chart)));
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

    const parsedPercentile = series ? parsePercentile(series.aggregation) : null;
    const isPreset = parsedPercentile !== null && (PERCENTILE_PRESETS as readonly string[]).includes(parsedPercentile.value);
    const percentilePreset = customOpen || (parsedPercentile && !isPreset) ? 'custom' : parsedPercentile ? parsedPercentile.value : '';
    const percentileKind = parsedPercentile?.kind ?? percentileMethod;
    const customValue = customOpen ? customText : (parsedPercentile?.value ?? customText);
    const customError =
        percentilePreset === 'custom' && customValue !== '' && !isPercentText(customValue)
            ? 'Enter a percentile from 0 to below 100 with up to three decimals.'
            : '';

    function choosePercentilePreset(value: string): void {
        if (!series) {
            return;
        }
        if (value === 'custom') {
            setCustomOpen(true);
            setCustomText(parsedPercentile?.value ?? customText);
            return;
        }
        setCustomOpen(false);
        patchSeries({ aggregation: `${percentileKind}${value}` });
    }

    function changePercentileMethod(kind: PercentileKind): void {
        setPercentileMethod(kind);
        if (series && parsedPercentile) {
            patchSeries({ aggregation: `${kind}${parsedPercentile.value}` });
        }
    }

    function changeCustomPercentile(text: string): void {
        setCustomText(text);
        if (series && isPercentText(text)) {
            patchSeries({ aggregation: `${percentileKind}${text.trim()}` });
        }
    }

    const parsedShift = series ? parseTimeShift(series.timeShift) : null;
    const shiftIsPreset = !series || SHIFTS.some((item) => item.id === series.timeShift);
    const shiftSelect = shiftCustom || (series && series.timeShift && !shiftIsPreset) ? 'custom' : (series?.timeShift ?? '');
    const shiftFieldAmount = shiftCustom ? shiftAmount : parsedShift ? String(parsedShift.amount) : shiftAmount;
    const shiftFieldUnit: ShiftUnit = shiftCustom ? shiftUnit : (parsedShift?.unit ?? shiftUnit);
    const shiftError =
        shiftSelect === 'custom' && shiftFieldAmount.trim() !== '' && !timeShiftToken(shiftFieldAmount, shiftFieldUnit)
            ? /^\d+$/.test(shiftFieldAmount.trim())
                ? 'Enter a smaller time shift.'
                : 'Time shift must be a numeric value.'
            : '';

    function chooseShift(value: string): void {
        if (!series) {
            return;
        }
        if (value === 'custom') {
            const parsed = parseTimeShift(series.timeShift);
            setShiftCustom(true);
            setShiftAmount(parsed ? String(parsed.amount) : shiftAmount);
            setShiftUnit(parsed?.unit ?? shiftUnit);
            return;
        }
        setShiftCustom(false);
        patchSeries({ timeShift: value });
    }

    function changeShiftAmount(text: string): void {
        setShiftCustom(true);
        setShiftAmount(text);
        const token = timeShiftToken(text, shiftUnit);
        if (token) {
            patchSeries({ timeShift: token });
        }
    }

    function changeShiftUnit(unit: ShiftUnit): void {
        const amount = shiftCustom ? shiftAmount : parsedShift ? String(parsedShift.amount) : shiftAmount;
        setShiftCustom(true);
        setShiftUnit(unit);
        setShiftAmount(amount);
        const token = timeShiftToken(amount, unit);
        if (token) {
            patchSeries({ timeShift: token });
        }
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

    const referenceEarliestToken = timeShiftToken(referenceEarliestAmount, referenceEarliestUnit);
    const referenceLatestToken = referenceLatestMode === 'now' ? 'now' : timeShiftToken(referenceLatestAmount, referenceLatestUnit);
    const referenceBounds =
        referenceKind !== 'aggregation' || referenceRange === ''
            ? null
            : referenceRange === 'custom'
              ? referenceEarliestToken && referenceLatestToken
                  ? referenceWindow(`-${referenceEarliestToken}`, referenceLatestToken === 'now' ? 'now' : `-${referenceLatestToken}`)
                  : null
              : referenceWindow(referenceRange, 'now');
    const referenceError =
        referenceKind === 'aggregation' && referenceRange !== '' && !referenceBounds
            ? 'Enter a time range that starts before it ends.'
            : '';

    return (
        <Shell $left={leftOpen} $right={rightOpen}>
            {leftOpen ? (
            <Pane>
                <PaneHeader>
                    <span>{t('Data')}</span>
                    <IconButton type="button" aria-label={t('Hide data')} onClick={() => setLeftOpen(false)}>
                        «
                    </IconButton>
                </PaneHeader>
                <SearchBox
                    value={query}
                    placeholder={t('Search data to analyze')}
                    aria-label={t('Search data to analyze')}
                    onChange={(event) => setQuery(event.target.value)}
                />
                <SectionButton type="button" aria-expanded={metricsOpen} onClick={() => setMetricsOpen((open) => !open)}>
                    {metricsOpen ? '▾' : '▸'} {t('Metrics')}
                </SectionButton>
                {metricsOpen ? (
                <>
                <FilterBox aria-label="Data filters">
                    {dataFilters.map((filter) => (
                        <Chip key={`${filter.kind}:${filter.value}`}>
                            {filterLabel(filter)}
                            <ChipRemove
                                type="button"
                                aria-label={`Remove filter ${filterLabel(filter)}`}
                                disabled={!defaultsReady}
                                onClick={() => setDataFilters((current) => current.filter((item) => item !== filter))}
                            >
                                ×
                            </ChipRemove>
                        </Chip>
                    ))}
                    {sameFilters(dataFilters, defaultFilters) ? null : (
                        <TextLink type="button" disabled={!defaultsReady} onClick={() => setDataFilters(defaultFilters)}>
                            {t('Reset to defaults')}
                        </TextLink>
                    )}
                    {dataFilterOpen ? (
                        <FilterForm
                            onSubmit={(event) => {
                                event.preventDefault();
                                addDataFilter();
                            }}
                        >
                            <Select
                                aria-label={t('New filter type')}
                                disabled={!defaultsReady}
                                value={filterKind}
                                onChange={(event) => setFilterKind(event.target.value === 'index' ? 'index' : 'exclude')}
                            >
                                <option value="exclude">{t('Metric name not')}</option>
                                <option value="index">Index</option>
                            </Select>
                            <FilterInput
                                aria-label={t('New filter value')}
                                disabled={!defaultsReady}
                                value={filterText}
                                placeholder={filterKind === 'index' ? 'e.g. metrics_lab' : 'e.g. itsi.*'}
                                onChange={(event) => setFilterText(event.target.value)}
                            />
                            <TextLink type="submit" disabled={!defaultsReady}>
                                {t('Add')}
                            </TextLink>
                            <TextLink type="button" onClick={() => setDataFilterOpen(false)}>
                                {t('Cancel')}
                            </TextLink>
                        </FilterForm>
                    ) : (
                        <TextLink type="button" disabled={!defaultsReady} onClick={() => setDataFilterOpen(true)}>
                            {t('+ Add new filter')}
                        </TextLink>
                    )}
                    {filterError ? <Note role="alert">{filterError}</Note> : null}
                </FilterBox>
                <GroupRow>
                    <Select
                        aria-label={t('Group by')}
                        value={groupBy}
                        onChange={(event) => {
                            setGroupBy(event.target.value);
                            setOpen(new Set());
                        }}
                    >
                        <option value="metric_name">{t('Group by name')}</option>
                        <option value="index">{t('Group by index')}</option>
                        {splitChoices(
                            allDimensions.filter((name) => name !== 'metric_name' && name !== 'index'),
                            groupBy === 'metric_name' || groupBy === 'index' ? '' : groupBy
                        ).map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </Select>
                    <Select
                        aria-label={t('Group separator')}
                        value={separator}
                        onChange={(event) => {
                            setSeparator(event.target.value);
                            setOpen(new Set());
                        }}
                    >
                        {HIERARCHY_SEPARATORS.map((item) => (
                            <option key={item} value={item}>
                                {item}
                            </option>
                        ))}
                    </Select>
                </GroupRow>
                <Tree>
                    {catalogError ? <Note>{catalogError}</Note> : null}
                    {catalogReady && !catalogError && tree.length === 0 ? (
                        <Note>{t('No metrics in this time range.')}</Note>
                    ) : null}
                    {catalogReady && !catalogError && (groupBy === 'metric_name' ? namesTruncated : valuesTruncated) ? (
                        <Note role="status">
                            Not all metrics listed. Only the first {maxMetrics} are shown. Narrow the data filters or raise max_metrics.
                        </Note>
                    ) : null}
                    <TreeRows
                        nodes={tree}
                        depth={0}
                        open={open}
                        selected={selectedMetrics}
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
                </>
                ) : null}
                <SectionButton type="button" aria-expanded={eventsOpen} onClick={() => setEventsOpen((open) => !open)}>
                    {eventsOpen ? '▾' : '▸'} {t('Events')}
                </SectionButton>
                {eventsOpen
                    ? sourcetypes.map((name) => (
                          <SectionItem key={name} type="button" onClick={() => addChart(name, undefined, 'event')}>
                              {name}
                          </SectionItem>
                      ))
                    : null}
                {eventsOpen && sourcetypesReady && sourcetypes.length === 0 ? <Note>{t('No sourcetypes in this time range.')}</Note> : null}
                <SectionButton type="button" aria-expanded={datasetsOpen} onClick={() => setDatasetsOpen((open) => !open)}>
                    {datasetsOpen ? '▾' : '▸'} {t('Datasets')}
                </SectionButton>
                {datasetsOpen
                    ? datamodels.map((name) => (
                          <SectionItem key={name} type="button" onClick={() => addChart(name, undefined, 'dataset')}>
                              {name}
                          </SectionItem>
                      ))
                    : null}
                {datasetsOpen && datamodels.length === 0 ? <Note>{t('No data models.')}</Note> : null}
                <DataLists catalogRange={catalogRange} onAddBase={addBaseChart} />
                <Footer>
                    {t('Data ingested from')}{' '}
                    <select
                        aria-label={t('Catalog time range')}
                        value={catalogRange}
                        onChange={(event) => setCatalogRange(event.target.value)}
                    >
                        {RANGES.map((item) => (
                            <option key={item.id} value={item.id}>
                                {t(item.label)}
                            </option>
                        ))}
                    </select>
                    <div>{t('Changing this time setting will affect performance.')}</div>
                </Footer>
            </Pane>
            ) : (
                <Rail $edge="left">
                    <IconButton type="button" aria-label={t('Show data')} onClick={() => setLeftOpen(true)}>
                        »
                    </IconButton>
                </Rail>
            )}
            <Stage>
                <Toolbar>
                    <select
                        aria-label={t('Time range')}
                        value={customTime ? 'custom' : range}
                        onChange={(event) => {
                            if (event.target.value === 'custom') {
                                setCustomTime(true);
                                setCustomStart(boundForInput(range));
                                setCustomEnd(boundForInput(latest));
                                return;
                            }
                            setCustomTime(false);
                            setCustomTimeError('');
                            setRange(event.target.value);
                            setLatest('now');
                        }}
                    >
                        {RANGES.map((item) => (
                            <option key={item.id} value={item.id}>
                                {t(item.label)}
                            </option>
                        ))}
                        <option value="custom">{t('Custom…')}</option>
                    </select>
                    {customTime ? (
                        <>
                            <TextInput
                                aria-label={t('Custom time range start')}
                                placeholder="-7d or 2026-11-06 14:00"
                                value={customStart}
                                onChange={(event) => setCustomStart(event.target.value)}
                            />
                            <TextInput
                                aria-label={t('Custom time range end')}
                                placeholder="now or 2026-11-06 18:00"
                                value={customEnd}
                                onChange={(event) => setCustomEnd(event.target.value)}
                            />
                            <ToolButton
                                type="button"
                                onClick={() => {
                                    const result = customRange(customStart, customEnd, Date.now() / 1000);
                                    if ('error' in result) {
                                        setCustomTimeError(result.error);
                                        return;
                                    }
                                    setCustomTimeError('');
                                    setRange(result.earliest);
                                    setLatest(result.latest);
                                }}
                            >
                                {t('Apply time range')}
                            </ToolButton>
                            {customTimeError ? <Note role="alert">{customTimeError}</Note> : null}
                        </>
                    ) : null}
                    <ToolButton type="button" aria-label={t('Refresh chart data')} onClick={refreshNow} disabled={charts.length === 0}>
                        {charts.length > 0 ? (
                            <>
                                {t('Refresh')} <RefreshLabel refreshedAt={refreshedAt} auto={autoRefresh} />
                            </>
                        ) : (
                            '↻'
                        )}
                    </ToolButton>
                    <ToolButton type="button" aria-label={t('Grid layout')} aria-pressed={layout === 'grid'} $pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
                        ▦
                    </ToolButton>
                    <ToolButton type="button" aria-label={t('Stack layout')} aria-pressed={layout === 'stack'} $pressed={layout === 'stack'} onClick={() => setLayout('stack')}>
                        ☰
                    </ToolButton>
                    {charts.length > 0 ? (
                        <>
                            <span>{t('Time span')}={span}</span>
                            <Select
                                aria-label={t('Global split by')}
                                value={globalSplit}
                                onChange={(event) => setGlobalSplit(event.target.value)}
                            >
                                <option value="">{t('Split By')}</option>
                                {splitChoices(allDimensions, globalSplit).map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Select>
                            {globalSplit ? (
                                <ToolButton type="button" onClick={() => setGlobalSplit('')}>
                                    {t('Clear Split By')}
                                </ToolButton>
                            ) : null}
                            <ToolButton
                                type="button"
                                onClick={() => {
                                    setCharts([]);
                                    setSelectedId('');
                                    setMaximizedId('');
                                    setMinimizedIds(new Set());
                                }}
                            >
                                {t('Remove all')}
                            </ToolButton>
                        </>
                    ) : null}
                    <Overflow>
                        <ToolButton type="button" aria-label={t('More actions')} aria-expanded={toolbarMore} onClick={() => setToolbarMore((open) => !open)}>
                            ⋯
                        </ToolButton>
                        {toolbarMore ? (
                            <OverflowMenu>
                                <Select
                                    aria-label={t('Auto-refresh')}
                                    value={autoRefresh ? 'on' : 'off'}
                                    onChange={(event) => {
                                        const enabled = event.target.value === 'on';
                                        setAutoRefresh(enabled);
                                        if (enabled) {
                                            refreshNow();
                                        }
                                    }}
                                >
                                    <option value="off">{t('Auto-refresh off')}</option>
                                    <option value="on">{t('Auto-refresh on')}</option>
                                </Select>
                                <ToolButton type="button" onClick={() => { setToolbarMore(false); setSaveMode('workspace'); }}>
                                    {t('Workspaces')}
                                </ToolButton>
                                <ToolButton type="button" disabled={charts.length === 0} onClick={() => { setToolbarMore(false); setSaveMode('all'); }}>
                                    {t('Save all charts')}
                                </ToolButton>
                            </OverflowMenu>
                        ) : null}
                    </Overflow>
                </Toolbar>
                {charts.length > 0 || globalFilters.length > 0 ? (
                <FilterBox aria-label={t('Global filters')}>
                    {globalFilters.map((filter) => (
                        <Chip key={`${filter.dimension}:${filter.mode}:${filter.values.join(',')}`}>
                            {filter.dimension} {filter.mode === 'include' ? 'includes' : 'excludes'} {filter.values.join(', ')}
                            <ChipRemove
                                type="button"
                                aria-label={`Remove global filter ${filter.dimension}`}
                                onClick={() => setGlobalFilters((current) => current.filter((item) => item !== filter))}
                            >
                                ×
                            </ChipRemove>
                        </Chip>
                    ))}
                    {globalFilterOpen ? (
                        <FilterForm
                            onSubmit={(event) => {
                                event.preventDefault();
                                addGlobalFilter();
                            }}
                        >
                            <Select
                                aria-label={t('Global filter dimension')}
                                value={globalDimension}
                                onChange={(event) => setGlobalDimension(event.target.value)}
                            >
                                <option value="">{t('Select a dimension')}</option>
                                {allDimensions.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Select>
                            <Select
                                aria-label={t('Global filter mode')}
                                value={globalMode}
                                onChange={(event) => setGlobalMode(event.target.value === 'exclude' ? 'exclude' : 'include')}
                            >
                                <option value="include">{t('Include')}</option>
                                <option value="exclude">{t('Exclude')}</option>
                            </Select>
                            <FilterInput
                                aria-label={t('Global filter values')}
                                value={globalValues}
                                placeholder={t('Values, comma separated')}
                                onChange={(event) => setGlobalValues(event.target.value)}
                            />
                            <TextLink type="submit">{t('Add')}</TextLink>
                            <TextLink type="button" onClick={() => setGlobalFilterOpen(false)}>
                                {t('Cancel')}
                            </TextLink>
                        </FilterForm>
                    ) : (
                        <TextLink type="button" onClick={() => setGlobalFilterOpen(true)}>
                            {t('+ Add global filter')}
                        </TextLink>
                    )}
                    {globalFilterError ? <Note role="alert">{globalFilterError}</Note> : null}
                </FilterBox>
                ) : null}
                {recovered && charts.length > 0 ? (
                    <Note role="status">
                        {t('Your work has been recovered.')}{' '}
                        <ToolButton type="button" onClick={() => setRecovered(false)}>
                            {t('Dismiss')}
                        </ToolButton>
                    </Note>
                ) : null}
                {charts.length === 0 ? (
                    <Empty>
                        {savedSession ? (
                            <>
                                <h1>{t("Let's bring you up to speed!")}</h1>
                                <p>{t('Open your latest charts, or start by selecting data.')}</p>
                                <ToolButton type="button" onClick={openSaved}>
                                    {t('Open Charts')}
                                </ToolButton>
                            </>
                        ) : (
                            <>
                                <h1>{t('Start by selecting data.')}</h1>
                                <p>{t('Find something interesting? Save it to a dashboard, or create an alert.')}</p>
                            </>
                        )}
                    </Empty>
                ) : (
                    <ChartList $grid={layout === 'grid' && !maximizedId} data-layout={layout}>
                        {(maximizedId ? charts.filter((chart) => chart.id === maximizedId) : charts).map((chart) => (
                            <ChartView
                                key={chart.id}
                                chart={chart}
                                minimized={minimizedIds.has(chart.id)}
                                maximized={chart.id === maximizedId}
                                onMinimize={() =>
                                    setMinimizedIds((current) => {
                                        const next = new Set(current);
                                        if (next.has(chart.id)) {
                                            next.delete(chart.id);
                                        } else {
                                            next.add(chart.id);
                                        }
                                        return next;
                                    })
                                }
                                onMaximize={() => setMaximizedId((current) => (current === chart.id ? '' : chart.id))}
                                range={range}
                                latest={latest}
                                span={span}
                                refreshToken={refreshToken}
                                globalSplit={globalSplit}
                                globalFilters={globalFilters}
                                metricDims={metricDims}
                                eventIndexes={eventIndexes}
                                metricIndexes={metricIndexes}
                                selected={chart.id === selected?.id}
                                onSelect={() => setSelectedId(chart.id)}
                                onRemove={() => {
                                    setCharts((current) => current.filter((item) => item.id !== chart.id));
                                    setMaximizedId((current) => (current === chart.id ? '' : current));
                                    if (selected?.id === chart.id) {
                                        setSelectedId('');
                                    }
                                }}
                                onClone={() => {
                                    const copy = cloneChart(chart);
                                    setCharts((current) => [...current, copy]);
                                    setSelectedId(copy.id);
                                }}
                                onWidenSpan={(next) =>
                                    setCharts((current) =>
                                        current.map((item) =>
                                            item.id === chart.id ? { ...item, settings: { ...item.settings, span: next } } : item
                                        )
                                    )
                                }
                                onSave={(mode) => {
                                    setSelectedId(chart.id);
                                    setSaveMode(mode);
                                }}
                            />
                        ))}
                    </ChartList>
                )}
            </Stage>
            {rightOpen ? (
            <Analysis>
                <PaneHeader>
                    {t('Analysis')}
                    <IconButton type="button" aria-label={t('Hide analysis')} onClick={() => setRightOpen(false)}>
                        »
                    </IconButton>
                </PaneHeader>
                {(selected?.series ?? []).map((item) => (
                    <SeriesHeader
                        key={item.id}
                        type="button"
                        $open={item.id === expandedSeriesId}
                        aria-expanded={item.id === expandedSeriesId}
                        aria-label={`Settings for ${item.metric}`}
                        onClick={() => toggleSeries(item.id)}
                    >
                        <span>{item.id === expandedSeriesId ? '▾' : '▸'}</span>
                        <span>
                            {item.metric}
                            <br />
                            {seriesLegend(
                                headerSeries(item),
                                (selected?.series ?? []).map(headerSeries)
                            )}
                        </span>
                    </SeriesHeader>
                ))}
                {!series || series.id !== expandedSeriesId ? null : (
                    <>
                        <Field>
                            Aggregation
                            <TextInput
                                aria-label="Aggregation"
                                list="metric-aggregations"
                                value={series.aggregation}
                                onChange={(event) => {
                                    const aggregation = event.target.value;
                                    const next = resolveForSource(series.source, aggregation);
                                    patchSeries({ aggregation });
                                    if (next?.chart === 'table' && selected.settings.content === 'chart') {
                                        const othersPlot = selected.series.some(
                                            (item) =>
                                                item.id !== series.id &&
                                                resolveForSource(item.source, item.aggregation)?.chart !== 'table'
                                        );
                                        patchSettings({ content: othersPlot ? 'both' : 'table' });
                                    }
                                }}
                            />
                            <datalist id="metric-aggregations">
                                {functionsFor(series.source ?? 'metric').map((item) => (
                                    <option key={item.name} value={item.label} />
                                ))}
                            </datalist>
                            <span>{t('Select or type an aggregation.')}</span>
                            {(series.source ?? 'metric') !== 'metric' && needsField(chosen?.name ?? '') ? (
                                <>
                                    <TextInput
                                        aria-label={t('Event field')}
                                        value={series.field}
                                        list="source-fields"
                                        placeholder={t('Indexed field, for example bytes')}
                                        onChange={(event) => patchSeries({ field: event.target.value.trim() })}
                                    />
                                    <datalist id="source-fields">
                                        {sourceFields.map((name) => (
                                            <option key={name} value={name} />
                                        ))}
                                    </datalist>
                                </>
                            ) : null}
                            {chosen?.rate ? <Note>{rateExplanation(chosen.name)}</Note> : null}
                            <span>
                                <input
                                    type="checkbox"
                                    aria-label={t('Overlay on right axis')}
                                    checked={series.overlay}
                                    onChange={(event) => patchSeries({ overlay: event.target.checked })}
                                />{' '}
                                {t('Overlay on right axis')}
                            </span>
                        </Field>
                        {percentileOpen || percentilePreset !== '' ? (
                        <Field>
                            {t('Percentile')}
                            <Select
                                aria-label={t('Percentile')}
                                value={percentilePreset}
                                onChange={(event) => choosePercentilePreset(event.target.value)}
                            >
                                <option value="" disabled>
                                    {t('Not selected')}
                                </option>
                                {PERCENTILE_PRESETS.map((value) => (
                                    <option key={value} value={value}>
                                        {`p${value}`}
                                    </option>
                                ))}
                                <option value="custom">{t('Custom')}</option>
                            </Select>
                            {percentilePreset !== '' ? (
                                <Select
                                    aria-label={t('Percentile method')}
                                    value={percentileKind}
                                    onChange={(event) =>
                                        changePercentileMethod(
                                            event.target.value === 'upperperc' || event.target.value === 'exactperc'
                                                ? event.target.value
                                                : 'perc'
                                        )
                                    }
                                >
                                    {percentileMethods(series.source ?? 'metric').map((kind) => (
                                        <option key={kind} value={kind}>
                                            {kind === 'upperperc'
                                                ? 'Upper bound (upperperc)'
                                                : kind === 'exactperc'
                                                  ? t('Exact (exactperc)')
                                                  : 'Approximate (perc)'}
                                        </option>
                                    ))}
                                </Select>
                            ) : null}
                            {percentilePreset === 'custom' ? (
                                <TextInput
                                    aria-label={t('Custom percentile')}
                                    inputMode="decimal"
                                    placeholder={t('0 to 99.999')}
                                    value={customValue}
                                    onChange={(event) => changeCustomPercentile(event.target.value)}
                                />
                            ) : null}
                            {customError ? <span role="alert">{customError}</span> : null}
                        </Field>
                        ) : (
                            <Field>
                                <TextLink type="button" onClick={() => setPercentileOpen(true)}>
                                    {t('Percentile')}
                                </TextLink>
                            </Field>
                        )}
                        <Field>
                            {t('Split by')}
                            <Select
                                aria-label={t('Split by')}
                                value={series.splitBy}
                                onChange={(event) => patchSeries({ splitBy: event.target.value })}
                            >
                                <option value={INHERIT_SPLIT}>Inherit Global Split By</option>
                                <option value="">{t('None')}</option>
                                {splitChoices(
                                    (series.source ?? 'metric') === 'metric' ? dimensions : sourceFields,
                                    series.splitBy === INHERIT_SPLIT ? '' : series.splitBy
                                ).map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Select>
                            {resolveSplit(series, globalSplit, selected.useGlobalSplit) ? (
                                <SplitRow>
                                    <Select
                                        aria-label={t('Split limit type')}
                                        value={series.splitDirection}
                                        onChange={(event) =>
                                            patchSeries({
                                                splitDirection: event.target.value === 'lowest' ? 'lowest' : 'highest',
                                            })
                                        }
                                    >
                                        <option value="highest">{t('Highest')}</option>
                                        <option value="lowest">{t('Lowest')}</option>
                                    </Select>
                                    <Select
                                        aria-label={t('Split limit')}
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
                            {t('Time shift')}
                            <Select aria-label={t('Time shift')} value={shiftSelect} onChange={(event) => chooseShift(event.target.value)}>
                                {SHIFTS.map((item) => (
                                    <option key={item.id || 'none'} value={item.id}>
                                        {item.label}
                                    </option>
                                ))}
                            </Select>
                            {shiftSelect === 'custom' ? (
                                <SplitRow>
                                    <TextInput
                                        aria-label={t('Custom time shift')}
                                        inputMode="numeric"
                                        placeholder={t('Number')}
                                        value={shiftFieldAmount}
                                        onChange={(event) => changeShiftAmount(event.target.value)}
                                    />
                                    <Select
                                        aria-label={t('Time shift unit')}
                                        value={shiftFieldUnit}
                                        onChange={(event) => changeShiftUnit(event.target.value as ShiftUnit)}
                                    >
                                        {SHIFT_UNITS.map((unit) => (
                                            <option key={unit.id} value={unit.id}>
                                                {unit.label}
                                            </option>
                                        ))}
                                    </Select>
                                </SplitRow>
                            ) : null}
                            {shiftError ? <span role="alert">{shiftError}</span> : null}
                        </Field>
                        <Field>
                            Filter
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
                                        {t('Remove')}
                                    </button>
                                </SplitRow>
                            ))}
                            {filterOpen ? (
                                <>
                                    <Select
                                        aria-label={t('Filter dimension')}
                                        value={filterDimension}
                                        onChange={(event) => setFilterDimension(event.target.value)}
                                    >
                                        <option value="">{t('Select a dimension')}</option>
                                        {dimensions.map((name) => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                    </Select>
                                    <Select
                                        aria-label={t('Filter mode')}
                                        value={filterMode}
                                        onChange={(event) =>
                                            setFilterMode(event.target.value === 'exclude' ? 'exclude' : 'include')
                                        }
                                    >
                                        <option value="include">{t('Include')}</option>
                                        <option value="exclude">{t('Exclude')}</option>
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
                                            {t('Add')}
                                        </button>
                                        <button type="button" onClick={() => setFilterOpen(false)}>
                                            {t('Cancel')}
                                        </button>
                                    </SplitRow>
                                </>
                            ) : (
                                <button type="button" onClick={() => setFilterOpen(true)}>
                                    {t('Add filter')}
                                </button>
                            )}
                        </Field>
                        <Field>
                            {t('Reference lines')}
                            {series.referenceLines.map((line, index) => (
                                <SplitRow key={`${line.kind}-${line.label}-${line.earliest ?? ''}-${index}`}>
                                    <span>{referenceSummary(line)}</span>
                                    <button
                                        type="button"
                                        aria-label={`Remove reference line ${line.label || line.value}`}
                                        onClick={() =>
                                            patchSeries({
                                                referenceLines: series.referenceLines.filter((_, itemIndex) => itemIndex !== index),
                                            })
                                        }
                                    >
                                        {t('Remove')}
                                    </button>
                                </SplitRow>
                            ))}
                            {referenceOpen ? (
                                <>
                                    <Select
                                        aria-label={t('Reference calculation')}
                                        value={referenceKind}
                                        onChange={(event) => {
                                            const kind = event.target.value === 'constant' ? 'constant' : 'aggregation';
                                            setReferenceKind(kind);
                                            setReferenceValue(kind === 'constant' ? '' : 'Avg');
                                            setReferenceLabel(kind === 'constant' ? '' : 'Avg');
                                        }}
                                    >
                                        <option value="aggregation">{t('Raw data')}</option>
                                        <option value="constant">{t('Constant value')}</option>
                                    </Select>
                                    <TextInput
                                        aria-label={t('Reference value')}
                                        value={referenceValue}
                                        placeholder={referenceKind === 'constant' ? '25' : 'Avg'}
                                        onChange={(event) => setReferenceValue(event.target.value)}
                                    />
                                    <TextInput
                                        aria-label={t('Reference label')}
                                        value={referenceLabel}
                                        placeholder={t('Label')}
                                        onChange={(event) => setReferenceLabel(event.target.value)}
                                    />
                                    <span>
                                        <input
                                            type="checkbox"
                                            aria-label={t('Include value')}
                                            checked={referenceInclude}
                                            onChange={(event) => setReferenceInclude(event.target.checked)}
                                        />{' '}
                                        {t('Include value')}
                                    </span>
                                    {referenceKind === 'aggregation' ? (
                                        <>
                                            <Select
                                                aria-label={t('Reference line time range')}
                                                value={referenceRange}
                                                onChange={(event) => setReferenceRange(event.target.value)}
                                            >
                                                <option value="">{t('Chart')}</option>
                                                {RANGES.map((item) => (
                                                    <option key={item.id} value={item.id}>
                                                        {item.label}
                                                    </option>
                                                ))}
                                                <option value="custom">{t('Custom')}</option>
                                            </Select>
                                            {referenceRange === 'custom' ? (
                                                <>
                                                    <SplitRow>
                                                        <TextInput
                                                            aria-label={t('Reference earliest')}
                                                            inputMode="numeric"
                                                            value={referenceEarliestAmount}
                                                            onChange={(event) => setReferenceEarliestAmount(event.target.value)}
                                                        />
                                                        <Select
                                                            aria-label={t('Reference earliest unit')}
                                                            value={referenceEarliestUnit}
                                                            onChange={(event) => setReferenceEarliestUnit(event.target.value as ShiftUnit)}
                                                        >
                                                            {SHIFT_UNITS.map((unit) => (
                                                                <option key={unit.id} value={unit.id}>
                                                                    {unit.label}
                                                                </option>
                                                            ))}
                                                        </Select>
                                                    </SplitRow>
                                                    <SplitRow>
                                                        <Select
                                                            aria-label={t('Reference latest')}
                                                            value={referenceLatestMode}
                                                            onChange={(event) => setReferenceLatestMode(event.target.value === 'ago' ? 'ago' : 'now')}
                                                        >
                                                            <option value="now">{t('Now')}</option>
                                                            <option value="ago">{t('Ago')}</option>
                                                        </Select>
                                                        {referenceLatestMode === 'ago' ? (
                                                            <>
                                                                <TextInput
                                                                    aria-label={t('Reference latest amount')}
                                                                    inputMode="numeric"
                                                                    value={referenceLatestAmount}
                                                                    onChange={(event) => setReferenceLatestAmount(event.target.value)}
                                                                />
                                                                <Select
                                                                    aria-label={t('Reference latest unit')}
                                                                    value={referenceLatestUnit}
                                                                    onChange={(event) => setReferenceLatestUnit(event.target.value as ShiftUnit)}
                                                                >
                                                                    {SHIFT_UNITS.map((unit) => (
                                                                        <option key={unit.id} value={unit.id}>
                                                                            {unit.label}
                                                                        </option>
                                                                    ))}
                                                                </Select>
                                                            </>
                                                        ) : null}
                                                    </SplitRow>
                                                </>
                                            ) : null}
                                            {referenceError ? <span role="alert">{referenceError}</span> : null}
                                        </>
                                    ) : null}
                                    <SplitRow>
                                        <button
                                            type="button"
                                            disabled={!referenceValueReady(referenceKind, referenceValue) || (referenceRange !== '' && !referenceBounds)}
                                            onClick={() => {
                                                const line: ReferenceLine = {
                                                    kind: referenceKind,
                                                    value: referenceValue.trim(),
                                                    label: referenceLabel.trim(),
                                                    includeValue: referenceInclude,
                                                    ...(referenceBounds
                                                        ? { earliest: referenceBounds.earliest, latest: referenceBounds.latest }
                                                        : {}),
                                                };
                                                patchSeries({ referenceLines: [...series.referenceLines, line] });
                                                setReferenceOpen(false);
                                            }}
                                        >
                                            {t('Add')}
                                        </button>
                                        <button type="button" onClick={() => setReferenceOpen(false)}>
                                            {t('Cancel')}
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
                                        setReferenceRange('');
                                        setReferenceOpen(true);
                                    }}
                                >
                                    {t('Add reference line')}
                                </button>
                            )}
                        </Field>
                    </>
                )}
                {selected ? (
                    <SettingsFold>
                            <summary>{t('Chart settings')}</summary>
                            <Field as="div">
                                <label>
                                    <input
                                        type="checkbox"
                                        aria-label={t('Use global split by for this chart')}
                                        checked={selected.useGlobalSplit}
                                        onChange={(event) => patchChart({ useGlobalSplit: event.target.checked })}
                                    />{' '}
                                    {t('Use global split by for this chart')}
                                </label>
                            </Field>
                            <Field as="div">
                                {t('Chart type')}
                                <Select
                                    aria-label={t('Chart type')}
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
                                {t('Show')}
                                <Select
                                    aria-label={t('Chart content')}
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
                                {t('Time span')} = {selected.settings.span || 'Auto'}
                                <span>{t('Refer to the time range to set an appropriate time span.')}</span>
                                <SplitRow>
                                    <TextInput
                                        aria-label={t('Span count')}
                                        value={spanCount}
                                        inputMode="numeric"
                                        onChange={(event) => setSpanCount(event.target.value)}
                                    />
                                    <Select
                                        aria-label={t('Span unit')}
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
                                        {t('Apply span')}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!selected.settings.span}
                                        onClick={() => {
                                            patchSettings({ span: '' });
                                            setSpanCount('');
                                        }}
                                    >
                                        {t('Revert span')}
                                    </button>
                                </SplitRow>
                            </Field>
                            {selected.settings.content === 'table' || selected.settings.type === 'heatmap' ? null : (
                            <Field as="div">
                                {t('Y-axis')}
                                <span>Set the minimum and maximum, for example 1000, 1k or 3m.</span>
                                <SplitRow>
                                    <TextInput
                                        aria-label={t('Y-axis minimum')}
                                        placeholder="Min"
                                        value={selected.settings.yMin}
                                        onChange={(event) => patchSettings({ yMin: event.target.value })}
                                    />
                                    <TextInput
                                        aria-label={t('Y-axis maximum')}
                                        placeholder="Max"
                                        value={selected.settings.yMax}
                                        onChange={(event) => patchSettings({ yMax: event.target.value })}
                                    />
                                </SplitRow>
                                <Select
                                    aria-label={t('Y-axis scale')}
                                    value={selected.settings.yScale}
                                    onChange={(event) =>
                                        patchSettings({ yScale: event.target.value === 'log' ? 'log' : 'linear' })
                                    }
                                >
                                    <option value="linear">Linear</option>
                                    <option value="log">{t('Log')}</option>
                                </Select>
                                <Select
                                    aria-label={t('Tooltip decimal places')}
                                    value={String(selected.settings.decimals ?? 4)}
                                    onChange={(event) => patchSettings({ decimals: Number(event.target.value) })}
                                >
                                    {[0, 1, 2, 3, 4].map((count) => (
                                        <option key={count} value={count}>
                                            {count} decimal places in tooltips
                                        </option>
                                    ))}
                                </Select>
                                <label>
                                    <input
                                        type="checkbox"
                                        aria-label="Abbreviate axis numbers"
                                        checked={selected.settings.abbreviate !== false}
                                        onChange={(event) => patchSettings({ abbreviate: event.target.checked })}
                                    />{' '}
                                    {t('Abbreviate numbers on the axis')}
                                </label>
                                {validateAxis(selected.settings) ? <span role="alert">{validateAxis(selected.settings)}</span> : null}
                                <button
                                    type="button"
                                    onClick={() => patchSettings({ yMin: '', yMax: '', yScale: 'linear' })}
                                >
                                    {t('Revert y-axis')}
                                </button>
                            </Field>
                            )}
                    </SettingsFold>
                ) : null}
            </Analysis>
            ) : (
                <Rail $edge="right">
                    <IconButton type="button" aria-label={t('Show analysis')} onClick={() => setRightOpen(true)}>
                        «
                    </IconButton>
                </Rail>
            )}
            {saveMode ? (
                <SaveDialog
                    mode={saveMode}
                    charts={charts}
                    chartId={selectedId}
                    range={range}
                    latest={latest}
                    span={span}
                    catalogRange={catalogRange}
                    layout={layout}
                    globalSplit={globalSplit}
                    globalFilters={globalFilters}
                    metricDims={metricDims}
                    eventIndexes={eventIndexes}
                    metricIndexes={metricIndexes}
                    onClose={() => setSaveMode(null)}
                    onOpenWorkspace={applySession}
                />
            ) : null}
        </Shell>
    );
}
