import React, { useEffect, useMemo, useState } from 'react';
import Line from '@splunk/visualizations/Line';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';
import { buildMetricTree, filterMetricTree, MetricNode } from '../catalog/metricTree';
import { METRIC_FUNCTIONS, resolveMetricFunction } from '../spl/functions';
import { buildDimensionSearch, buildMstats, SPLIT_LIMITS } from '../spl/buildMstats';
import { searchWindow, spanForRange } from '../spl/span';
import { collectFieldValues, collectMetricNames, runSearch, SearchRow } from '../search/runSearch';
import { toLineTable } from '../chart/columns';

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
    padding: 10px 16px;
    border-bottom: 1px solid ${variables.neutral200};
`;

const ChartCard = styled.section`
    margin: 16px;
    padding: 12px 12px 4px;
    border: 1px solid ${variables.interactiveColorPrimary};
    border-radius: 8px;
    background: ${variables.backgroundColorSection};
    min-height: 280px;
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

function TreeRows(props: {
    nodes: MetricNode[];
    depth: number;
    open: Set<string>;
    selected?: string;
    onToggle: (id: string) => void;
    onSelect: (metricName: string) => void;
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
                    </RowButton>
                    {node.folder && props.open.has(node.id) ? (
                        <TreeRows
                            nodes={node.children}
                            depth={props.depth + 1}
                            open={props.open}
                            selected={props.selected}
                            onToggle={props.onToggle}
                            onSelect={props.onSelect}
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
    const [metric, setMetric] = useState('');
    const [aggregation, setAggregation] = useState('Avg');
    const [dimensions, setDimensions] = useState<string[]>([]);
    const [splitBy, setSplitBy] = useState('');
    const [splitDirection, setSplitDirection] = useState<'highest' | 'lowest'>('highest');
    const [splitLimit, setSplitLimit] = useState(5);
    const [timeShift, setTimeShift] = useState('');
    const [range, setRange] = useState('-60m');
    const [catalogRange, setCatalogRange] = useState('-2d');
    const [rows, setRows] = useState<SearchRow[]>([]);
    const [chartError, setChartError] = useState('');
    const [loading, setLoading] = useState(false);

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
    const span = spanForRange(range);
    const chosen = resolveMetricFunction(aggregation);

    useEffect(() => {
        if (!metric || !chosen || chosen.chart !== 'line') {
            setRows([]);
            return undefined;
        }
        setLoading(true);
        setChartError('');
        let search = '';
        try {
            search = buildMstats({
                aggregation,
                metric,
                span,
                splitBy: splitBy || undefined,
                splitDirection,
                splitLimit,
                timeShift: timeShift || undefined,
            });
        } catch (error) {
            setLoading(false);
            setChartError(error instanceof Error ? error.message : 'Could not build the search.');
            return undefined;
        }
        const bounds = searchWindow(range, timeShift);
        return runSearch(
            search,
            bounds.earliest,
            (payload) => {
                setRows(payload.results ?? []);
                setLoading(false);
            },
            (message) => {
                setChartError(message);
                setLoading(false);
            },
            bounds.latest
        );
    }, [metric, aggregation, range, span, chosen, splitBy, splitDirection, splitLimit, timeShift]);

    useEffect(() => {
        setDimensions([]);
        if (!metric) {
            return undefined;
        }
        try {
            const search = buildDimensionSearch(metric);
            return runSearch(
                search,
                range,
                (payload) => setDimensions(collectFieldValues(payload, '_dims')),
                () => setDimensions([])
            );
        } catch {
            setDimensions([]);
            return undefined;
        }
    }, [metric, range]);

    const seriesLabel = splitBy ? `${chosen?.label ?? aggregation} by ${splitBy}` : chosen?.label ?? aggregation;
    const data = toLineTable(rows, seriesLabel, splitBy || undefined);

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
                        selected={metric}
                        onToggle={(id) => {
                            const next = new Set(open);
                            if (next.has(id)) {
                                next.delete(id);
                            } else {
                                next.add(id);
                            }
                            setOpen(next);
                        }}
                        onSelect={(name) => {
                            setMetric(name);
                            setSplitBy('');
                        }}
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
                    <span>{metric ? `Time span=${span}` : ''}</span>
                </Toolbar>
                {!metric ? (
                    <Empty>
                        <h1>Start by selecting data.</h1>
                        <p>Find something interesting? Save it to a dashboard, or create an alert.</p>
                    </Empty>
                ) : (
                    <ChartCard>
                        <strong>
                            {metric} (Time span={span})
                        </strong>
                        {chartError ? <Note>{chartError}</Note> : null}
                        {loading ? <Note>Loading…</Note> : null}
                        {chosen?.chart === 'table' ? (
                            <Note>This aggregation is shown in the statistics table, which comes in the next phase.</Note>
                        ) : null}
                        {data.columns[0].length > 0 && chosen?.chart === 'line' ? (
                            <Line
                                width="100%"
                                height={260}
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
                                }}
                            />
                        ) : null}
                    </ChartCard>
                )}
            </Stage>
            <Analysis>
                <PaneHeader>Analysis</PaneHeader>
                {!metric ? null : (
                    <>
                        <Note>
                            {metric}
                            <br />
                            {seriesLabel}
                        </Note>
                        <Field>
                            Aggregation
                            <TextInput
                                aria-label="Aggregation"
                                list="metric-aggregations"
                                value={aggregation}
                                onChange={(event) => setAggregation(event.target.value)}
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
                                value={splitBy}
                                onChange={(event) => setSplitBy(event.target.value)}
                            >
                                <option value="">None</option>
                                {dimensions.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </Select>
                            <span>Display this series as separate values.</span>
                            {splitBy ? (
                                <SplitRow>
                                    <Select
                                        aria-label="Split limit type"
                                        value={splitDirection}
                                        onChange={(event) =>
                                            setSplitDirection(event.target.value === 'lowest' ? 'lowest' : 'highest')
                                        }
                                    >
                                        <option value="highest">Highest</option>
                                        <option value="lowest">Lowest</option>
                                    </Select>
                                    <Select
                                        aria-label="Split limit"
                                        value={splitLimit}
                                        onChange={(event) => setSplitLimit(Number(event.target.value))}
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
                                value={timeShift}
                                onChange={(event) => setTimeShift(event.target.value)}
                            >
                                {SHIFTS.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.label}
                                    </option>
                                ))}
                            </Select>
                            <span>Display an earlier time range.</span>
                        </Field>
                        {chosen?.rate ? (
                            <Note>This aggregation should only be used with accumulating counter metrics.</Note>
                        ) : null}
                    </>
                )}
            </Analysis>
        </Shell>
    );
}
