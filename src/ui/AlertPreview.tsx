import React, { useEffect, useState } from 'react';
import Column from '@splunk/visualizations/Column';
import Line from '@splunk/visualizations/Line';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { toCategoryTable, toLineTable } from '../chart/columns';
import { t } from '../i18n';
import { runSearch } from '../search/runSearch';

const Frame = styled.div`
    border-bottom: 1px solid ${variables.neutral200};
    margin: 0 0 8px;
`;

const Toggle = styled.button`
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 0 8px;
    border: 0;
    background: transparent;
    color: ${variables.contentColorDefault};
    font: inherit;
    font-weight: 600;
    cursor: pointer;
`;

const Plot = styled.div`
    height: 150px;
`;

const Note = styled.p`
    margin: 0 0 8px;
    color: ${variables.contentColorMuted};
`;

/** The small chart at the top of the alert dialog, the same series the alert watches. */
export function AlertPreview(props: {
    search: string;
    earliest: string;
    latest: string;
    seriesName: string;
    categorical: boolean;
}): React.ReactElement {
    const [open, setOpen] = useState(true);
    const [table, setTable] = useState<ReturnType<typeof toLineTable> | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        setError('');
        return runSearch(
            props.search,
            props.earliest,
            (payload) => {
                const rows = payload.results ?? [];
                setTable(props.categorical ? toCategoryTable(rows, props.seriesName) : toLineTable(rows, props.seriesName));
                setLoading(false);
            },
            (message) => {
                setError(message);
                setLoading(false);
            },
            props.latest
        );
    }, [props.search, props.earliest, props.latest, props.seriesName, props.categorical]);

    const points = table?.columns[0]?.length ?? 0;
    const Viz = props.categorical ? Column : Line;

    return (
        <Frame>
            <Toggle type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
                <span aria-hidden>{open ? '▾' : '▸'}</span> {t('Preview')}
            </Toggle>
            {open && loading ? <Note>{t('Loading…')}</Note> : null}
            {open && error ? <Note role="alert">{t(error)}</Note> : null}
            {open && !loading && !error && points === 0 ? <Note>{t('No results found.')}</Note> : null}
            {open && table && points > 0 ? (
                <Plot>
                    <Viz
                        width="100%"
                        height={150}
                        dataSources={{
                            primary: {
                                requestParams: { count: points },
                                data: table,
                                meta: { totalCount: points },
                            },
                        }}
                        options={{
                            legendDisplay: 'right',
                            xAxisTitleVisibility: 'collapsed',
                            yAxisTitleVisibility: 'collapsed',
                            backgroundColor: 'transparent',
                        }}
                    />
                </Plot>
            ) : null}
        </Frame>
    );
}
