import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';

import { restEntries, splunkDelete, splunkGet, splunkPost, splunkPostJson } from '../api/splunkd';
import { alertComparator, ALERT_SCHEDULES, metricAlertCondition, scheduledAlertFields } from '../actions/alerts';
import { appendClassicPanels, chartKind, classicDashboard, dashboardNameError, PanelSpec, studioDashboard } from '../actions/dashboards';
import { t } from '../i18n';
import { parseSession, SavedSession, serializeSession } from '../model/session';
import { ChartModel, globalFiltersFor, resolveSeries, SeriesFilter } from '../model/workspace';
import { baseSavedName, buildBaseSearchSpl } from '../spl/buildMstats';
import { resolveForSource } from '../spl/functions';
import { buildSeriesSearch } from '../spl/seriesSearch';

const Backdrop = styled.div`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 20;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 16px;
`;

const Dialog = styled.form`
    width: min(560px, 100%);
    max-height: calc(100vh - 96px);
    overflow: auto;
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
`;

const Row = styled.label`
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
`;

const Actions = styled.div`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
`;

export type SaveMode = 'report' | 'panel' | 'all' | 'base' | 'alert' | 'workspace';

type WorkspaceRow = { _key?: string; name?: string; description?: string; state?: string; owner?: string; sharing?: string };

function currentUser(): string {
    return (window as unknown as { $C?: { USERNAME?: string } }).$C?.USERNAME ?? 'admin';
}

function panelsFor(
    charts: ChartModel[],
    span: string,
    range: string,
    latest: string,
    globalSplit: string,
    globalFilters: SeriesFilter[],
    metricDims: Record<string, string[]>,
    indexes: string[],
    metricIndexes?: string[]
): PanelSpec[] {
    const panels: PanelSpec[] = [];
    for (const chart of charts) {
        const series = resolveSeries(chart.series, globalSplit, chart.useGlobalSplit).map((item) => ({
            ...item,
            filters: [...globalFiltersFor(item, globalFilters, metricDims), ...item.filters],
        }));
        const item = series[0];
        if (!item || resolveForSource(item.source, item.aggregation)?.chart === 'table') {
            continue;
        }
        const query = buildSeriesSearch(item, chart.settings.span || span, range, latest, indexes, metricIndexes);
        const kind = chartKind(chart.settings.type);
        panels.push({
            title: item.metric,
            search: query.search,
            earliest: query.earliest,
            latest: query.latest,
            chart: kind.chart,
            stacked: kind.stacked,
        });
    }
    return panels;
}

export function SaveDialog(props: {
    mode: SaveMode;
    charts: ChartModel[];
    chartId: string;
    range: string;
    latest: string;
    span: string;
    catalogRange: string;
    layout: 'stack' | 'grid';
    globalSplit: string;
    globalFilters: SeriesFilter[];
    metricDims: Record<string, string[]>;
    eventIndexes: string[];
    metricIndexes?: string[];
    onClose: () => void;
    onOpenWorkspace: (session: SavedSession) => void;
}): React.ReactElement {
    const chart = props.charts.find((item) => item.id === props.chartId) ?? props.charts[0];
    const targets = props.mode === 'all' ? props.charts : chart ? [chart] : [];
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [format, setFormat] = useState<'classic' | 'studio'>('classic');
    const [existing, setExisting] = useState('');
    const [views, setViews] = useState<string[]>([]);
    const [baseMode, setBaseMode] = useState<'live' | 'cached'>('live');
    const [sharing, setSharing] = useState<'private' | 'app'>('private');
    const [comparator, setComparator] = useState(t('greater than'));
    const [threshold, setThreshold] = useState('');
    const [cron, setCron] = useState<string>(ALERT_SCHEDULES[1].id);
    const [severity, setSeverity] = useState('3');
    const [throttle, setThrottle] = useState('');
    const [alertKind, setAlertKind] = useState<'scheduled' | 'streaming'>('scheduled');
    const [streamingOk, setStreamingOk] = useState(false);
    const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
    const [error, setError] = useState('');
    const [done, setDone] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (props.mode !== 'panel' && props.mode !== 'all') {
            return undefined;
        }
        let alive = true;
        splunkGet('data/ui/views?count=100')
            .then((body) => {
                if (alive) {
                    setViews(restEntries(body).map((item) => item.name).filter(Boolean).sort());
                }
            })
            .catch(() => {
                if (alive) {
                    setViews([]);
                }
            });
        return () => {
            alive = false;
        };
    }, [props.mode]);

    useEffect(() => {
        if (props.mode !== 'alert') {
            return undefined;
        }
        let alive = true;
        splunkGet('alerts/metric_alerts?count=1')
            .then(() => {
                if (alive) {
                    setStreamingOk(true);
                }
            })
            .catch(() => {
                if (alive) {
                    setStreamingOk(false);
                }
            });
        return () => {
            alive = false;
        };
    }, [props.mode]);

    function reloadWorkspaces(): void {
        splunkGet('storage/collections/data/mx_workspaces?limit=100')
            .then((body) => setWorkspaces(Array.isArray(body) ? (body as WorkspaceRow[]) : []))
            .catch(() => setWorkspaces([]));
    }

    useEffect(() => {
        if (props.mode === 'workspace') {
            reloadWorkspaces();
        }
    }, [props.mode]);

    async function save(event: React.FormEvent): Promise<void> {
        event.preventDefault();
        setError('');
        setDone('');
        const title = name.trim();
        if (props.mode !== 'panel' && props.mode !== 'all' ? !title : !existing && !title) {
            setError(t('Enter a name.'));
            return;
        }
        if (!existing && title && (props.mode === 'panel' || props.mode === 'all' || props.mode === 'workspace' || props.mode === 'base')) {
            const nameError = props.mode === 'base' || props.mode === 'workspace' ? '' : dashboardNameError(title);
            if (nameError) {
                setError(nameError);
                return;
            }
        }
        setBusy(true);
        try {
            if (props.mode === 'report' || props.mode === 'alert' || props.mode === 'panel' || props.mode === 'all') {
                const panels = panelsFor(
                    targets,
                    props.span,
                    props.range,
                    props.latest,
                    props.globalSplit,
                    props.globalFilters,
                    props.metricDims,
                    props.eventIndexes,
                    props.metricIndexes
                );
                if (panels.length === 0) {
                    throw new Error(t('Nothing to save.'));
                }
                if (props.mode === 'report') {
                    await splunkPost('saved/searches', {
                        name: title,
                        search: panels[0].search,
                        'dispatch.earliest_time': panels[0].earliest,
                        'dispatch.latest_time': panels[0].latest,
                        description: description.trim(),
                    });
                    setDone(`${t('Saved report')} ${title}.`);
                } else if (props.mode === 'alert') {
                    await saveAlert(panels[0], title);
                } else {
                    await saveDashboard(panels, title);
                }
            } else if (props.mode === 'base') {
                await saveBase(title);
            } else {
                await saveWorkspace(title);
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : t('Could not save.'));
        } finally {
            setBusy(false);
        }
    }

    async function saveDashboard(panels: PanelSpec[], title: string): Promise<void> {
        const label = title || existing;
        if (existing) {
            if (format === 'studio') {
                throw new Error(t('Adding panels to an existing dashboard works for Classic dashboards. Create a new Dashboard Studio dashboard.'));
            }
            const body = await splunkGet(`data/ui/views/${encodeURIComponent(existing)}`);
            const entry = restEntries(body)[0];
            const current = typeof entry?.content['eai:data'] === 'string' ? entry.content['eai:data'] : '';
            const next = appendClassicPanels(current, panels);
            await splunkPost(`data/ui/views/${encodeURIComponent(existing)}`, { 'eai:data': next });
            setDone(`${t('Added the charts to')} ${existing}.`);
            return;
        }
        const xml = format === 'studio' ? studioDashboard(label, panels) : classicDashboard(label, panels);
        await splunkPost('data/ui/views', { name: label, 'eai:data': xml });
        setDone(`${t('Saved dashboard')} ${label}.`);
    }

    async function saveAlert(panel: PanelSpec, title: string): Promise<void> {
        const series = chart?.series[0];
        if (alertKind === 'streaming') {
            if (!streamingOk) {
                throw new Error(t('Streaming alerts are not available on this instance.'));
            }
            if (!series || (series.source ?? 'metric') !== 'metric') {
                throw new Error(t('A streaming alert needs a metric series.'));
            }
            const aggregation = resolveForSource('metric', series.aggregation);
            if (!aggregation) {
                throw new Error(t('Unknown aggregation.'));
            }
            await splunkPost('alerts/metric_alerts', {
                name: title,
                condition: metricAlertCondition(aggregation.name, series.metric, alertComparator(comparator), threshold),
                metric_indexes: props.metricIndexes === undefined ? '*' : props.metricIndexes.join(','),
                filter: '',
                'trigger.evaluation_per': '1m',
                'trigger.threshold': '1',
            });
            setDone(`${t('Saved streaming alert')} ${title}.`);
            return;
        }
        await splunkPost(
            'saved/searches',
            scheduledAlertFields({
                name: title,
                search: panel.search,
                earliest: panel.earliest,
                comparator: alertComparator(comparator),
                threshold,
                cron,
                severity: Number(severity),
                throttle,
            })
        );
        setDone(`${t('Saved scheduled alert')} ${title}.`);
    }

    async function saveBase(title: string): Promise<void> {
        const series = chart?.series[0];
        if (!series || series.source === 'base') {
            throw new Error(t('Open a metric, event, or dataset chart first.'));
        }
        const source = series.source === 'dataset' ? 'dataset' : series.source === 'event' ? 'event' : 'metric';
        const search = buildBaseSearchSpl({
            source,
            name: series.metric,
            filters: series.filters,
            indexes: props.eventIndexes,
            metricIndexes: props.metricIndexes,
        });
        const saved = baseSavedName(title);
        const owner = sharing === 'app' ? 'nobody' : currentUser();
        const fields: Record<string, string> = {
            name: saved,
            search,
            description: description.trim(),
            'dispatch.earliest_time': '-24h',
            'dispatch.latest_time': 'now',
            is_scheduled: baseMode === 'cached' ? '1' : '0',
        };
        if (baseMode === 'cached') {
            fields.cron_schedule = cron;
        }
        await splunkPost('saved/searches', fields, owner);
        if (sharing === 'app') {
            await splunkPost(`saved/searches/${encodeURIComponent(saved)}/acl`, {
                sharing: 'app',
                owner: 'nobody',
                'perms.read': '*',
                'perms.write': 'admin,sc_admin',
            });
        }
        await splunkPostJson('storage/collections/data/mx_base_searches', {
            name: title,
            description: description.trim(),
            spl: search,
            mode: baseMode,
            cron: baseMode === 'cached' ? cron : '',
            saved_search: saved,
            owner,
            sharing,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
        });
        setDone(`${t('Saved base search')} ${title}.`);
    }

    async function saveWorkspace(title: string): Promise<void> {
        const state = serializeSession(
            {
                charts: props.charts,
                layout: props.layout,
                range: props.range,
                latest: props.latest,
                catalogRange: props.catalogRange,
                globalSplit: props.globalSplit,
                globalFilters: props.globalFilters,
            },
            Date.now()
        );
        await splunkPostJson('storage/collections/data/mx_workspaces', {
            name: title,
            description: description.trim(),
            state,
            schemaVersion: 1,
            owner: currentUser(),
            sharing,
            updated: new Date().toISOString(),
        });
        setDone(`${t('Saved workspace')} ${title}.`);
        reloadWorkspaces();
    }

    const user = currentUser();
    const visibleWorkspaces = workspaces.filter((item) => item.sharing === 'app' || !item.owner || item.owner === user);

    return (
        <Backdrop onMouseDown={props.onClose}>
            <Dialog
                aria-label={t('Save')}
                onMouseDown={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    void save(event);
                }}
            >
                <strong>
                    {props.mode === 'report'
                        ? t('Save as report')
                        : props.mode === 'panel'
                          ? t('Save as dashboard panel')
                          : props.mode === 'all'
                            ? t('Save all charts')
                            : props.mode === 'base'
                              ? t('Save as base search')
                              : props.mode === 'alert'
                                ? t('Create alert')
                                : t('Workspaces')}
                </strong>
                {props.mode === 'panel' || props.mode === 'all' ? (
                    <Row>
                        {t('Format')}
                        <select aria-label={t('Dashboard format')} value={format} onChange={(event) => setFormat(event.target.value === 'studio' ? 'studio' : 'classic')}>
                            <option value="classic">{t('Classic')}</option>
                            <option value="studio">{t('Dashboard Studio')}</option>
                        </select>
                    </Row>
                ) : null}
                {props.mode === 'panel' || props.mode === 'all' ? (
                    <Row>
                        {t('Existing dashboard')}
                        <select aria-label={t('Existing dashboard')} value={existing} onChange={(event) => setExisting(event.target.value)}>
                            <option value="">{t('New dashboard')}</option>
                            {views.map((view) => (
                                <option key={view} value={view}>
                                    {view}
                                </option>
                            ))}
                        </select>
                    </Row>
                ) : null}
                {props.mode === 'alert' ? (
                    <>
                        <Row>
                            {t('Alert type')}
                            <select
                                aria-label={t('Alert type')}
                                value={alertKind}
                                onChange={(event) => setAlertKind(event.target.value === 'streaming' ? 'streaming' : 'scheduled')}
                            >
                                <option value="scheduled">{t('Scheduled')}</option>
                                {streamingOk ? <option value="streaming">{t('Streaming')}</option> : null}
                            </select>
                        </Row>
                        <Row>
                            {t('Condition')}
                            <select aria-label={t('Alert comparator')} value={comparator} onChange={(event) => setComparator(event.target.value)}>
                                <option value="greater than">{t('greater than')}</option>
                                <option value="less than">{t('less than')}</option>
                                <option value="equal to">{t('equal to')}</option>
                            </select>
                        </Row>
                        <Row>
                            {t('Threshold')}
                            <input aria-label={t('Alert threshold')} value={threshold} onChange={(event) => setThreshold(event.target.value)} />
                        </Row>
                        {alertKind === 'scheduled' ? (
                            <>
                                <Row>
                                    {t('Frequency')}
                                    <select aria-label={t('Alert frequency')} value={cron} onChange={(event) => setCron(event.target.value)}>
                                        {ALERT_SCHEDULES.map((item) => (
                                            <option key={item.id} value={item.id}>
                                                {item.label}
                                            </option>
                                        ))}
                                    </select>
                                </Row>
                                <Row>
                                    {t('Severity')}
                                    <select aria-label={t('Alert severity')} value={severity} onChange={(event) => setSeverity(event.target.value)}>
                                        <option value="1">{t('Info')}</option>
                                        <option value="2">{t('Low')}</option>
                                        <option value="3">{t('Medium')}</option>
                                        <option value="4">{t('High')}</option>
                                        <option value="5">{t('Critical')}</option>
                                    </select>
                                </Row>
                                <Row>
                                    {t('Throttle')}
                                    <input aria-label={t('Alert throttle')} placeholder={t('1h, or empty')} value={throttle} onChange={(event) => setThrottle(event.target.value)} />
                                </Row>
                            </>
                        ) : null}
                    </>
                ) : null}
                {props.mode === 'base' ? (
                    <Row>
                        {t('Mode')}
                        <select aria-label={t('Base search mode')} value={baseMode} onChange={(event) => setBaseMode(event.target.value === 'cached' ? 'cached' : 'live')}>
                            <option value="live">{t('Live')}</option>
                            <option value="cached">{t('Cached')}</option>
                        </select>
                    </Row>
                ) : null}
                {props.mode === 'base' || props.mode === 'workspace' ? (
                    <Row>
                        {t('Sharing')}
                        <select aria-label={t('Sharing')} value={sharing} onChange={(event) => setSharing(event.target.value === 'app' ? 'app' : 'private')}>
                            <option value="private">{t('Private')}</option>
                            <option value="app">{t('App')}</option>
                        </select>
                    </Row>
                ) : null}
                {props.mode === 'base' && baseMode === 'cached' ? (
                    <Row>
                        {t('Schedule')}
                        <select aria-label={t('Base search schedule')} value={cron} onChange={(event) => setCron(event.target.value)}>
                            {ALERT_SCHEDULES.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </Row>
                ) : null}
                {!existing || (props.mode !== 'panel' && props.mode !== 'all') ? (
                    <Row>
                        {t('Name')}
                        <input aria-label={t('Save name')} value={name} onChange={(event) => setName(event.target.value)} />
                    </Row>
                ) : null}
                {props.mode === 'report' || props.mode === 'base' || props.mode === 'workspace' ? (
                    <Row>
                        {t('Description')}
                        <input aria-label={t('Save description')} value={description} onChange={(event) => setDescription(event.target.value)} />
                    </Row>
                ) : null}
                {error ? <span role="alert">{error}</span> : null}
                {done ? <span role="status">{done}</span> : null}
                {props.mode === 'workspace' ? (
                    <div>
                        {visibleWorkspaces.length === 0 ? <span>{t('No saved workspaces.')}</span> : null}
                        {visibleWorkspaces.map((item) => (
                            <div key={item._key ?? item.name}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const session = parseSession(typeof item.state === 'string' ? item.state : null);
                                        if (!session) {
                                            setError(t('That workspace cannot be opened.'));
                                            return;
                                        }
                                        props.onOpenWorkspace(session);
                                        props.onClose();
                                    }}
                                >
                                    {t('Open workspace')} {item.name}
                                </button>
                                {item._key ? (
                                    <button
                                        type="button"
                                        aria-label={`Delete workspace ${item.name ?? ''}`}
                                        onClick={() => {
                                            void splunkDelete(`storage/collections/data/mx_workspaces/${encodeURIComponent(item._key ?? '')}`).then(reloadWorkspaces);
                                        }}
                                    >
                                        {t('Delete')}
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
                <Actions>
                    <button type="button" onClick={props.onClose}>
                        {t('Close')}
                    </button>
                    <button type="submit" disabled={busy}>
                        {busy ? t('Saving…') : t('Save')}
                    </button>
                </Actions>
            </Dialog>
        </Backdrop>
    );
}
