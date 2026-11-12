import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';
import {
    buildMetricTree,
    buildValueTree,
    countLeaves,
    filterMetricTree,
    matchesQuery,
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
import { activeSpan, SPAN_PRESETS } from '../spl/span';
import { boundForInput } from '../spl/timeRange';
import { isSeriesFilter } from '../model/session';
import { collectDimensions, collectFieldValues, collectMetricNames, collectValueMetrics, runSearch } from '../search/runSearch';
import { ReferenceLine, referenceSummary, referenceWindow } from '../chart/reference';
import { buildSpan, ChartSettings, CHART_CONTENT, CHART_TYPES, isCategorical, SPAN_UNITS, splitSpan, validateAxis } from '../chart/settings';
import {
    AUTO_REFRESH_MS,
    ChartModel,
    cloneChart,
    cloneSeries,
    createChart,
    DEFAULT_GLOBAL_LIMIT,
    GlobalSplitLimit,
    reviveChart,
    createSeries,
    INHERIT_SPLIT,
    refreshStatus,
    resolveSplit,
    sharedDimensions,
    Series,
    SeriesFilter,
    seriesLegend,
} from '../model/workspace';
import { ChartView } from './ChartView';
import { DataLists, ListSection } from './DataLists';
import { DataFilterForm } from './DataFilterForm';
import { DropdownMenu, MenuHeading, MenuItem } from './Menu';
import { SaveDialog, SaveMode } from './SaveDialog';
import { SplitDialog } from './SplitDialog';
import { TimeRangeDialog } from './TimeRangeDialog';
import { t } from '../i18n';
import { clampPaneWidth, LEFT_PANE_DEFAULT, RIGHT_PANE_DEFAULT, shellColumns } from './panes';
import { parseSession, SavedSession, serializeSession, sessionKey } from '../model/session';
import { splunkGet } from '../api/splunkd';
import { buildCatalogSearch, DataFilter, filterLabel, indexFromSearch } from '../model/dataFilters';
import { buildIndexActivitySearch, indexesWithData } from '../model/indexActivity';
import { loadAllowedMetricIndexes } from '../model/metricIndexes';
import { DEFAULT_MAX_METRICS, loadSettings } from '../model/loadDefaults';
import { formatZoomRange } from '../spl/zoomLabel';

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
    { id: '-30m', label: 'Last 30 minutes' },
    { id: '-60m', label: 'Last 1 hour' },
    { id: '-3h', label: 'Last 3 hours' },
    { id: '-6h', label: 'Last 6 hours' },
    { id: '-12h', label: 'Last 12 hours' },
    { id: '-24h', label: 'Last 24 hours' },
    { id: '-48h', label: 'Last 48 hours' },
    { id: '-7d', label: 'Last 7 days' },
    { id: '-30d', label: 'Last 30 days' },
];

type Section = 'indexes' | 'metrics' | 'events' | 'datasets' | ListSection;

type IndexChoice = { mode: 'all' } | { mode: 'picked'; names: string[] };

const NO_INDEXES: string[] = [];

/** The chart type picker groups types as the original does. */
const CHART_GROUPS: Array<{ label: string; types: string[] }> = [
    { label: 'Time charts', types: ['line', 'area', 'column', 'stacked', 'heatmap'] },
    { label: 'Categorical charts', types: ['category', 'stackCategory'] },
];

function axisSummary(settings: Pick<ChartSettings, 'yMin' | 'yMax' | 'yScale'>): string {
    if (!settings.yMin && !settings.yMax) {
        return settings.yScale === 'log' ? `${t('Auto')} (${t('Log')})` : t('Auto');
    }
    const range = `${settings.yMin || t('Auto')} – ${settings.yMax || t('Auto')}`;
    return settings.yScale === 'log' ? `${range} (${t('Log')})` : range;
}

/** Label of a time range: the preset name, or the custom bounds. */
function rangeLabel(range: string, latest: string): string {
    const preset = latest === 'now' ? RANGES.find((item) => item.id === range) : undefined;
    if (preset) {
        return t(preset.label);
    }
    return latest === 'now' ? `${boundForInput(range)} ${t('to now')}` : `${boundForInput(range)} - ${boundForInput(latest)}`;
}

/** The parts of a label that match the search, in bold, as the original highlights them. */
function Highlight(props: { text: string; query: string }): React.ReactElement {
    const needle = props.query.trim().toLowerCase();
    const at = needle && !needle.includes('*') ? props.text.toLowerCase().indexOf(needle) : -1;
    if (at < 0) {
        return <>{props.text}</>;
    }
    return (
        <>
            {props.text.slice(0, at)}
            <Mark>{props.text.slice(at, at + needle.length)}</Mark>
            {props.text.slice(at + needle.length)}
        </>
    );
}

const Shell = styled.div<{ $columns: string }>`
    display: grid;
    grid-template-columns: ${(props) => props.$columns};
    height: 100%;
    background: ${variables.backgroundColorPage};
    color: ${variables.contentColorDefault};
`;

const Pane = styled.aside`
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: ${variables.backgroundColorSidebar};
`;

const Analysis = styled(Pane)`
    overflow: auto;
`;

const Splitter = styled.div`
    position: relative;
    cursor: col-resize;
    touch-action: none;
    &::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 2px;
        width: 2px;
        background: ${variables.neutral200};
    }
    &:hover::before,
    &:focus-visible::before {
        background: ${variables.interactiveColorPrimary};
    }
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

const SearchWrap = styled.div`
    position: relative;
    margin: 0 12px 8px;
`;

const SearchBox = styled.input`
    box-sizing: border-box;
    width: 100%;
    padding: 5px 28px 5px 8px;
    border-radius: 4px;
    border: 1px solid ${variables.interactiveColorBorder};
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    font-size: 12px;
`;

const SearchIcon = styled.button`
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    border: 0;
    background: transparent;
    color: ${variables.contentColorMuted};
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
`;

const Mark = styled.strong`
    color: ${variables.contentColorActive};
`;

const SectionBody = styled.div`
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
`;

const Count = styled.span`
    margin-left: auto;
    color: ${variables.contentColorMuted};
    font-weight: 400;
`;

const Divider = styled.span`
    align-self: stretch;
    width: 1px;
    margin: 0 4px;
    background: ${variables.neutral200};
`;

const Help = styled.span`
    display: block;
    color: ${variables.contentColorMuted};
    font-size: 11px;
`;

const SectionTitle = styled.span`
    font-weight: 600;
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
    display: flex;
    gap: 6px;
    align-items: center;
    flex: 0 0 auto;
    width: 100%;
    margin: 0;
    padding: 7px 12px;
    font-size: 12px;
    border: 0;
    border-top: 1px solid ${variables.neutral200};
    background: ${variables.backgroundColorSection};
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

const IndexList = styled.div`
    max-height: 240px;
    overflow: auto;
`;

const IndexRow = styled.label`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    font-size: 12px;
    color: ${variables.contentColorDefault};
    cursor: pointer;
`;

const IndexName = styled.span`
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`;

const ActivityDot = styled.span<{ $state: 'on' | 'off' | 'unknown' }>`
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
    box-sizing: border-box;
    border: 1px solid ${(props) => (props.$state === 'on' ? '#1f7a32' : props.$state === 'off' ? '#a11d24' : '#8a8f98')};
    background: ${(props) => (props.$state === 'on' ? '#3fb950' : props.$state === 'off' ? '#f85149' : '#8a8f98')};
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

const SeriesRow = styled.div<{ $open: boolean }>`
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid ${variables.neutral200};
    background: ${(props) => (props.$open ? variables.interactiveColorOverlayHover : 'transparent')};

    > button:first-child {
        border-bottom: 0;
        background: transparent;
    }
`;

const SeriesActions = styled.span`
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 0 10px;
    font-size: 14px;
`;

/** A form that takes over the analysis pane, as the filter and reference line forms do in the original. */
const SubPanel = styled.section`
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
`;

const SubHead = styled.div`
    padding: 4px 12px 8px;
    border-bottom: 1px solid ${variables.neutral200};
    font-size: 12px;

    strong {
        display: block;
        margin-top: 4px;
        font-size: 13px;
    }
`;

const SubFoot = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: auto;
    padding: 10px 12px;
    border-top: 1px solid ${variables.neutral200};
`;

const Stage = styled.main`
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
`;

const SpanCustom = styled.div`
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px 12px 8px;

    input,
    select {
        width: 72px;
        font-size: 12px;
        padding: 4px;
    }
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

/** Toolbar buttons are flat, with an icon and a label, as in the original toolbar. */
const Bar = styled.button<{ $pressed?: boolean }>`
    display: inline-flex;
    gap: 5px;
    align-items: center;
    padding: 4px 7px;
    border: 0;
    border-radius: 4px;
    background: ${(props) => (props.$pressed ? variables.interactiveColorOverlaySelected : 'transparent')};
    color: ${variables.contentColorDefault};
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
    &:hover:not(:disabled) {
        background: ${variables.interactiveColorOverlayHover};
    }
    &:disabled {
        color: ${variables.contentColorDisabled};
        cursor: default;
    }
`;

const Muted = styled.span`
    color: ${variables.contentColorMuted};
    font-size: 11px;
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
    const text = refreshStatus(now, props.refreshedAt, props.auto);
    const ago = /^(\d+[sm]) ago$/.exec(text);
    const next = /^(\d+s) to refresh$/.exec(text);
    return <>{ago ? `(${t('{0} ago').replace('{0}', ago[1])})` : next ? `(${t('Refresh in {0}').replace('{0}', next[1])})` : text}</>;
}

function TreeRows(props: {
    nodes: MetricNode[];
    depth: number;
    open: Set<string>;
    /** While searching, every folder with a match is open. */
    query: string;
    selected: Set<string>;
    onToggle: (id: string) => void;
    onSelect: (metricName: string, filter?: MetricNode['filter']) => void;
    onAdd: (metricName: string, filter?: MetricNode['filter']) => void;
}): React.ReactElement {
    const isOpen = (id: string): boolean => props.query.trim() !== '' || props.open.has(id);
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
                            <span aria-hidden>{node.folder ? (isOpen(node.id) ? '▾' : '▸') : ''}</span>
                            <span>
                                <Highlight text={node.label} query={props.query} />
                            </span>
                        </RowButton>
                        {node.folder ? null : (
                            <AddButton
                                type="button"
                                aria-label={`${node.label}, ${t('Add to selected chart')}`}
                                title={t('Add to selected chart')}
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
                    {node.folder && isOpen(node.id) ? (
                        <TreeRows
                            nodes={node.children}
                            depth={props.depth + 1}
                            open={props.open}
                            query={props.query}
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
    const [leftWidth, setLeftWidth] = useState(LEFT_PANE_DEFAULT);
    const [rightWidth, setRightWidth] = useState(RIGHT_PANE_DEFAULT);
    const shellRef = useRef<HTMLDivElement>(null);
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
    const [spanEdit, setSpanEdit] = useState(false);
    /** Empty follows the time range. A value applies to every chart that has not set its own span. */
    const [globalSpan, setGlobalSpan] = useState('');
    const [globalSpanCount, setGlobalSpanCount] = useState('30');
    const [globalSpanUnit, setGlobalSpanUnit] = useState('s');
    const [axisEdit, setAxisEdit] = useState(false);
    const [axisDraft, setAxisDraft] = useState<Pick<ChartSettings, 'yMin' | 'yMax' | 'yScale'>>({ yMin: '', yMax: '', yScale: 'linear' });
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
    const [timeDialog, setTimeDialog] = useState(false);
    /** A drag across any chart zooms every chart to that window, until the user zooms out or picks a new range. */
    const [zoom, setZoom] = useState<{ earliest: string; latest: string } | null>(null);
    const [splitDialog, setSplitDialog] = useState(false);
    const [globalLimit, setGlobalLimit] = useState<GlobalSplitLimit>(DEFAULT_GLOBAL_LIMIT);
    const [catalogRange, setCatalogRange] = useState('-24h');
    /** One section of the data pane is open at a time, as in the original. */
    const [section, setSection] = useState<Section | ''>('metrics');
    const indexesOpen = section === 'indexes';
    const eventsOpen = section === 'events';
    const datasetsOpen = section === 'datasets';
    const metricsOpen = section === 'metrics';
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
    /** `all` charts every allowed index. `picked` is the explicit list, and an empty list charts none. */
    const [indexChoice, setIndexChoice] = useState<IndexChoice>({ mode: 'all' });
    /** Null until the activity search finishes. An empty list means no index had data. */
    const [activeIndexes, setActiveIndexes] = useState<string[] | null>(null);
    const [activityError, setActivityError] = useState('');
    const [defaultsReady, setDefaultsReady] = useState(false);
    const [dataFilterOpen, setDataFilterOpen] = useState(false);
    const [globalFilterOpen, setGlobalFilterOpen] = useState(false);
    const [percentileOpen, setPercentileOpen] = useState(false);
    /** The chart settings fold. Opening it closes the series, as the original analysis pane does. */
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [filterSort, setFilterSort] = useState<'asc' | 'desc'>('asc');

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

    useEffect(() => {
        let alive = true;
        loadSettings()
            .catch(() => ({
                filters: [] as DataFilter[],
                hierarchySource: 'metric_name',
                hierarchySeparator: '.',
                maxMetrics: DEFAULT_MAX_METRICS,
                catalogRange: '-24h',
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
                const picked = start.filter((item) => item.kind === 'index').map((item) => item.value);
                setIndexChoice(picked.length > 0 ? { mode: 'picked', names: picked } : { mode: 'all' });
                setDefaultFilters(settings.filters);
                setMaxMetrics(settings.maxMetrics);
                setCatalogRange(settings.catalogRange);
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

    const indexNames = metricIndexes ?? NO_INDEXES
    const explicitIndexes = indexChoice.mode === 'picked';
    const checkedIndexes = useMemo(() => {
        if (indexChoice.mode === 'all') {
            return indexNames;
        }
        const allowed = new Set(indexNames);
        return indexChoice.names.filter((name) => allowed.size === 0 || allowed.has(name));
    }, [indexChoice, indexNames]);
    const searchFilters = useMemo(
        () =>
            explicitIndexes
                ? [...dataFilters.filter((item) => item.kind !== 'index'), ...checkedIndexes.map((value) => ({ kind: 'index' as const, value }))]
                : dataFilters.filter((item) => item.kind !== 'index'),
        [explicitIndexes, dataFilters, checkedIndexes]
    );

    useEffect(() => {
        if (!defaultsReady || !metricIndexesReady) {
            return undefined;
        }
        setCatalogError('');
        setCatalogReady(false);
        return runSearch(
            buildCatalogSearch(searchFilters, '', metricIndexes, explicitIndexes),
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
    }, [catalogRange, searchFilters, explicitIndexes, defaultsReady, metricIndexes, metricIndexesReady]);

    useEffect(() => {
        if (!metricIndexesReady || !metricIndexes || metricIndexes.length === 0) {
            return undefined;
        }
        setActiveIndexes(null);
        setActivityError('');
        return runSearch(
            buildIndexActivitySearch(metricIndexes),
            catalogRange,
            (payload) => {
                setActiveIndexes(indexesWithData(payload, metricIndexes));
                setActivityError('');
            },
            (message) => {
                setActiveIndexes(null);
                setActivityError(message);
            }
        );
    }, [metricIndexes, metricIndexesReady, catalogRange]);

    useEffect(() => {
        if (charts.length === 0) {
            return;
        }
        const session = serializeSession(
            { charts, layout, range, latest, catalogRange, globalSplit, globalFilters, globalLimit, globalSpan },
            Date.now()
        );
        try {
            window.localStorage.setItem(sessionKey(currentUser()), session);
            setSavedSession(parseSession(session));
        } catch {
            // Storage can be full or disabled; the workspace still works without it.
        }
    }, [charts, layout, range, latest, catalogRange, globalSplit, globalFilters, globalLimit, globalSpan]);

    useEffect(() => {
        // A new range replaces the zoom, because the zoom lies inside the old range.
        setZoom(null);
    }, [range, latest]);

    function applySession(saved: SavedSession): void {
        const revived = saved.charts.map(reviveChart);
        setCharts(revived);
        setSelectedId(revived[0]?.id ?? '');
        setSelectedSeriesId('');
        setExpandedSeriesId('');
        setLayout(saved.layout);
        setRange(saved.range);
        setLatest(saved.latest);
        setCatalogRange(saved.catalogRange);
        setGlobalSplit(saved.globalSplit);
        setGlobalFilters(saved.globalFilters);
        setGlobalLimit(saved.globalLimit);
        setGlobalSpan(saved.globalSpan);
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
            (payload) => setAllDimensions(collectDimensions(payload)),
            () => setAllDimensions([])
        );
    }, [catalogRange, metricIndexes, metricIndexesReady]);

    useEffect(() => {
        setValueRows([]);
        if (!defaultsReady || !metricIndexesReady || groupBy === 'metric_name') {
            return undefined;
        }
        return runSearch(
            buildCatalogSearch(searchFilters, groupBy, metricIndexes, explicitIndexes),
            catalogRange,
            (payload) => {
                const limited = limitValueRows(collectValueMetrics(payload, groupBy), maxMetrics);
                setValueRows(limited.rows);
                setValuesTruncated(limited.truncated);
            },
            () => setValueRows([])
        );
    }, [groupBy, searchFilters, explicitIndexes, catalogRange, defaultsReady, metricIndexes, metricIndexesReady]);

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
    const shownIndexes = indexNames.filter((name) => matchesQuery(name, query));
    const shownSourcetypes = sourcetypes.filter((name) => matchesQuery(name, query));
    const shownDatamodels = datamodels.filter((name) => matchesQuery(name, query));

    function toggleSection(next: Section): void {
        setSection((current) => (current === next ? '' : next));
    }

    function toggleIndex(name: string): void {
        const current = indexChoice.mode === 'all' ? indexNames : indexChoice.names;
        const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name].sort();
        setIndexChoice({ mode: 'picked', names: next });
        setDataFilters((filters) => [
            ...filters.filter((item) => item.kind !== 'index'),
            ...next.map((value) => ({ kind: 'index' as const, value })),
        ]);
    }

    function matchCount(count: number): string {
        return count === 1 ? t('1 match found') : `${count} ${t('matches found')}`;
    }

    const selected = charts.find((chart) => chart.id === selectedId) ?? charts[0];
    const globalSplitDimensions = sharedDimensions(
        (selected?.series ?? [])
            .filter((item) => (item.source ?? 'metric') === 'metric')
            .map((item) => item.metric),
        metricDims
    );
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
    const span = activeSpan(globalSpan, zoom?.earliest ?? range, zoom?.latest ?? latest);
    const locale = window.location.pathname.match(/\/([a-z]{2}-[A-Z]{2})\//)?.[1];
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
                    setMetricDims((current) => ({ ...current, [metric]: collectDimensions(payload) })),
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
                (payload) => setDimensions(collectDimensions(payload)),
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
        showNewChart(chart);
    }

    /** New charts go on top and open their series in the analysis pane, as in the original. */
    function showNewChart(chart: ChartModel): void {
        setCharts((current) => [chart, ...current]);
        setSelectedId(chart.id);
        setSelectedSeriesId(chart.series[0].id);
        setExpandedSeriesId(chart.series[0].id);
        setSettingsOpen(false);
        refreshNow();
    }

    function addBaseChart(name: string, field: string, mode: 'live' | 'cached', owner: string): void {
        const chart = createChart(name, [], 'base');
        chart.series[0].field = field;
        chart.series[0].aggregation = 'Avg';
        chart.series[0].baseMode = mode;
        chart.series[0].baseOwner = owner;
        showNewChart(chart);
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
        setExpandedSeriesId(created.id);
        setSettingsOpen(false);
    }

    function toggleSeries(id: string): void {
        setSelectedSeriesId(id);
        setExpandedSeriesId((current) => (current === id ? '' : id));
        setSettingsOpen(false);
    }

    /** Copies a series of the selected chart and puts the copy right after it. */
    function duplicateSeries(id: string): void {
        if (!selected) {
            return;
        }
        const original = selected.series.find((item) => item.id === id);
        if (!original) {
            return;
        }
        const copy = cloneSeries(original);
        setCharts((current) =>
            current.map((chart) =>
                chart.id === selected.id
                    ? { ...chart, series: chart.series.flatMap((item) => (item.id === id ? [item, copy] : [item])) }
                    : chart
            )
        );
        setSelectedSeriesId(copy.id);
        setExpandedSeriesId(copy.id);
        setSettingsOpen(false);
    }

    /** Removes a series. A chart without series is removed with it. */
    function removeSeries(id: string): void {
        if (!selected) {
            return;
        }
        const rest = selected.series.filter((item) => item.id !== id);
        if (rest.length === 0) {
            removeChart(selected.id);
            return;
        }
        setCharts((current) => current.map((chart) => (chart.id === selected.id ? { ...chart, series: rest } : chart)));
        if (selectedSeriesId === id || expandedSeriesId === id) {
            setSelectedSeriesId(rest[0].id);
            setExpandedSeriesId('');
        }
    }

    function removeChart(id: string): void {
        setCharts((current) => current.filter((item) => item.id !== id));
        setMaximizedId((current) => (current === id ? '' : current));
        if (selected?.id === id) {
            setSelectedId('');
        }
    }

    function removeAll(): void {
        setCharts([]);
        setSelectedId('');
        setMaximizedId('');
        setMinimizedIds(new Set());
        setZoom(null);
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

    function resizePane(side: 'left' | 'right', requested: number): void {
        const container = shellRef.current?.getBoundingClientRect().width ?? 0;
        const sibling = side === 'left' ? (rightOpen ? rightWidth + 6 : 36) + 6 : (leftOpen ? leftWidth + 6 : 36) + 6;
        const width = clampPaneWidth(requested, container || requested + sibling + 280, sibling);
        if (side === 'left') {
            setLeftWidth(width);
        } else {
            setRightWidth(width);
        }
    }

    function dragPane(side: 'left' | 'right', event: React.PointerEvent<HTMLDivElement>): void {
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const originX = event.clientX;
        const origin = side === 'left' ? leftWidth : rightWidth;
        const previousCursor = document.body.style.cursor;
        document.body.style.cursor = 'col-resize';
        function move(next: PointerEvent): void {
            const delta = next.clientX - originX;
            resizePane(side, side === 'left' ? origin + delta : origin - delta);
        }
        function stop(): void {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', stop);
            handle.removeEventListener('pointercancel', stop);
            document.body.style.cursor = previousCursor;
        }
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    }

    function splitter(side: 'left' | 'right'): React.ReactElement {
        const width = side === 'left' ? leftWidth : rightWidth;
        return (
            <Splitter
                role="separator"
                aria-orientation="vertical"
                aria-label={t(side === 'left' ? 'Resize data pane' : 'Resize analysis pane')}
                aria-valuemin={180}
                aria-valuenow={width}
                tabIndex={0}
                onPointerDown={(event) => dragPane(side, event)}
                onKeyDown={(event) => {
                    const step = event.shiftKey ? 48 : 16;
                    if (event.key === 'ArrowLeft') {
                        resizePane(side, side === 'left' ? width - step : width + step);
                    } else if (event.key === 'ArrowRight') {
                        resizePane(side, side === 'left' ? width + step : width - step);
                    } else {
                        return;
                    }
                    event.preventDefault();
                }}
            />
        );
    }

    return (
        <Shell ref={shellRef} $columns={shellColumns(leftOpen, rightOpen, leftWidth, rightWidth)}>
            {leftOpen ? (
            <>
            <Pane>
                <PaneHeader>
                    <span>{t('Data')}</span>
                    <IconButton type="button" aria-label={t('Hide data')} onClick={() => setLeftOpen(false)}>
                        «
                    </IconButton>
                </PaneHeader>
                {dataFilterOpen ? (
                    <DataFilterForm
                        filters={[
                            ...dataFilters.filter((item) => item.kind !== 'index'),
                            ...checkedIndexes.map((value) => ({ kind: 'index' as const, value })),
                        ]}
                        indexes={metricIndexes ?? []}
                        dimensions={allDimensions}
                        metricIndexes={metricIndexes}
                        range={catalogRange}
                        onCancel={() => setDataFilterOpen(false)}
                        onApply={(next) => {
                            const picked = next.filter((item) => item.kind === 'index').map((item) => item.value);
                            setIndexChoice({ mode: 'picked', names: picked });
                            setDataFilters(next);
                            setDataFilterOpen(false);
                        }}
                    />
                ) : (
                    <>
                <SearchWrap>
                    <SearchBox
                        value={query}
                        placeholder={t('Search data to analyze')}
                        aria-label={t('Search data to analyze')}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    {query ? (
                        <SearchIcon type="button" aria-label={t('Clear search')} onClick={() => setQuery('')}>
                            ×
                        </SearchIcon>
                    ) : (
                        <SearchIcon as="span" aria-hidden="true">
                            ⌕
                        </SearchIcon>
                    )}
                </SearchWrap>
                <SectionButton type="button" aria-expanded={indexesOpen} onClick={() => toggleSection('indexes')}>
                    <span aria-hidden>{indexesOpen ? '▾' : '▸'}</span> <SectionTitle>{t('Indexes')}</SectionTitle>
                    {query && indexesOpen ? <Count>{matchCount(shownIndexes.length)}</Count> : null}
                </SectionButton>
                {indexesOpen ? (
                        <IndexList role="group" aria-label={t('Indexes')}>
                            {shownIndexes.map((name) => {
                                const checked = checkedIndexes.includes(name);
                                const dot = activeIndexes === null ? 'unknown' : activeIndexes.includes(name) ? 'on' : 'off';
                                return (
                                    <IndexRow key={name}>
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            aria-label={name}
                                            onChange={() => toggleIndex(name)}
                                        />
                                        <IndexName title={name}>{<Highlight text={name} query={query} />}</IndexName>
                                        <ActivityDot
                                            $state={dot}
                                            title={dot === 'on' ? t('Receiving metric data') : dot === 'off' ? t('No metric data') : ''}
                                            aria-label={
                                                dot === 'unknown'
                                                    ? undefined
                                                    : `${name}: ${dot === 'on' ? t('Receiving metric data') : t('No metric data')}`
                                            }
                                        />
                                    </IndexRow>
                                );
                            })}
                            {metricIndexesReady && shownIndexes.length === 0 ? <Note>{t('No metric indexes.')}</Note> : null}
                            {activityError ? <Note>{activityError}</Note> : null}
                        </IndexList>
                ) : null}
                <SectionButton type="button" aria-expanded={metricsOpen} onClick={() => toggleSection('metrics')}>
                    <span aria-hidden>{metricsOpen ? '▾' : '▸'}</span> <SectionTitle>{t('Metrics')}</SectionTitle>
                    {query ? <Count>{matchCount(countLeaves(tree))}</Count> : null}
                </SectionButton>
                {metricsOpen ? (
                <SectionBody>
                <FilterBox aria-label={t('Data filters')}>
                    {dataFilters.filter((filter) => filter.kind !== 'index').map((filter) => (
                        <Chip key={`${filter.kind}:${filter.value}`}>
                            {filterLabel(filter)}
                            <ChipRemove
                                type="button"
                                aria-label={`${t('Remove filter')} ${filterLabel(filter)}`}
                                disabled={!defaultsReady}
                                onClick={() => setDataFilters((current) => current.filter((item) => item !== filter))}
                            >
                                ×
                            </ChipRemove>
                        </Chip>
                    ))}
                    {sameFilters(dataFilters, defaultFilters) ? null : (
                        <TextLink
                            type="button"
                            disabled={!defaultsReady}
                            onClick={() => {
                                const picked = defaultFilters.filter((item) => item.kind === 'index').map((item) => item.value);
                                setIndexChoice(picked.length > 0 ? { mode: 'picked', names: picked } : { mode: 'all' });
                                setDataFilters(defaultFilters);
                            }}
                        >
                            {t('Reset to defaults')}
                        </TextLink>
                    )}
                    <TextLink type="button" disabled={!defaultsReady} onClick={() => setDataFilterOpen(true)}>
                        {t('+ Add new filter')}
                    </TextLink>
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
                <Tree role="list" aria-label={t('Data structure')}>
                    {catalogError ? <Note>{catalogError}</Note> : null}
                    {catalogReady && !catalogError && tree.length === 0 ? (
                        <Note>{query ? t('No matches found.') : t('No metrics in this time range.')}</Note>
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
                        query={query}
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
                </SectionBody>
                ) : null}
                <SectionButton type="button" aria-expanded={eventsOpen} onClick={() => toggleSection('events')}>
                    <span aria-hidden>{eventsOpen ? '▾' : '▸'}</span> <SectionTitle>{t('Events')}</SectionTitle>
                    {query && eventsOpen ? <Count>{matchCount(shownSourcetypes.length)}</Count> : null}
                </SectionButton>
                {eventsOpen ? (
                    <SectionBody>
                        {shownSourcetypes.map((name) => (
                            <SectionItem key={name} type="button" onClick={() => addChart(name, undefined, 'event')}>
                                <Highlight text={name} query={query} />
                            </SectionItem>
                        ))}
                        {sourcetypesReady && shownSourcetypes.length === 0 ? <Note>{t('No sourcetypes in this time range.')}</Note> : null}
                    </SectionBody>
                ) : null}
                <SectionButton type="button" aria-expanded={datasetsOpen} onClick={() => toggleSection('datasets')}>
                    <span aria-hidden>{datasetsOpen ? '▾' : '▸'}</span> <SectionTitle>{t('Datasets')}</SectionTitle>
                    {query && datasetsOpen ? <Count>{matchCount(shownDatamodels.length)}</Count> : null}
                </SectionButton>
                {datasetsOpen ? (
                    <SectionBody>
                        {shownDatamodels.map((name) => (
                            <SectionItem key={name} type="button" onClick={() => addChart(name, undefined, 'dataset')}>
                                <Highlight text={name} query={query} />
                            </SectionItem>
                        ))}
                        {shownDatamodels.length === 0 ? <Note>{t('No data models.')}</Note> : null}
                    </SectionBody>
                ) : null}
                <DataLists
                    catalogRange={catalogRange}
                    query={query}
                    open={section}
                    onToggle={toggleSection}
                    onAddBase={addBaseChart}
                    Header={SectionButton}
                    Body={SectionBody}
                    Title={SectionTitle}
                    Count={Count}
                    matchCount={matchCount}
                />
                    </>
                )}
                <Footer>
                    <span aria-hidden="true">ⓘ</span> {t('Data ingested from')}{' '}
                    <DropdownMenu
                        label={t('Catalog time range')}
                        trigger={(isOpen, toggle) => (
                            <TextLink
                                type="button"
                                aria-label={`${t('Data ingested from')} ${rangeLabel(catalogRange, 'now')}`}
                                aria-expanded={isOpen}
                                onClick={toggle}
                            >
                                {rangeLabel(catalogRange, 'now')} ▾
                            </TextLink>
                        )}
                    >
                        {(close) =>
                            RANGES.map((item) => (
                                <MenuItem
                                    key={item.id}
                                    $checked={item.id === catalogRange}
                                    onClick={() => {
                                        setCatalogRange(item.id);
                                        close();
                                    }}
                                >
                                    {t(item.label)}
                                </MenuItem>
                            ))
                        }
                    </DropdownMenu>
                    <div>{t('Changing this time setting will affect performance.')}</div>
                </Footer>
            </Pane>
            {splitter('left')}
            </>
            ) : (
                <Rail $edge="left">
                    <IconButton type="button" aria-label={t('Show data')} onClick={() => setLeftOpen(true)}>
                        »
                    </IconButton>
                </Rail>
            )}
            <Stage>
                <Toolbar role="group" aria-label={t('Global controls')}>
                    <Bar type="button" aria-label={t('Zoom out')} title={t('Zoom out')} disabled={!zoom} onClick={() => setZoom(null)}>
                        ⤺
                    </Bar>
                    <DropdownMenu
                        label={t('Time range')}
                        trigger={(isOpen, toggle) => (
                            <Bar type="button" aria-label={t('Time range')} aria-expanded={isOpen} onClick={toggle}>
                                <span aria-hidden="true">◷</span>
                                {zoom ? formatZoomRange(zoom.earliest, zoom.latest, locale) : rangeLabel(range, latest)} ▾
                            </Bar>
                        )}
                    >
                        {(close) => (
                            <>
                                {RANGES.map((item) => (
                                    <MenuItem
                                        key={item.id}
                                        $checked={!zoom && latest === 'now' && item.id === range}
                                        onClick={() => {
                                            setRange(item.id);
                                            setLatest('now');
                                            setZoom(null);
                                            close();
                                        }}
                                    >
                                        {t(item.label)}
                                    </MenuItem>
                                ))}
                                <MenuItem
                                    $checked={!zoom && !(latest === 'now' && RANGES.some((item) => item.id === range))}
                                    onClick={() => {
                                        close();
                                        setTimeDialog(true);
                                    }}
                                >
                                    {t('Custom…')}
                                </MenuItem>
                            </>
                        )}
                    </DropdownMenu>
                    <Divider />
                    <DropdownMenu
                        label={t('Time span')}
                        trigger={(isOpen, toggle) => (
                            <Bar type="button" aria-label={t('Time span')} aria-expanded={isOpen} onClick={toggle}>
                                {t('Time span')}: {globalSpan || t('Auto')} ▾
                            </Bar>
                        )}
                    >
                        {(close) => (
                            <>
                                <MenuItem
                                    $checked={!globalSpan}
                                    onClick={() => {
                                        setGlobalSpan('');
                                        close();
                                    }}
                                >
                                    {t('Auto')}
                                </MenuItem>
                                {SPAN_PRESETS.map((item) => (
                                    <MenuItem
                                        key={item}
                                        $checked={globalSpan === item}
                                        onClick={() => {
                                            setGlobalSpan(item);
                                            close();
                                        }}
                                    >
                                        {item}
                                    </MenuItem>
                                ))}
                                <MenuHeading>{t('Custom…')}</MenuHeading>
                                <SpanCustom>
                                    <TextInput
                                        aria-label={t('Span count')}
                                        value={globalSpanCount}
                                        inputMode="numeric"
                                        onChange={(event) => setGlobalSpanCount(event.target.value)}
                                    />
                                    <Select
                                        aria-label={t('Span unit')}
                                        value={globalSpanUnit}
                                        onChange={(event) => setGlobalSpanUnit(event.target.value)}
                                    >
                                        {SPAN_UNITS.map((item) => (
                                            <option key={item.id} value={item.id}>
                                                {t(item.label)}
                                            </option>
                                        ))}
                                    </Select>
                                    <ToolButton
                                        type="button"
                                        disabled={buildSpan(globalSpanCount, globalSpanUnit) === null}
                                        onClick={() => {
                                            const next = buildSpan(globalSpanCount, globalSpanUnit);
                                            if (next) {
                                                setGlobalSpan(next);
                                                close();
                                            }
                                        }}
                                    >
                                        {t('Apply span')}
                                    </ToolButton>
                                </SpanCustom>
                            </>
                        )}
                    </DropdownMenu>
                    <Bar
                        type="button"
                        aria-label={t('Refresh chart data')}
                        title={zoom ? t('Reset zoom to enable refresh.') : t('Refresh chart data')}
                        onClick={refreshNow}
                        disabled={charts.length === 0 || Boolean(zoom)}
                    >
                        <span aria-hidden="true">↻</span> {t('Refresh')}
                    </Bar>
                    <DropdownMenu
                        label={t('Auto-refresh settings')}
                        trigger={(isOpen, toggle) => (
                            <Bar
                                type="button"
                                aria-label={t('Auto-refresh settings')}
                                title={t('Auto-refresh settings')}
                                aria-expanded={isOpen}
                                disabled={Boolean(zoom)}
                                onClick={toggle}
                            >
                                ▾
                            </Bar>
                        )}
                    >
                        {(close) => (
                            <>
                                <MenuHeading>{t('Auto-refresh')}</MenuHeading>
                                <MenuItem
                                    $checked={!autoRefresh}
                                    onClick={() => {
                                        setAutoRefresh(false);
                                        close();
                                    }}
                                >
                                    {t('Off')}
                                </MenuItem>
                                <MenuItem
                                    $checked={autoRefresh}
                                    onClick={() => {
                                        setAutoRefresh(true);
                                        refreshNow();
                                        close();
                                    }}
                                >
                                    {t('On')}
                                </MenuItem>
                            </>
                        )}
                    </DropdownMenu>
                    {charts.length > 0 ? (
                        <Muted>
                            {zoom ? t('Reset zoom to enable refresh.') : <RefreshLabel refreshedAt={refreshedAt} auto={autoRefresh} />}
                        </Muted>
                    ) : null}
                    <Divider />
                    <Bar type="button" aria-label={t('Split By')} onClick={() => setSplitDialog(true)}>
                        <span aria-hidden="true">⑃</span>
                        {globalSplit ? `${t('Split By')}: ${globalSplit}` : t('Split By')}
                    </Bar>
                    {globalSplit ? (
                        <Bar type="button" aria-label={t('Clear Split By')} title={t('Clear Split By')} onClick={() => setGlobalSplit('')}>
                            ×
                        </Bar>
                    ) : null}
                    <Bar type="button" style={{ marginLeft: 'auto' }} disabled={charts.length === 0} onClick={removeAll}>
                        <span aria-hidden="true">⌫</span> {t('Remove all')}
                    </Bar>
                    <Divider />
                    <Bar
                        type="button"
                        aria-label={t('Grid layout')}
                        title={t('Grid layout')}
                        aria-pressed={layout === 'grid'}
                        $pressed={layout === 'grid'}
                        onClick={() => setLayout('grid')}
                    >
                        ▦
                    </Bar>
                    <Bar
                        type="button"
                        aria-label={t('Stack layout')}
                        title={t('Stack layout')}
                        aria-pressed={layout === 'stack'}
                        $pressed={layout === 'stack'}
                        onClick={() => setLayout('stack')}
                    >
                        ☰
                    </Bar>
                    <DropdownMenu
                        label={t('Global actions')}
                        alignRight
                        trigger={(isOpen, toggle) => (
                            <Bar type="button" aria-label={t('Global actions')} title={t('Global actions')} aria-expanded={isOpen} onClick={toggle}>
                                ⋯
                            </Bar>
                        )}
                    >
                        {(close) => (
                            <>
                                <MenuItem
                                    disabled={charts.length === 0}
                                    onClick={() => {
                                        close();
                                        setSaveMode('all-classic');
                                    }}
                                >
                                    {t('Save all charts to Classic Dashboards')}
                                </MenuItem>
                                <MenuItem
                                    disabled={charts.length === 0}
                                    onClick={() => {
                                        close();
                                        setSaveMode('all-studio');
                                    }}
                                >
                                    {t('Save all charts to Dashboard Studio')}
                                </MenuItem>
                                <MenuItem
                                    onClick={() => {
                                        close();
                                        setSaveMode('workspace');
                                    }}
                                >
                                    {t('Workspaces')}
                                </MenuItem>
                            </>
                        )}
                    </DropdownMenu>
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
                    {globalFilterError ? <Note role="alert">{t(globalFilterError)}</Note> : null}
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
                                spanManual={Boolean(globalSpan)}
                                refreshToken={refreshToken}
                                globalSplit={globalSplit}
                                globalLimit={globalLimit}
                                globalFilters={globalFilters}
                                metricDims={metricDims}
                                eventIndexes={eventIndexes}
                                metricIndexes={metricIndexes}
                                zoom={zoom}
                                onZoom={setZoom}
                                selected={chart.id === selected?.id}
                                onSelect={() => {
                                    if (chart.id !== selected?.id) {
                                        setSelectedId(chart.id);
                                        setSelectedSeriesId(chart.series[0]?.id ?? '');
                                        setExpandedSeriesId(chart.series[0]?.id ?? '');
                                        setSettingsOpen(false);
                                    }
                                }}
                                onRemove={() => removeChart(chart.id)}
                                onClone={() => {
                                    const copy = cloneChart(chart);
                                    setCharts((current) => current.flatMap((item) => (item.id === chart.id ? [item, copy] : [item])));
                                    setSelectedId(copy.id);
                                    setSelectedSeriesId(copy.series[0]?.id ?? '');
                                    setExpandedSeriesId(copy.series[0]?.id ?? '');
                                }}
                                onWidenSpan={(next) => {
                                    if (chart.settings.span) {
                                        setCharts((current) =>
                                            current.map((item) =>
                                                item.id === chart.id ? { ...item, settings: { ...item.settings, span: next } } : item
                                            )
                                        );
                                        return;
                                    }
                                    setGlobalSpan(next);
                                }}
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
            <>
            {splitter('right')}
            <Analysis role="group" aria-label={t('Analysis')}>
                <PaneHeader>
                    {t('Analysis')}
                    <IconButton type="button" aria-label={t('Hide analysis')} onClick={() => setRightOpen(false)}>
                        »
                    </IconButton>
                </PaneHeader>
                {selected && series && filterOpen ? (
                    <SubPanel aria-label={t('Add new filter')}>
                        <SubHead>
                            {series.metric}
                            <strong>{t('Add new filter')}</strong>
                        </SubHead>
                        <Field as="div">
                            <Select aria-label={t('Filter dimension')} value={filterDimension} onChange={(event) => setFilterDimension(event.target.value)}>
                                <option value="">{t('Select a dimension')}</option>
                                {((series.source ?? 'metric') === 'metric' ? dimensions : sourceFields).map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Select>
                            <span role="radiogroup" aria-label={t('Filter mode')}>
                                <label>
                                    <input type="radio" checked={filterMode === 'include'} onChange={() => setFilterMode('include')} /> {t('Include')}
                                </label>{' '}
                                <label>
                                    <input type="radio" checked={filterMode === 'exclude'} onChange={() => setFilterMode('exclude')} /> {t('Exclude')}
                                </label>
                            </span>
                            <SplitRow style={{ justifyContent: 'flex-end' }}>
                                <TextLink
                                    type="button"
                                    style={{ flex: '0 0 auto' }}
                                    aria-label={filterSort === 'asc' ? t('Sort descending') : t('Sort ascending')}
                                    title={filterSort === 'asc' ? t('Sort descending') : t('Sort ascending')}
                                    onClick={() => setFilterSort((current) => (current === 'asc' ? 'desc' : 'asc'))}
                                >
                                    {filterSort === 'asc' ? 'A→Z' : 'Z→A'}
                                </TextLink>
                                <TextLink
                                    type="button"
                                    style={{ flex: '0 0 auto' }}
                                    aria-label={t('Clear selections')}
                                    title={t('Clear selections')}
                                    disabled={filterPicked.length === 0}
                                    onClick={() => setFilterPicked([])}
                                >
                                    ×
                                </TextLink>
                            </SplitRow>
                            <FilterChoices>
                                {[...filterChoices]
                                    .sort((left, right) => (filterSort === 'asc' ? left.localeCompare(right) : right.localeCompare(left)))
                                    .map((value) => (
                                        <label key={value}>
                                            <input
                                                type="checkbox"
                                                checked={filterPicked.includes(value)}
                                                onChange={(event) =>
                                                    setFilterPicked((current) =>
                                                        event.target.checked ? [...current, value] : current.filter((item) => item !== value)
                                                    )
                                                }
                                            />{' '}
                                            {value}
                                        </label>
                                    ))}
                                {filterDimension && filterChoices.length === 0 ? <span>{t('Loading…')}</span> : null}
                            </FilterChoices>
                        </Field>
                        <SubFoot>
                            <ToolButton type="button" onClick={() => setFilterOpen(false)}>
                                {t('Cancel')}
                            </ToolButton>
                            <ToolButton
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
                            </ToolButton>
                        </SubFoot>
                    </SubPanel>
                ) : selected && series && referenceOpen ? (
                    <SubPanel aria-label={t('Add new reference line')}>
                        <SubHead>
                            {series.metric}
                            <strong>{t('Add new reference line')}</strong>
                        </SubHead>
                        <Field as="div">
                            {t('Calculation')}
                            <span role="radiogroup" aria-label={t('Calculation')}>
                                <label>
                                    <input
                                        type="radio"
                                        checked={referenceKind === 'aggregation'}
                                        onChange={() => {
                                            setReferenceKind('aggregation');
                                            setReferenceValue('Avg');
                                            setReferenceLabel('Avg');
                                        }}
                                    />{' '}
                                    {t('Raw data')}
                                </label>{' '}
                                <label>
                                    <input
                                        type="radio"
                                        checked={referenceKind === 'constant'}
                                        onChange={() => {
                                            setReferenceKind('constant');
                                            setReferenceValue('');
                                            setReferenceLabel('');
                                        }}
                                    />{' '}
                                    {t('Constant value')}
                                </label>
                            </span>
                        </Field>
                        <Field>
                            {t('Value')}
                            <Help>{referenceKind === 'constant' ? t('Enter a constant here.') : t('Select or type an aggregation.')}</Help>
                            <TextInput
                                aria-label={t('Reference value')}
                                list={referenceKind === 'constant' ? undefined : 'metric-aggregations'}
                                value={referenceValue}
                                placeholder={referenceKind === 'constant' ? '25' : 'Avg'}
                                onChange={(event) => setReferenceValue(event.target.value)}
                            />
                        </Field>
                        {referenceKind === 'aggregation' ? (
                            <Field as="div">
                                {t('Time range')}
                                <Help>{t('Select a time range.')}</Help>
                                <Select aria-label={t('Reference line time range')} value={referenceRange} onChange={(event) => setReferenceRange(event.target.value)}>
                                    <option value="">{t('Current chart')}</option>
                                    {RANGES.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {t(item.label)}
                                        </option>
                                    ))}
                                    <option value="custom">{t('Custom…')}</option>
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
                                {referenceError ? <span role="alert">{t(referenceError)}</span> : null}
                            </Field>
                        ) : null}
                        <Field>
                            {t('Label')}
                            <Help>{t('Customize the label (optional).')}</Help>
                            <TextInput aria-label={t('Reference label')} value={referenceLabel} onChange={(event) => setReferenceLabel(event.target.value)} />
                        </Field>
                        <Field as="div">
                            <label>
                                <input type="checkbox" aria-label={t('Include value')} checked={referenceInclude} onChange={(event) => setReferenceInclude(event.target.checked)} />{' '}
                                {t('Include value')}
                            </label>
                        </Field>
                        <SubFoot>
                            <ToolButton type="button" onClick={() => setReferenceOpen(false)}>
                                {t('Cancel')}
                            </ToolButton>
                            <ToolButton
                                type="button"
                                disabled={!referenceValueReady(referenceKind, referenceValue) || (referenceRange !== '' && !referenceBounds)}
                                onClick={() => {
                                    const line: ReferenceLine = {
                                        kind: referenceKind,
                                        value: referenceValue.trim(),
                                        label: referenceLabel.trim(),
                                        includeValue: referenceInclude,
                                        ...(referenceBounds ? { earliest: referenceBounds.earliest, latest: referenceBounds.latest } : {}),
                                    };
                                    patchSeries({ referenceLines: [...series.referenceLines, line] });
                                    setReferenceOpen(false);
                                }}
                            >
                                {t('Add')}
                            </ToolButton>
                        </SubFoot>
                    </SubPanel>
                ) : (
                    <>
                {(selected?.series ?? []).map((item) => (
                    <SeriesRow key={item.id} $open={item.id === expandedSeriesId}>
                        <SeriesHeader
                            type="button"
                            $open={item.id === expandedSeriesId}
                            aria-expanded={item.id === expandedSeriesId}
                            aria-label={`${t('Settings for')} ${item.metric}`}
                            onClick={() => toggleSeries(item.id)}
                        >
                            <span aria-hidden>{item.id === expandedSeriesId ? '▾' : '▸'}</span>
                            <span>
                                {item.metric}
                                <Help>{seriesLegend(headerSeries(item), (selected?.series ?? []).map(headerSeries))}</Help>
                            </span>
                        </SeriesHeader>
                        <SeriesActions>
                            <TextLink type="button" aria-label={`${t('Clone')} ${item.metric}`} title={t('Clone')} onClick={() => duplicateSeries(item.id)}>
                                ⧉
                            </TextLink>
                            <TextLink type="button" aria-label={`${t('Remove')} ${item.metric}`} title={t('Remove')} onClick={() => removeSeries(item.id)}>
                                ×
                            </TextLink>
                        </SeriesActions>
                    </SeriesRow>
                ))}
                {!series || series.id !== expandedSeriesId || settingsOpen ? null : (
                    <>
                        <Field>
                            <SectionTitle>{t('Aggregation')}</SectionTitle>
                            <Help>{t('Select or type an aggregation.')}</Help>
                            <TextInput
                                aria-label={t('Aggregation')}
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
                            <SectionTitle>{t('Percentile')}</SectionTitle>
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
                            {customError ? <span role="alert">{t(customError)}</span> : null}
                        </Field>
                        ) : (
                            <Field>
                                <TextLink type="button" onClick={() => setPercentileOpen(true)}>
                                    {t('+ Percentile')}
                                </TextLink>
                            </Field>
                        )}
                        <Field>
                            <SectionTitle>{t('Split by')}</SectionTitle>
                            <Help>{t('Split this series into separate values.')}</Help>
                            <Select
                                aria-label={t('Split by')}
                                value={
                                    (series.source === 'event' || series.source === 'dataset') && series.splitBy === INHERIT_SPLIT
                                        ? ''
                                        : series.splitBy
                                }
                                onChange={(event) => patchSeries({ splitBy: event.target.value })}
                            >
                                <option value="">{t('None')}</option>
                                {series.source === 'event' || series.source === 'dataset' ? null : (
                                    <option value={INHERIT_SPLIT}>{t('Inherit Global Split By')}</option>
                                )}
                                {splitChoices(
                                    (series.source ?? 'metric') === 'metric' ? dimensions : sourceFields,
                                    series.splitBy === INHERIT_SPLIT ? '' : series.splitBy
                                ).map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Select>
                            {series.splitBy && series.splitBy !== INHERIT_SPLIT ? (
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
                            <SectionTitle>{t('Time shift')}</SectionTitle>
                            <Help>{t('Show an earlier time range.')}</Help>
                            <Select aria-label={t('Time shift')} value={shiftSelect} onChange={(event) => chooseShift(event.target.value)}>
                                {SHIFTS.map((item) => (
                                    <option key={item.id || 'none'} value={item.id}>
                                        {t(item.label)}
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
                            {shiftError ? <span role="alert">{t(shiftError)}</span> : null}
                        </Field>
                        <Field as="div">
                            <SectionTitle>{t('Filter')}</SectionTitle>
                            <Help>{t('Include or exclude metrics from specific dimensions.')}</Help>
                            {series.filters.map((filter) => (
                                <SplitRow key={`${filter.dimension}-${filter.mode}`}>
                                    <span>
                                        {filter.dimension} {filter.mode === 'include' ? '=' : '!='} {filter.values.join(', ')}
                                    </span>
                                    <TextLink
                                        type="button"
                                        style={{ flex: '0 0 auto' }}
                                        aria-label={`${t('Remove')} ${filter.dimension}`}
                                        onClick={() => patchSeries({ filters: series.filters.filter((item) => item !== filter) })}
                                    >
                                        ×
                                    </TextLink>
                                </SplitRow>
                            ))}
                            <TextLink
                                type="button"
                                onClick={() => {
                                    setFilterDimension(dimensions.includes('host') ? 'host' : '');
                                    setFilterMode('include');
                                    setFilterPicked([]);
                                    setFilterOpen(true);
                                }}
                            >
                                {t('+ Add new filter')}
                            </TextLink>
                        </Field>
                        <Field as="div">
                            <SectionTitle>{t('Reference lines')}</SectionTitle>
                            <Help>{t('Add a horizontal line to show significant values or thresholds.')}</Help>
                            {series.referenceLines.map((line, index) => (
                                <SplitRow key={`${line.kind}-${line.label}-${line.earliest ?? ''}-${index}`}>
                                    <span>{referenceSummary(line)}</span>
                                    <TextLink
                                        type="button"
                                        style={{ flex: '0 0 auto' }}
                                        aria-label={`${t('Remove reference line')} ${line.label || line.value}`}
                                        onClick={() =>
                                            patchSeries({
                                                referenceLines: series.referenceLines.filter((_, itemIndex) => itemIndex !== index),
                                            })
                                        }
                                    >
                                        ×
                                    </TextLink>
                                </SplitRow>
                            ))}
                            <TextLink
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
                                {t('+ Add new reference line')}
                            </TextLink>
                        </Field>
                    </>
                )}
                {selected ? (
                    <>
                        <SeriesHeader
                            type="button"
                            $open={settingsOpen}
                            aria-expanded={settingsOpen}
                            onClick={() => {
                                setSettingsOpen((current) => !current);
                                setExpandedSeriesId('');
                            }}
                        >
                            <span aria-hidden="true">⚙</span>
                            <span>{t('Chart settings')}</span>
                        </SeriesHeader>
                        {settingsOpen ? (
                            <>
                                <Field as="div">
                                    <SectionTitle>{t('Chart type')}</SectionTitle>
                                    <Select
                                        aria-label={t('Chart type')}
                                        value={selected.settings.type}
                                        onChange={(event) => {
                                            const type = event.target.value as ChartSettings['type'];
                                            setCharts((current) =>
                                                current.map((chart) => {
                                                    if (chart.id !== selected.id) {
                                                        return chart;
                                                    }
                                                    const series = isCategorical(type)
                                                        ? chart.series.map((item) =>
                                                              resolveForSource(item.source, item.aggregation)?.rate
                                                                  ? { ...item, aggregation: (item.source ?? 'metric') === 'metric' ? 'Avg' : 'Count' }
                                                                  : item
                                                          )
                                                        : chart.series;
                                                    return { ...chart, series, settings: { ...chart.settings, type } };
                                                })
                                            );
                                        }}
                                    >
                                        {CHART_GROUPS.map((group) => (
                                            <optgroup key={group.label} label={t(group.label)}>
                                                {CHART_TYPES.filter((item) => group.types.includes(item.id)).map((item) => (
                                                    <option key={item.id} value={item.id}>
                                                        {t(item.label)}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </Select>
                                </Field>
                                <Field as="div">
                                    <SectionTitle>{t('Show')}</SectionTitle>
                                    <Select
                                        aria-label={t('Chart content')}
                                        value={selected.settings.content}
                                        onChange={(event) => {
                                            const content = event.target.value;
                                            patchSettings({ content: content === 'table' || content === 'both' ? content : 'chart' });
                                        }}
                                    >
                                        {CHART_CONTENT.map((item) => (
                                            <option key={item.id} value={item.id}>
                                                {t(item.label)}
                                            </option>
                                        ))}
                                    </Select>
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
                                {isCategorical(selected.settings.type) ? null : (
                                <Field as="div">
                                    <SectionTitle>{t('Time span')}</SectionTitle>
                                    <Help>{t('Refer to the time range to set an appropriate time span.')}</Help>
                                    {spanEdit ? (
                                        <>
                                            <SplitRow>
                                                <TextInput
                                                    aria-label={t('Span count')}
                                                    value={spanCount}
                                                    inputMode="numeric"
                                                    onChange={(event) => setSpanCount(event.target.value)}
                                                />
                                                <Select aria-label={t('Span unit')} value={spanUnit} onChange={(event) => setSpanUnit(event.target.value)}>
                                                    {SPAN_UNITS.map((item) => (
                                                        <option key={item.id} value={item.id}>
                                                            {t(item.label)}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </SplitRow>
                                            <SplitRow>
                                                <ToolButton type="button" onClick={() => setSpanEdit(false)}>
                                                    {t('Cancel')}
                                                </ToolButton>
                                                <ToolButton
                                                    type="button"
                                                    disabled={buildSpan(spanCount, spanUnit) === null}
                                                    onClick={() => {
                                                        patchSettings({ span: buildSpan(spanCount, spanUnit) ?? '' });
                                                        setSpanEdit(false);
                                                    }}
                                                >
                                                    {t('Update')}
                                                </ToolButton>
                                            </SplitRow>
                                        </>
                                    ) : (
                                        <SplitRow>
                                            <span>
                                                {t('Time span')} ={' '}
                                                {selected.settings.span || (globalSpan ? `${t('Auto')} (${globalSpan})` : t('Auto'))}
                                            </span>
                                            <TextLink
                                                type="button"
                                                style={{ flex: '0 0 auto' }}
                                                aria-label={t('Revert span')}
                                                title={t('Revert span')}
                                                disabled={!selected.settings.span}
                                                onClick={() => {
                                                    patchSettings({ span: '' });
                                                    setSpanCount('');
                                                }}
                                            >
                                                ↺
                                            </TextLink>
                                            <TextLink
                                                type="button"
                                                style={{ flex: '0 0 auto' }}
                                                aria-label={t('Edit span')}
                                                title={t('Edit span')}
                                                onClick={() => {
                                                    const current = splitSpan(selected.settings.span || span);
                                                    setSpanCount(current.count);
                                                    setSpanUnit(current.unit);
                                                    setSpanEdit(true);
                                                }}
                                            >
                                                ✎
                                            </TextLink>
                                        </SplitRow>
                                    )}
                                </Field>
                                )}
                                {selected.settings.content === 'table' || selected.settings.type === 'heatmap' ? null : (
                                    <Field as="div">
                                        <SectionTitle>{t('Y-axis')}</SectionTitle>
                                        <Help>{t('Set the minimum and maximum for the y-axis (e.g. 1000, 1k, 3m).')}</Help>
                                        {axisEdit ? (
                                            <>
                                                <SplitRow>
                                                    <TextInput
                                                        aria-label={t('Y-axis minimum')}
                                                        placeholder={t('Minimum')}
                                                        value={axisDraft.yMin}
                                                        onChange={(event) => setAxisDraft((current) => ({ ...current, yMin: event.target.value }))}
                                                    />
                                                    <TextInput
                                                        aria-label={t('Y-axis maximum')}
                                                        placeholder={t('Maximum')}
                                                        value={axisDraft.yMax}
                                                        onChange={(event) => setAxisDraft((current) => ({ ...current, yMax: event.target.value }))}
                                                    />
                                                </SplitRow>
                                                <span role="radiogroup" aria-label={t('Scale')}>
                                                    {t('Scale')}:{' '}
                                                    <label>
                                                        <input
                                                            type="radio"
                                                            checked={axisDraft.yScale === 'linear'}
                                                            onChange={() => setAxisDraft((current) => ({ ...current, yScale: 'linear' }))}
                                                        />{' '}
                                                        Linear
                                                    </label>{' '}
                                                    <label>
                                                        <input
                                                            type="radio"
                                                            checked={axisDraft.yScale === 'log'}
                                                            onChange={() => setAxisDraft((current) => ({ ...current, yScale: 'log' }))}
                                                        />{' '}
                                                        {t('Log')}
                                                    </label>
                                                </span>
                                                {validateAxis(axisDraft) ? <span role="alert">{t(validateAxis(axisDraft))}</span> : null}
                                                <SplitRow>
                                                    <ToolButton type="button" onClick={() => setAxisEdit(false)}>
                                                        {t('Cancel')}
                                                    </ToolButton>
                                                    <ToolButton
                                                        type="button"
                                                        disabled={Boolean(validateAxis(axisDraft))}
                                                        onClick={() => {
                                                            patchSettings(axisDraft);
                                                            setAxisEdit(false);
                                                        }}
                                                    >
                                                        {t('Update')}
                                                    </ToolButton>
                                                </SplitRow>
                                            </>
                                        ) : (
                                            <SplitRow>
                                                <span>
                                                    {t('Left')} = {axisSummary(selected.settings)}
                                                </span>
                                                <TextLink
                                                    type="button"
                                                    style={{ flex: '0 0 auto' }}
                                                    aria-label={t('Revert y-axis')}
                                                    title={t('Revert y-axis')}
                                                    disabled={!selected.settings.yMin && !selected.settings.yMax && selected.settings.yScale === 'linear'}
                                                    onClick={() => patchSettings({ yMin: '', yMax: '', yScale: 'linear' })}
                                                >
                                                    ↺
                                                </TextLink>
                                                <TextLink
                                                    type="button"
                                                    style={{ flex: '0 0 auto' }}
                                                    aria-label={t('Edit y-axis')}
                                                    title={t('Edit y-axis')}
                                                    onClick={() => {
                                                        setAxisDraft({
                                                            yMin: selected.settings.yMin,
                                                            yMax: selected.settings.yMax,
                                                            yScale: selected.settings.yScale,
                                                        });
                                                        setAxisEdit(true);
                                                    }}
                                                >
                                                    ✎
                                                </TextLink>
                                            </SplitRow>
                                        )}
                                        <Select
                                            aria-label={t('Tooltip decimal places')}
                                            value={String(selected.settings.decimals ?? 4)}
                                            onChange={(event) => patchSettings({ decimals: Number(event.target.value) })}
                                        >
                                            {[0, 1, 2, 3, 4].map((count) => (
                                                <option key={count} value={count}>
                                                    {count} {t('decimal places in tooltips')}
                                                </option>
                                            ))}
                                        </Select>
                                        <label>
                                            <input
                                                type="checkbox"
                                                aria-label={t('Abbreviate numbers on the axis')}
                                                checked={selected.settings.abbreviate !== false}
                                                onChange={(event) => patchSettings({ abbreviate: event.target.checked })}
                                            />{' '}
                                            {t('Abbreviate numbers on the axis')}
                                        </label>
                                    </Field>
                                )}
                            </>
                        ) : null}
                    </>
                ) : null}
                    </>
                )}
                {series ? (
                    <datalist id="metric-aggregations">
                        {functionsFor(series.source ?? 'metric')
                            .filter((item) => !isCategorical(selected?.settings.type ?? '') || !item.rate)
                            .map((item) => (
                            <option key={item.name} value={item.label} />
                        ))}
                    </datalist>
                ) : null}
            </Analysis>
            </>
            ) : (
                <Rail $edge="right">
                    <IconButton type="button" aria-label={t('Show analysis')} onClick={() => setRightOpen(true)}>
                        «
                    </IconButton>
                </Rail>
            )}
            {timeDialog ? (
                <TimeRangeDialog
                    earliest={range}
                    latest={latest}
                    onClose={() => setTimeDialog(false)}
                    onApply={(earliest, end) => {
                        setRange(earliest);
                        setLatest(end);
                        setZoom(null);
                        setTimeDialog(false);
                    }}
                />
            ) : null}
            {splitDialog ? (
                <SplitDialog
                    dimensions={globalSplitDimensions}
                    split={globalSplit}
                    limit={globalLimit}
                    onClose={() => setSplitDialog(false)}
                    onApply={(split, limit) => {
                        setGlobalSplit(split);
                        setGlobalLimit(limit);
                        setSplitDialog(false);
                    }}
                />
            ) : null}
            {saveMode ? (
                <SaveDialog
                    globalLimit={globalLimit}
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
                    globalSpan={globalSpan}
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
