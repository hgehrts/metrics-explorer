import React from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { LineTable } from '../chart/columns';
import { formatHeatTick, heatColor, heatRange } from '../chart/heatmap';
import { formatTimeCell } from '../chart/stats';

const Frame = styled.div`
    display: grid;
    grid-template-columns: minmax(72px, 140px) 1fr 48px;
    gap: 8px;
    align-items: stretch;
    margin-top: 8px;
    min-height: 160px;
`;

const Rows = styled.div`
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    min-width: 0;
`;

const Label = styled.div`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    line-height: 22px;
`;

const Grid = styled.div`
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
`;

const Row = styled.div`
    display: flex;
    gap: 1px;
    height: 22px;
`;

const Cell = styled.span`
    flex: 1 1 0;
    min-width: 0;
    background: ${variables.neutral100};
`;

const Scale = styled.div`
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
`;

const Bar = styled.div`
    width: 10px;
    flex: 1 1 auto;
    margin: 2px 0;
    background: linear-gradient(to top, rgb(220, 78, 65) 0%, rgb(248, 190, 52) 50%, rgb(83, 160, 81) 90%);
`;

const Times = styled.div`
    display: flex;
    justify-content: space-between;
    grid-column: 2;
    font-size: 11px;
    color: ${variables.contentColorMuted};
`;

export function HeatmapChart(props: { table: LineTable; locale?: string }): React.ReactElement | null {
    const times = props.table.columns[0] ?? [];
    const series = props.table.fields.slice(1);
    if (times.length === 0 || series.length === 0) {
        return null;
    }
    const range = heatRange(props.table.columns);
    const tickAt = [0, Math.floor(times.length / 2), times.length - 1].filter(
        (index, position, all) => all.indexOf(index) === position
    );

    return (
        <Frame aria-label="Heatmap">
            <Rows>
                {series.map((field) => (
                    <Label key={field.name} title={field.name}>
                        {field.name}
                    </Label>
                ))}
            </Rows>
            <Grid>
                {series.map((field, seriesIndex) => (
                    <Row key={field.name}>
                        {times.map((time, timeIndex) => {
                            const raw = props.table.columns[seriesIndex + 1]?.[timeIndex] ?? '';
                            const value = raw === '' ? Number.NaN : Number(raw);
                            const colored = Number.isFinite(value);
                            return (
                                <Cell
                                    key={`${field.name}-${timeIndex}`}
                                    data-heat-cell="true"
                                    title={
                                        colored
                                            ? `${field.name} ${formatTimeCell(time, props.locale)}: ${value.toLocaleString(props.locale)}`
                                            : ''
                                    }
                                    style={colored ? { background: heatColor(value, range.min, range.max) } : undefined}
                                />
                            );
                        })}
                    </Row>
                ))}
            </Grid>
            <Scale>
                <span>{formatHeatTick(range.max)}</span>
                <Bar />
                <span>{formatHeatTick(range.min)}</span>
            </Scale>
            <Times>
                {tickAt.map((index) => (
                    <span key={index}>{formatTimeCell(times[index], props.locale)}</span>
                ))}
            </Times>
        </Frame>
    );
}
