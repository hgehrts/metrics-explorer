import React, { useEffect, useState } from 'react';
import Area from '@splunk/visualizations/Area';
import Column from '@splunk/visualizations/Column';
import Line from '@splunk/visualizations/Line';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';
import { toLineTable } from '../chart/columns';
import { addReferenceLines } from '../chart/reference';
import { axisOptions } from '../chart/settings';
import { mergeTables, splunkSearchUrl, toCsv } from '../export/table';
import { ChartModel } from '../model/workspace';
import { runSearch, SearchRow } from '../search/runSearch';
import { buildMstats } from '../spl/buildMstats';
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
    selected: boolean;
    onSelect: () => void;
    onRemove: () => void;
    onClone: () => void;
}): React.ReactElement {
    const [results, setResults] = useState<SeriesResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [menu, setMenu] = useState(false);
    const signature = JSON.stringify(props.chart.series);
    const span = props.chart.settings.span || props.span;

    useEffect(() => {
        const series = props.chart.series;
        const stops: Array<() => void> = [];
        const next: SeriesResult[] = series.map(() => ({ rows: [], error: '', search: '', earliest: props.range, latest: 'now' }));
        setLoading(true);
        series.forEach((item, index) => {
            const chosen = resolveMetricFunction(item.aggregation);
            if (!chosen || chosen.chart !== 'line') {
                next[index] = { ...next[index], error: 'This aggregation is shown in the statistics table, which comes in the next phase.' };
                setResults([...next]);
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

    const tables = props.chart.series.map((item, index) => {
        const chosen = resolveMetricFunction(item.aggregation);
        const label = item.splitBy ? `${chosen?.label ?? item.aggregation} by ${item.splitBy}` : chosen?.label ?? item.aggregation;
        return toLineTable(results[index]?.rows ?? [], label, item.splitBy || undefined);
    });
    const merged = mergeTables(tables.filter((table) => (table.columns[0]?.length ?? 0) > 0));
    const data = addReferenceLines(
        merged,
        props.chart.series.flatMap((item) => item.referenceLines)
    );
    const y2Fields = data.fields
        .slice(1)
        .map((field) => field.name)
        .filter((name) =>
            props.chart.series.some(
                (item, index) => item.overlay && (props.chart.series.length === 1 || name.startsWith(`${index + 1} `))
            )
        );
    const title = props.chart.series.map((item) => item.metric).join(', ');
    const Viz = (
        props.chart.settings.type === 'area' ? Area : props.chart.settings.type === 'column' ? Column : Line
    ) as typeof Line;
    const first = results[0];

    return (
        <Card $selected={props.selected} onClick={props.onSelect}>
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
                                    const blob = new Blob([toCsv(data)], { type: 'text/csv' });
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
                        </Menu>
                    ) : null}
                </Actions>
            </TitleRow>
            {results.map((result, index) =>
                result.error ? <Note key={`${index}-${result.error}`}>{result.error}</Note> : null
            )}
            {loading ? <Note>Refreshing</Note> : null}
            {data.columns[0] && data.columns[0].length > 0 ? (
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
                    }}
                />
            ) : null}
        </Card>
    );
}
