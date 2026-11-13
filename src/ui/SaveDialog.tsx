import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';

import { restEntries, splunkDelete, splunkGet, splunkPost, splunkPostJson } from '../api/splunkd';
import {
    alertComparator,
    alertCron,
    ALERT_SCHEDULES,
    EveryUnit,
    metricAlertCondition,
    metricAlertFilter,
    scheduledAlertFields,
    scriptFile,
    streamingAlertFields,
    timeAmount,
    webhookUrl,
} from '../actions/alerts';
import {
    appendClassicPanels,
    chartKind,
    classicDashboard,
    dashboardIdError,
    dashboardIdFromTitle,
    PanelSpec,
    studioDashboard,
} from '../actions/dashboards';
import { isCategorical } from '../chart/settings';
import { t } from '../i18n';
import { parseSession, SavedSession, serializeSession } from '../model/session';
import { ChartModel, GlobalSplitLimit, globalFiltersFor, resolveSeries, SeriesFilter } from '../model/workspace';
import { baseSavedName, buildBaseSearchSpl } from '../spl/buildMstats';
import { resolveForSource } from '../spl/functions';
import { buildSeriesSearch } from '../spl/seriesSearch';
import { AlertPreview } from './AlertPreview';
import { ChartSaveMode } from './ChartView';
import { Button, FormRow, Hint, Inline, Input, Modal, Picker } from './Modal';

export type SaveMode = ChartSaveMode | 'all-classic' | 'all-studio' | 'workspace';

type WorkspaceRow = { _key?: string; name?: string; description?: string; state?: string; owner?: string; sharing?: string };
type Sharing = 'private' | 'app';

const TITLES: Record<SaveMode, string> = {
    report: 'Save as report',
    'panel-classic': 'Save as dashboard panel',
    'panel-studio': 'Save to Dashboard Studio',
    'all-classic': 'Save all charts to Classic Dashboards',
    'all-studio': 'Save all charts to Dashboard Studio',
    base: 'Save as base search',
    'alert-scheduled': 'Save as scheduled alert',
    'alert-streaming': 'Save as streaming alert',
    workspace: 'Workspaces',
};

const Area = styled.textarea`
    padding: 5px 8px;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: 4px;
    background: ${variables.backgroundColorSection};
    color: ${variables.contentColorDefault};
    font: inherit;
    min-height: 48px;
    resize: vertical;
`;

const Column = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
`;

const Section = styled.div`
    padding-top: 6px;
    border-top: 1px solid ${variables.neutral200};
    font-weight: 600;
`;

const Message = styled.div<{ $error?: boolean }>`
    padding: 8px 10px;
    border-radius: 4px;
    background: ${(props) => (props.$error ? variables.accentColorNegative : variables.backgroundColorPage)};
    color: ${(props) => (props.$error ? variables.contentColorInverted : variables.contentColorDefault)};
`;

const ActionBox = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid ${variables.neutral200};
    border-radius: 4px;
`;

function currentUser(): string {
    return (window as unknown as { $C?: { USERNAME?: string } }).$C?.USERNAME ?? 'admin';
}

function locale(): string {
    return window.location.pathname.split('/').filter(Boolean)[0] ?? 'en-US';
}

function Radio<T extends string>(props: {
    name: string;
    label: string;
    value: T;
    options: Array<[T, string]>;
    onChange: (value: T) => void;
}): React.ReactElement {
    return (
        <Inline role="radiogroup" aria-label={props.label}>
            {props.options.map(([value, label]) => (
                <label key={value}>
                    <input type="radio" name={props.name} checked={props.value === value} onChange={() => props.onChange(value)} /> {label}
                </label>
            ))}
        </Inline>
    );
}

function panelsFor(
    charts: ChartModel[],
    span: string,
    range: string,
    latest: string,
    globalSplit: string,
    globalLimit: GlobalSplitLimit,
    globalFilters: SeriesFilter[],
    metricDims: Record<string, string[]>,
    indexes: string[],
    metricIndexes?: string[]
): PanelSpec[] {
    const panels: PanelSpec[] = [];
    for (const chart of charts) {
        const series = resolveSeries(chart.series, globalSplit, chart.useGlobalSplit, globalLimit).map((item) => ({
            ...item,
            filters: [...globalFiltersFor(item, globalFilters, metricDims), ...item.filters],
        }));
        const item = series[0];
        if (!item || resolveForSource(item.source, item.aggregation)?.chart === 'table') {
            continue;
        }
        const trellis = chart.trellis?.dimension ? chart.trellis : undefined;
        const query = buildSeriesSearch(
            item,
            chart.settings.span || span,
            range,
            latest,
            indexes,
            metricIndexes,
            isCategorical(chart.settings.type),
            trellis && (item.source ?? 'metric') === 'metric' ? trellis.dimension : ''
        );
        const kind = chartKind(chart.settings.type);
        panels.push({
            title: item.metric,
            search: query.search,
            earliest: query.earliest,
            latest: query.latest,
            chart: kind.chart,
            stacked: kind.stacked,
            trellis: trellis
                ? {
                      splitBy: trellis.dimension,
                      minColumnWidth: trellis.minColumnWidth,
                      rowHeight: trellis.rowHeight,
                      columns: trellis.columns,
                      pageSize: trellis.pageSize,
                  }
                : undefined,
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
    globalLimit: GlobalSplitLimit;
    globalFilters: SeriesFilter[];
    globalSpan: string;
    metricDims: Record<string, string[]>;
    eventIndexes: string[];
    metricIndexes?: string[];
    onClose: () => void;
    onOpenWorkspace: (session: SavedSession) => void;
}): React.ReactElement {
    const { mode } = props;
    const chart = props.charts.find((item) => item.id === props.chartId) ?? props.charts[0];
    const series = chart?.series[0];
    const all = mode === 'all-classic' || mode === 'all-studio';
    const classic = mode === 'panel-classic' || mode === 'all-classic';
    const studio = mode === 'panel-studio' || mode === 'all-studio';
    const alert = mode === 'alert-scheduled' || mode === 'alert-streaming';
    const targets = all ? props.charts : chart ? [chart] : [];

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [sharing, setSharing] = useState<Sharing>('private');
    const [dashboard, setDashboard] = useState<'new' | 'existing'>('new');
    const [dashboardId, setDashboardId] = useState('');
    const [existing, setExisting] = useState('');
    const [views, setViews] = useState<Array<{ name: string; label: string }>>([]);
    const [timeInput, setTimeInput] = useState(true);
    const [panelTitle, setPanelTitle] = useState(series?.metric ?? '');
    const [studioLayout, setStudioLayout] = useState<'absolute' | 'grid'>('absolute');
    const [content, setContent] = useState<'both' | 'chart' | 'table'>('chart');
    const [reportPicker, setReportPicker] = useState(false);
    const [baseMode, setBaseMode] = useState<'live' | 'cached'>('live');
    const [baseCron, setBaseCron] = useState<string>(ALERT_SCHEDULES[1].id);
    const [every, setEvery] = useState('1');
    const [everyUnit, setEveryUnit] = useState<EveryUnit>('h');
    const [minute, setMinute] = useState(0);
    const [comparator, setComparator] = useState('greater than');
    const [threshold, setThreshold] = useState('');
    const [windowAmount, setWindowAmount] = useState('1');
    const [windowUnit, setWindowUnit] = useState('h');
    const [throttleOn, setThrottleOn] = useState(true);
    const [throttleAmount, setThrottleAmount] = useState('10');
    const [throttleUnit, setThrottleUnit] = useState(mode === 'alert-streaming' ? 'm' : 's');
    const [track, setTrack] = useState(true);
    const [severity, setSeverity] = useState('1');
    const [email, setEmail] = useState(false);
    const [emailTo, setEmailTo] = useState('');
    const [webhook, setWebhook] = useState(false);
    const [webhookTo, setWebhookTo] = useState('');
    const [script, setScript] = useState(false);
    const [scriptName, setScriptName] = useState('');
    const [streamingOk, setStreamingOk] = useState(true);
    const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
    const [error, setError] = useState('');
    const [done, setDone] = useState('');
    const [link, setLink] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!classic) {
            return undefined;
        }
        let alive = true;
        splunkGet('data/ui/views?count=200&search=isDashboard%3D1')
            .then((body) => {
                if (!alive) {
                    return;
                }
                const rows = restEntries(body)
                    .filter((item) => {
                        const data = item.content['eai:data'];
                        return typeof data !== 'string' || !/<dashboard[^>]*version="2"/.test(data);
                    })
                    .map((item) => ({ name: item.name, label: typeof item.content.label === 'string' && item.content.label ? item.content.label : item.name }))
                    .filter((item) => item.name)
                    .sort((left, right) => left.label.localeCompare(right.label));
                setViews(rows);
            })
            .catch(() => {
                if (alive) {
                    setViews([]);
                }
            });
        return () => {
            alive = false;
        };
    }, [classic]);

    useEffect(() => {
        if (mode !== 'alert-streaming') {
            return undefined;
        }
        let alive = true;
        splunkGet('alerts/metric_alerts?count=1')
            .then(() => alive && setStreamingOk(true))
            .catch(() => alive && setStreamingOk(false));
        return () => {
            alive = false;
        };
    }, [mode]);

    function reloadWorkspaces(): void {
        splunkGet('storage/collections/data/mx_workspaces?limit=100')
            .then((body) => setWorkspaces(Array.isArray(body) ? (body as WorkspaceRow[]) : []))
            .catch(() => setWorkspaces([]));
    }

    useEffect(() => {
        if (mode === 'workspace') {
            reloadWorkspaces();
        }
    }, [mode]);

    function panels(): PanelSpec[] {
        const list = panelsFor(
            targets,
            props.span,
            props.range,
            props.latest,
            props.globalSplit,
            props.globalLimit,
            props.globalFilters,
            props.metricDims,
            props.eventIndexes,
            props.metricIndexes
        );
        if (list.length === 0) {
            throw new Error(t('Nothing to save.'));
        }
        if (!all && panelTitle.trim()) {
            list[0] = { ...list[0], title: panelTitle.trim() };
        }
        return list;
    }

    /** Private objects live in the user's namespace. Shared ones are created there too and then moved to the app. */
    async function share(path: string): Promise<void> {
        if (sharing !== 'app') {
            return;
        }
        await splunkPost(`${path}/acl`, { sharing: 'app', owner: currentUser() }, currentUser());
    }

    async function save(): Promise<void> {
        setError('');
        setDone('');
        setLink('');
        const title = name.trim();
        const needsTitle = !(classic && dashboard === 'existing');
        if (needsTitle && !title) {
            setError(studio || classic ? t('Enter a dashboard title.') : t('Enter a title.'));
            return;
        }
        setBusy(true);
        try {
            if (mode === 'report') {
                await saveReport(title);
            } else if (classic) {
                await saveClassic(title);
            } else if (studio) {
                await saveStudio(title);
            } else if (mode === 'alert-scheduled') {
                await saveScheduled(title);
            } else if (mode === 'alert-streaming') {
                await saveStreaming(title);
            } else if (mode === 'base') {
                await saveBase(title);
            } else {
                await saveWorkspace(title);
            }
        } catch (caught) {
            setError(caught instanceof Error ? t(caught.message) : t('Could not save.'));
        } finally {
            setBusy(false);
        }
    }

    async function saveReport(title: string): Promise<void> {
        const panel = panels()[0];
        await splunkPost(
            'saved/searches',
            {
                name: title,
                search: panel.search,
                description: description.trim(),
                'dispatch.earliest_time': panel.earliest,
                'dispatch.latest_time': panel.latest,
                'display.general.type': content === 'table' ? 'statistics' : 'visualizations',
                'display.visualizations.show': content === 'table' ? '0' : '1',
                'display.statistics.show': content === 'chart' ? '0' : '1',
                'display.visualizations.charting.chart': panel.chart,
                'display.general.timeRangePicker.show': reportPicker ? '1' : '0',
                'request.ui_dispatch_view': 'search',
            },
            currentUser()
        );
        await share(`saved/searches/${encodeURIComponent(title)}`);
        setDone(`${t('Saved report')} ${title}.`);
    }

    async function saveClassic(title: string): Promise<void> {
        const list = panels();
        if (dashboard === 'existing') {
            if (!existing) {
                throw new Error(t('Select a dashboard.'));
            }
            const body = await splunkGet(`data/ui/views/${encodeURIComponent(existing)}`);
            const entry = restEntries(body)[0];
            const current = typeof entry?.content['eai:data'] === 'string' ? entry.content['eai:data'] : '';
            await splunkPost(`data/ui/views/${encodeURIComponent(existing)}`, { 'eai:data': appendClassicPanels(current, list) });
            setDone(`${t('Added the charts to')} ${existing}.`);
            setLink(`/${locale()}/app/metric_explorer_ng/${encodeURIComponent(existing)}`);
            return;
        }
        const id = dashboardId.trim();
        const idError = dashboardIdError(id);
        if (idError) {
            throw new Error(t(idError));
        }
        await splunkPost(
            'data/ui/views',
            { name: id, 'eai:data': classicDashboard(title, list, { description, timeInput }) },
            currentUser()
        );
        await share(`data/ui/views/${encodeURIComponent(id)}`);
        setDone(`${t('Saved dashboard')} ${title}.`);
        setLink(`/${locale()}/app/metric_explorer_ng/${encodeURIComponent(id)}`);
    }

    async function saveStudio(title: string): Promise<void> {
        const id = dashboardIdFromTitle(title);
        await splunkPost(
            'data/ui/views',
            { name: id, 'eai:data': studioDashboard(title, panels(), { description, layout: studioLayout }) },
            currentUser()
        );
        await share(`data/ui/views/${encodeURIComponent(id)}`);
        setDone(`${t('Saved dashboard')} ${title}.`);
        setLink(`/${locale()}/app/metric_explorer_ng/${encodeURIComponent(id)}`);
    }

    function throttle(units: readonly string[]): string {
        if (!throttleOn) {
            return '';
        }
        const value = timeAmount(throttleAmount, throttleUnit, units);
        if (!value) {
            throw new Error(t('Enter a whole number for the throttle.'));
        }
        return value;
    }

    function recipients(): string {
        return email ? emailTo : '';
    }

    function webhookTarget(): string {
        return webhook ? webhookUrl(webhookTo) : '';
    }

    function scriptTarget(): string {
        return script ? scriptFile(scriptName) : '';
    }

    async function saveScheduled(title: string): Promise<void> {
        const panel = panels()[0];
        const cron = alertCron(every, everyUnit, minute);
        if (!cron) {
            throw new Error(t('Enter how often the alert runs, for example every 1 hour.'));
        }
        const window = timeAmount(windowAmount, windowUnit, ['m', 'h', 'd', 'w']);
        if (!window) {
            throw new Error(t('Enter a whole number for the time window.'));
        }
        const fields = scheduledAlertFields({
            name: title,
            search: panel.search,
            earliest: `-${window}`,
            comparator: alertComparator(comparator),
            threshold,
            cron,
            severity: Number(severity),
            throttle: throttle(['s', 'm', 'h', 'd']),
            description,
            emailTo: recipients(),
            webhookUrl: webhookTarget(),
            scriptFile: scriptTarget(),
        });
        if (!track) {
            fields['alert.track'] = '0';
        }
        await splunkPost('saved/searches', fields, currentUser());
        await share(`saved/searches/${encodeURIComponent(title)}`);
        setDone(`${t('Saved scheduled alert')} ${title}.`);
    }

    async function saveStreaming(title: string): Promise<void> {
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
        const resolved = resolveSeries([series], props.globalSplit, chart?.useGlobalSplit ?? true, props.globalLimit)[0] ?? series;
        const fields = streamingAlertFields({
            name: title,
            condition: metricAlertCondition(aggregation.name, series.metric, alertComparator(comparator), threshold),
            metricIndexes: props.metricIndexes === undefined || props.metricIndexes.length === 0 ? '*' : props.metricIndexes.join(','),
            filter: metricAlertFilter([...globalFiltersFor(series, props.globalFilters, props.metricDims), ...series.filters]),
            groupby: resolved.splitBy ?? '',
            severity: Number(severity),
            throttleMinutes: throttleOn ? throttleAmount : '',
            description,
            emailTo: recipients(),
            webhookUrl: webhookTarget(),
            scriptFile: scriptTarget(),
        });
        if (!track) {
            fields['splunk_ui.track'] = '0';
        }
        await splunkPost('alerts/metric_alerts', fields, currentUser());
        await share(`alerts/metric_alerts/${encodeURIComponent(title)}`);
        setDone(`${t('Saved streaming alert')} ${title}.`);
    }

    async function saveBase(title: string): Promise<void> {
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
            fields.cron_schedule = baseCron;
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
            cron: baseMode === 'cached' ? baseCron : '',
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
                globalLimit: props.globalLimit,
                globalFilters: props.globalFilters,
                globalSpan: props.globalSpan,
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
    const span = chart?.settings.span || props.span;
    const finished = Boolean(done);

    const sharingRow = (
        <FormRow>
            <span>{t('Permissions')}</span>
            <Radio
                name="mx-sharing"
                label={t('Permissions')}
                value={sharing}
                options={[
                    ['private', t('Private')],
                    ['app', t('Shared in App')],
                ]}
                onChange={setSharing}
            />
        </FormRow>
    );

    const titleRow = (label: string, hint?: string) => (
        <FormRow>
            <span>{label}</span>
            <Column>
                <Input aria-label={label} value={name} onChange={(event) => setName(event.target.value)} />
                {hint ? <Hint>{hint}</Hint> : null}
            </Column>
        </FormRow>
    );

    const descriptionRow = (
        <FormRow>
            <span>{t('Description')}</span>
            <Area aria-label={t('Description')} placeholder={t('optional')} value={description} onChange={(event) => setDescription(event.target.value)} />
        </FormRow>
    );

    return (
        <Modal
            title={t(TITLES[mode])}
            width={alert ? 640 : 560}
            onClose={props.onClose}
            onSubmit={() => {
                if (!finished && mode !== 'workspace') {
                    void save();
                }
            }}
            footer={
                finished && mode !== 'workspace' ? (
                    <>
                        {link ? (
                            <Button as="a" href={link} target="_blank" rel="noopener">
                                {t('View dashboard')}
                            </Button>
                        ) : null}
                        <Button type="button" $primary onClick={props.onClose}>
                            {t('Done')}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button type="button" onClick={props.onClose}>
                            {mode === 'workspace' ? t('Close') : t('Cancel')}
                        </Button>
                        <Button type={mode === 'workspace' ? 'button' : 'submit'} $primary disabled={busy} onClick={mode === 'workspace' ? () => void save() : undefined}>
                            {busy ? t('Saving…') : t('Save')}
                        </Button>
                    </>
                )
            }
        >
            {finished ? <Message role="status">{done}</Message> : null}
            {!finished && mode === 'report' ? (
                <>
                    {titleRow(t('Title'))}
                    {descriptionRow}
                    <FormRow>
                        <span>{t('Content')}</span>
                        <Radio
                            name="mx-report-content"
                            label={t('Content')}
                            value={content}
                            options={[
                                ['both', t('Line chart + table')],
                                ['chart', t('Line chart')],
                                ['table', t('Statistics table')],
                            ]}
                            onChange={setContent}
                        />
                    </FormRow>
                    <FormRow>
                        <span>{t('Time range picker')}</span>
                        <Radio
                            name="mx-report-picker"
                            label={t('Time range picker')}
                            value={reportPicker ? 'yes' : 'no'}
                            options={[
                                ['yes', t('Yes')],
                                ['no', t('No')],
                            ]}
                            onChange={(value) => setReportPicker(value === 'yes')}
                        />
                    </FormRow>
                    {sharingRow}
                </>
            ) : null}
            {!finished && classic ? (
                <>
                    <FormRow>
                        <span>{t('Dashboard')}</span>
                        <Radio
                            name="mx-dashboard"
                            label={t('Dashboard')}
                            value={dashboard}
                            options={[
                                ['new', t('New')],
                                ['existing', t('Existing')],
                            ]}
                            onChange={setDashboard}
                        />
                    </FormRow>
                    {dashboard === 'existing' ? (
                        <FormRow>
                            <span>{t('Dashboard')}</span>
                            <Picker aria-label={t('Existing dashboard')} value={existing} onChange={(event) => setExisting(event.target.value)}>
                                <option value="">{t('Select a dashboard')}</option>
                                {views.map((view) => (
                                    <option key={view.name} value={view.name}>
                                        {view.label}
                                    </option>
                                ))}
                            </Picker>
                        </FormRow>
                    ) : (
                        <>
                            {titleRow(t('Dashboard title'))}
                            <FormRow>
                                <span>{t('Dashboard ID')}</span>
                                <Column>
                                    <Input
                                        aria-label={t('Dashboard ID')}
                                        value={dashboardId}
                                        placeholder={dashboardIdFromTitle(name)}
                                        onChange={(event) => setDashboardId(event.target.value)}
                                        onFocus={() => {
                                            if (!dashboardId && name.trim()) {
                                                setDashboardId(dashboardIdFromTitle(name));
                                            }
                                        }}
                                    />
                                    <Hint>{t('The dashboard ID may only contain letters, numbers, and underscores.')}</Hint>
                                </Column>
                            </FormRow>
                            <FormRow>
                                <span>{t('Dashboard description')}</span>
                                <Area
                                    aria-label={t('Dashboard description')}
                                    placeholder={t('optional')}
                                    value={description}
                                    onChange={(event) => setDescription(event.target.value)}
                                />
                            </FormRow>
                            <FormRow>
                                <span />
                                <label>
                                    <input type="checkbox" checked={timeInput} onChange={(event) => setTimeInput(event.target.checked)} />{' '}
                                    {t('Add interactive time picker')}
                                </label>
                            </FormRow>
                            {sharingRow}
                        </>
                    )}
                    {!all ? (
                        <FormRow>
                            <span>{t('Panel title')}</span>
                            <Input aria-label={t('Panel title')} value={panelTitle} onChange={(event) => setPanelTitle(event.target.value)} />
                        </FormRow>
                    ) : null}
                </>
            ) : null}
            {!finished && studio ? (
                <>
                    {titleRow(t('Title'))}
                    {descriptionRow}
                    <FormRow>
                        <span>{t('Layout')}</span>
                        <Radio
                            name="mx-studio-layout"
                            label={t('Layout')}
                            value={studioLayout}
                            options={[
                                ['absolute', t('Absolute')],
                                ['grid', t('Grid')],
                            ]}
                            onChange={setStudioLayout}
                        />
                    </FormRow>
                    {sharingRow}
                </>
            ) : null}
            {!finished && alert ? (
                <>
                    {(() => {
                        try {
                            const panel = panels()[0];
                            return panel ? (
                                <AlertPreview
                                    search={panel.search}
                                    earliest={panel.earliest}
                                    latest={panel.latest}
                                    seriesName={panel.title}
                                    categorical={isCategorical(chart?.settings.type ?? 'line')}
                                />
                            ) : null;
                        } catch (caught) {
                            return <Message $error>{caught instanceof Error ? caught.message : t('Nothing to save.')}</Message>;
                        }
                    })()}
                    {mode === 'alert-streaming' && !streamingOk ? (
                        <Message $error role="alert">
                            {t('Streaming alerts are not available on this instance.')}
                        </Message>
                    ) : null}
                    {titleRow(t('Title'))}
                    {descriptionRow}
                    {sharingRow}
                    {mode === 'alert-scheduled' ? (
                        <FormRow>
                            <span>{t('Evaluate every')}</span>
                            <Inline>
                                <Input aria-label={t('Evaluate every')} style={{ width: 56 }} value={every} onChange={(event) => setEvery(event.target.value)} />
                                <Picker aria-label={t('Evaluation unit')} value={everyUnit} onChange={(event) => setEveryUnit(event.target.value as EveryUnit)}>
                                    <option value="m">{t('Minutes')}</option>
                                    <option value="h">{t('Hours')}</option>
                                    <option value="d">{t('Days')}</option>
                                </Picker>
                                {everyUnit !== 'm' ? (
                                    <>
                                        {t('At')}
                                        <Picker aria-label={t('Minutes past the hour')} value={minute} onChange={(event) => setMinute(Number(event.target.value))}>
                                            {[0, 15, 30, 45].map((value) => (
                                                <option key={value} value={value}>
                                                    {value}
                                                </option>
                                            ))}
                                        </Picker>
                                        {t('minutes past the hour')}
                                    </>
                                ) : null}
                            </Inline>
                        </FormRow>
                    ) : null}
                    <Section>{t('Trigger')}</Section>
                    <FormRow>
                        <span>{t('Alert when')}</span>
                        <Column>
                            <span>
                                {series?.metric ?? ''} ({t('over')} {span} {t('intervals')})
                            </span>
                            <Inline>
                                <Picker aria-label={t('Alert comparator')} value={comparator} onChange={(event) => setComparator(event.target.value)}>
                                    <option value="greater than">{t('Is greater than')}</option>
                                    <option value="less than">{t('Is less than')}</option>
                                    <option value="equal to">{t('Is equal to')}</option>
                                </Picker>
                                <Input aria-label={t('Alert threshold')} style={{ width: 96 }} value={threshold} onChange={(event) => setThreshold(event.target.value)} />
                            </Inline>
                        </Column>
                    </FormRow>
                    {mode === 'alert-scheduled' ? (
                        <FormRow>
                            <span>{t('In the last')}</span>
                            <Inline>
                                <Input aria-label={t('In the last')} style={{ width: 56 }} value={windowAmount} onChange={(event) => setWindowAmount(event.target.value)} />
                                <Picker aria-label={t('Time window unit')} value={windowUnit} onChange={(event) => setWindowUnit(event.target.value)}>
                                    <option value="m">{t('Minutes')}</option>
                                    <option value="h">{t('Hours')}</option>
                                    <option value="d">{t('Days')}</option>
                                    <option value="w">{t('Weeks')}</option>
                                </Picker>
                            </Inline>
                        </FormRow>
                    ) : null}
                    <FormRow>
                        <span>{t('Throttle')}</span>
                        <Column>
                            <label>
                                <input type="checkbox" checked={throttleOn} onChange={(event) => setThrottleOn(event.target.checked)} /> {t('Suppress triggering for')}
                            </label>
                            {throttleOn ? (
                                <Inline>
                                    <Input aria-label={t('Suppress triggering for')} style={{ width: 56 }} value={throttleAmount} onChange={(event) => setThrottleAmount(event.target.value)} />
                                    {mode === 'alert-streaming' ? (
                                        <span>{t('Minutes')}</span>
                                    ) : (
                                        <Picker aria-label={t('Throttle unit')} value={throttleUnit} onChange={(event) => setThrottleUnit(event.target.value)}>
                                            <option value="s">{t('Seconds')}</option>
                                            <option value="m">{t('Minutes')}</option>
                                            <option value="h">{t('Hours')}</option>
                                            <option value="d">{t('Days')}</option>
                                        </Picker>
                                    )}
                                </Inline>
                            ) : null}
                        </Column>
                    </FormRow>
                    <Section>{t('Trigger actions')}</Section>
                    {track ? (
                        <ActionBox>
                            <Inline style={{ justifyContent: 'space-between' }}>
                                <strong>{t('Add to Triggered Alerts')}</strong>
                                <Button type="button" aria-label={t('Remove action')} onClick={() => setTrack(false)}>
                                    ×
                                </Button>
                            </Inline>
                            <FormRow>
                                <span>{t('Severity')}</span>
                                <Picker aria-label={t('Alert severity')} value={severity} onChange={(event) => setSeverity(event.target.value)}>
                                    <option value="1">{t('Info')}</option>
                                    <option value="2">{t('Low')}</option>
                                    <option value="3">{t('Medium')}</option>
                                    <option value="4">{t('High')}</option>
                                    <option value="5">{t('Critical')}</option>
                                </Picker>
                            </FormRow>
                        </ActionBox>
                    ) : null}
                    {email ? (
                        <ActionBox>
                            <Inline style={{ justifyContent: 'space-between' }}>
                                <strong>{t('Send email')}</strong>
                                <Button type="button" aria-label={t('Remove action')} onClick={() => setEmail(false)}>
                                    ×
                                </Button>
                            </Inline>
                            <FormRow>
                                <span>{t('To')}</span>
                                <Column>
                                    <Input aria-label={t('Email recipients')} value={emailTo} onChange={(event) => setEmailTo(event.target.value)} />
                                    <Hint>{t('Comma separated list of email addresses.')}</Hint>
                                </Column>
                            </FormRow>
                        </ActionBox>
                    ) : null}
                    {webhook ? (
                        <ActionBox>
                            <Inline style={{ justifyContent: 'space-between' }}>
                                <strong>{t('Webhook')}</strong>
                                <Button type="button" aria-label={t('Remove action')} onClick={() => setWebhook(false)}>
                                    ×
                                </Button>
                            </Inline>
                            <FormRow>
                                <span>{t('URL')}</span>
                                <Column>
                                    <Input aria-label={t('Webhook URL')} value={webhookTo} onChange={(event) => setWebhookTo(event.target.value)} placeholder="https://" />
                                    <Hint>{t('An http or https address. Splunk calls it when the alert fires.')}</Hint>
                                </Column>
                            </FormRow>
                        </ActionBox>
                    ) : null}
                    {script ? (
                        <ActionBox>
                            <Inline style={{ justifyContent: 'space-between' }}>
                                <strong>{t('Run a script')}</strong>
                                <Button type="button" aria-label={t('Remove action')} onClick={() => setScript(false)}>
                                    ×
                                </Button>
                            </Inline>
                            <FormRow>
                                <span>{t('File name')}</span>
                                <Column>
                                    <Input aria-label={t('Script file name')} value={scriptName} onChange={(event) => setScriptName(event.target.value)} />
                                    <Hint>{t('A file name in the Splunk scripts directory, without a path.')}</Hint>
                                </Column>
                            </FormRow>
                        </ActionBox>
                    ) : null}
                    <Inline>
                        {!track ? (
                            <Button type="button" onClick={() => setTrack(true)}>
                                + {t('Add to Triggered Alerts')}
                            </Button>
                        ) : null}
                        {!email ? (
                            <Button type="button" onClick={() => setEmail(true)}>
                                + {t('Send email')}
                            </Button>
                        ) : null}
                        {!webhook ? (
                            <Button type="button" onClick={() => setWebhook(true)}>
                                + {t('Webhook')}
                            </Button>
                        ) : null}
                        {!script ? (
                            <Button type="button" onClick={() => setScript(true)}>
                                + {t('Run a script')}
                            </Button>
                        ) : null}
                    </Inline>
                </>
            ) : null}
            {!finished && mode === 'base' ? (
                <>
                    {titleRow(t('Name'))}
                    {descriptionRow}
                    <FormRow>
                        <span>{t('Mode')}</span>
                        <Radio
                            name="mx-base-mode"
                            label={t('Base search mode')}
                            value={baseMode}
                            options={[
                                ['live', t('Live')],
                                ['cached', t('Cached')],
                            ]}
                            onChange={setBaseMode}
                        />
                    </FormRow>
                    {baseMode === 'cached' ? (
                        <FormRow>
                            <span>{t('Schedule')}</span>
                            <Picker aria-label={t('Base search schedule')} value={baseCron} onChange={(event) => setBaseCron(event.target.value)}>
                                {ALERT_SCHEDULES.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {t(item.label)}
                                    </option>
                                ))}
                            </Picker>
                        </FormRow>
                    ) : null}
                    {sharingRow}
                </>
            ) : null}
            {mode === 'workspace' ? (
                <>
                    {titleRow(t('Name'))}
                    {descriptionRow}
                    {sharingRow}
                    {done ? <Message role="status">{done}</Message> : null}
                    <Section>{t('Saved workspaces')}</Section>
                    {visibleWorkspaces.length === 0 ? <Hint>{t('No saved workspaces.')}</Hint> : null}
                    {visibleWorkspaces.map((item) => (
                        <Inline key={item._key ?? item.name} style={{ justifyContent: 'space-between' }}>
                            <Button
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
                            </Button>
                            {item._key ? (
                                <Button
                                    type="button"
                                    aria-label={`${t('Delete workspace')} ${item.name ?? ''}`}
                                    onClick={() => {
                                        void splunkDelete(`storage/collections/data/mx_workspaces/${encodeURIComponent(item._key ?? '')}`).then(reloadWorkspaces);
                                    }}
                                >
                                    {t('Delete')}
                                </Button>
                            ) : null}
                        </Inline>
                    ))}
                </>
            ) : null}
            {error ? (
                <Message $error role="alert">
                    {error}
                </Message>
            ) : null}
        </Modal>
    );
}
