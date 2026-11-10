import React, { useEffect, useState } from 'react';
import styled from 'styled-components';

import { restEntries, splunkDelete, splunkGet } from '../api/splunkd';
import { t } from '../i18n';
import { quoteSpl } from '../spl/buildMstats';
import { collectFieldValues, runSearch } from '../search/runSearch';
import { readableFields } from '../spl/buildMstats';
import { splunkSearchUrl } from '../export/table';
import { matchesQuery } from '../catalog/metricTree';

const Item = styled.button`
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 4px 12px;
    cursor: pointer;
`;

const BASE_PREFIX = 'MX Base - ';

type BaseRow = { saved: string; name: string; owner: string; cached: boolean };

function locale(): string {
    return window.location.pathname.match(/\/([a-z]{2}-[A-Z]{2})\//)?.[1] ?? 'en-US';
}

export type ListSection = 'bases' | 'alerts';

type Part = React.ComponentType<React.PropsWithChildren<Record<string, unknown>>>;

/** Base searches and alerts of the data pane. The explorer decides which section is open and how headers look. */
export function DataLists(props: {
    catalogRange: string;
    query: string;
    open: string;
    onToggle: (section: ListSection) => void;
    onAddBase: (name: string, field: string, mode: 'live' | 'cached', owner: string) => void;
    Header: Part;
    Body: Part;
    Title: Part;
    Count: Part;
    matchCount: (count: number) => string;
}): React.ReactElement {
    const basesOpen = props.open === 'bases';
    const alertsOpen = props.open === 'alerts';
    const { Header, Body, Title, Count } = props;
    const [bases, setBases] = useState<BaseRow[]>([]);
    const [openBase, setOpenBase] = useState('');
    const [measures, setMeasures] = useState<string[]>([]);
    const [alerts, setAlerts] = useState<Array<{ name: string; detail: string; streaming: boolean }>>([]);

    useEffect(() => {
        if (!basesOpen) {
            return undefined;
        }
        let alive = true;
        splunkGet('saved/searches?count=200')
            .then((body) => {
                if (!alive) {
                    return;
                }
                const rows = restEntries(body)
                    .filter((item) => item.name.startsWith(BASE_PREFIX))
                    .map((item) => ({
                        saved: item.name,
                        name: item.name.slice(BASE_PREFIX.length),
                        owner: item.author || 'nobody',
                        cached: item.content.is_scheduled === true || item.content.is_scheduled === '1',
                    }));
                setBases(rows);
            })
            .catch(() => {
                if (alive) {
                    setBases([]);
                }
            });
        return () => {
            alive = false;
        };
    }, [basesOpen]);

    useEffect(() => {
        if (!openBase) {
            setMeasures([]);
            return undefined;
        }
        return runSearch(
            `| savedsearch ${quoteSpl(openBase)} | head 100 | fieldsummary maxvals=0 | fields field`,
            props.catalogRange,
            (payload) => setMeasures(readableFields(collectFieldValues(payload, 'field'))),
            () => setMeasures([])
        );
    }, [openBase, props.catalogRange]);

    useEffect(() => {
        if (!alertsOpen) {
            return undefined;
        }
        let alive = true;
        const scheduled = splunkGet('saved/searches?count=200')
            .then((body) =>
                restEntries(body)
                    .filter((item) => item.content['alert.track'] === true || item.content['alert.track'] === '1')
                    .filter((item) => !item.name.startsWith(BASE_PREFIX))
                    .map((item) => ({
                        name: item.name,
                        detail: typeof item.content.alert_condition === 'string' ? item.content.alert_condition : 'Scheduled',
                        streaming: false,
                    }))
            )
            .catch(() => []);
        const streaming = splunkGet('alerts/metric_alerts?count=100')
            .then((body) =>
                restEntries(body).map((item) => ({
                    name: item.name,
                    detail: typeof item.content.condition === 'string' ? item.content.condition : 'Streaming',
                    streaming: true,
                }))
            )
            .catch(() => []);
        Promise.all([scheduled, streaming]).then(([left, right]) => {
            if (alive) {
                setAlerts([...left, ...right]);
            }
        });
        return () => {
            alive = false;
        };
    }, [alertsOpen]);

    const shownBases = bases.filter((item) => matchesQuery(item.name, props.query));
    const shownAlerts = alerts.filter((item) => matchesQuery(item.name, props.query));

    return (
        <>
            <Header type="button" aria-expanded={basesOpen} onClick={() => props.onToggle('bases')}>
                <span aria-hidden>{basesOpen ? '▾' : '▸'}</span> <Title>{t('Base Searches')}</Title>
                {props.query && basesOpen ? <Count>{props.matchCount(shownBases.length)}</Count> : null}
            </Header>
            {basesOpen ? (
                <Body>
            {shownBases.map((item) => (
                      <div key={item.saved}>
                          <Item type="button" onClick={() => setOpenBase((current) => (current === item.saved ? '' : item.saved))}>
                              {item.name}
                          </Item>
                          {openBase === item.saved
                              ? measures.map((field) => (
                                    <Item
                                        key={field}
                                        type="button"
                                        onClick={() => props.onAddBase(item.name, field, item.cached ? 'cached' : 'live', item.owner)}
                                    >
                                        {field}
                                    </Item>
                                ))
                              : null}
                          {openBase === item.saved && measures.length === 0 ? <Item as="div">{t('No fields in the preview.')}</Item> : null}
                      </div>
                  ))}
            {shownBases.length === 0 ? <Item as="div">{t('No base searches.')}</Item> : null}
                </Body>
            ) : null}
            <Header type="button" aria-expanded={alertsOpen} onClick={() => props.onToggle('alerts')}>
                <span aria-hidden>{alertsOpen ? '▾' : '▸'}</span> <Title>{t('Alerts')}</Title>
                {props.query && alertsOpen ? <Count>{props.matchCount(shownAlerts.length)}</Count> : null}
            </Header>
            {alertsOpen ? (
                <Body>
            {shownAlerts.map((item) => (
                      <div key={`${item.streaming ? 's' : 'a'}-${item.name}`}>
                          <Item as="div">
                              {item.name}
                              <br />
                              {item.detail}
                          </Item>
                          <Item
                              type="button"
                              onClick={() => {
                                  const search = `| rest /servicesNS/-/-/alerts/fired_alerts | search savedsearch_name=${quoteSpl(item.name)}`;
                                  window.open(splunkSearchUrl(locale(), search, '-7d', 'now'), '_blank', 'noopener');
                              }}
                          >
                              {t('Show triggered instances')}
                          </Item>
                          <Item
                              type="button"
                              aria-label={`Delete alert ${item.name}`}
                              onClick={() => {
                                  const path = item.streaming
                                      ? `alerts/metric_alerts/${encodeURIComponent(item.name)}`
                                      : `saved/searches/${encodeURIComponent(item.name)}`;
                                  void splunkDelete(path).then(() => setAlerts((current) => current.filter((alert) => alert.name !== item.name)));
                              }}
                          >
                              Delete
                          </Item>
                      </div>
                  ))}
            {shownAlerts.length === 0 ? <Item as="div">{t('(No alerts available)')}</Item> : null}
                </Body>
            ) : null}
        </>
    );
}
