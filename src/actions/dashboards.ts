export type PanelSpec = {
    title: string;
    search: string;
    earliest: string;
    latest: string;
    /** line, area, or column. A heatmap is stored as a column chart, as in the original workspace. */
    chart: 'line' | 'area' | 'column';
    stacked: boolean;
    /** Present when the chart is drawn as one small chart per value of this field. */
    trellis?: { splitBy: string; minColumnWidth: number; rowHeight: number; columns: number; pageSize: number };
    /** Line and area charts leave missing points unconnected. Off draws through them. */
    showGaps?: boolean;
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

export function dashboardNameError(name: string): string {
    const text = name.trim();
    if (!NAME.test(text)) {
        return 'Use letters, numbers, and . _ : -. Start with a letter or number. No spaces.';
    }
    return '';
}

function xml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cdata(value: string): string {
    if (value.includes(']]>')) {
        throw new Error('The search cannot be stored.');
    }
    return `<![CDATA[${value}]]>`;
}

const ID = /^[A-Za-z0-9_]{1,80}$/;

/** The dashboard ID is its file name: letters, digits, and underscores only. */
export function dashboardIdError(id: string): string {
    return ID.test(id.trim()) ? '' : 'The ID may only contain letters, digits, and underscores.';
}

/** An ID made from a title, for dashboards where only a title is asked: `CPU load` becomes `cpu_load`. */
export function dashboardIdFromTitle(title: string): string {
    const id = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return id || 'dashboard';
}

/** Token of the interactive time input. Panels read their range from it when the dashboard has one. */
export const TIME_TOKEN = 'mx_time';
export const SPLIT_TOKEN = 'mx_split';
export const SPAN_TOKEN = 'mx_span';

export type SplitDashboardInput = {
    field: string;
    label: string;
    search: string;
    allLabel?: string;
};

export type SpanDashboardInput = {
    defaultSpan: string;
    presets: readonly string[];
    label?: string;
};

export type DashboardExportOptions = {
    description?: string;
    timeInput?: boolean;
    splitInput?: SplitDashboardInput;
    spanInput?: SpanDashboardInput;
    theme?: 'light' | 'dark';
    layout?: 'absolute' | 'grid';
};

/** Puts `| search $mx_split$` on the rows that still carry the split field. */
export function withSplitSearch(search: string, token = SPLIT_TOKEN): string {
    const needle = ` | search $${token}$`;
    if (search.includes(needle)) {
        return search;
    }
    const marks = [' | eval {', ' | chart ', ' | timechart '];
    let at = -1;
    for (const mark of marks) {
        const index = search.indexOf(mark);
        if (index >= 0 && (at < 0 || index < at)) {
            at = index;
        }
    }
    if (at < 0) {
        return `${search}${needle}`;
    }
    return `${search.slice(0, at)}${needle}${search.slice(at)}`;
}

/** Replaces every `span=30s` with the dashboard span token. */
export function withSpanToken(search: string, token = SPAN_TOKEN): string {
    return search.replace(/\bspan=\d+[smhd]\b/g, `span=$${token}$`);
}

function applyExportTokens(search: string, options: DashboardExportOptions): string {
    let next = search;
    if (options.splitInput) {
        next = withSplitSearch(next);
    }
    if (options.spanInput) {
        next = withSpanToken(next);
    }
    return next;
}

function classicFieldset(panels: PanelSpec[], options: DashboardExportOptions): string {
    const parts: string[] = [];
    if (options.timeInput) {
        parts.push(`    <input type="time" token="${TIME_TOKEN}">
      <label></label>
      <default>
        <earliest>${xml(panels[0].earliest)}</earliest>
        <latest>${xml(panels[0].latest)}</latest>
      </default>
    </input>`);
    }
    if (options.splitInput) {
        const field = options.splitInput.field;
        const all = options.splitInput.allLabel ?? 'All';
        const earliest = options.timeInput ? `$${TIME_TOKEN}.earliest$` : panels[0].earliest;
        const latest = options.timeInput ? `$${TIME_TOKEN}.latest$` : panels[0].latest;
        parts.push(`    <input type="multiselect" token="${SPLIT_TOKEN}" searchWhenChanged="true">
      <label>${xml(options.splitInput.label)}</label>
      <choice value="*">${xml(all)}</choice>
      <default>*</default>
      <initialValue>*</initialValue>
      <prefix>(</prefix>
      <suffix>)</suffix>
      <valuePrefix>${xml(field)}="</valuePrefix>
      <valueSuffix>"</valueSuffix>
      <delimiter> OR </delimiter>
      <fieldForLabel>${xml(field)}</fieldForLabel>
      <fieldForValue>${xml(field)}</fieldForValue>
      <search>
        <query>${cdata(options.splitInput.search)}</query>
        <earliest>${xml(earliest)}</earliest>
        <latest>${xml(latest)}</latest>
      </search>
    </input>`);
    }
    if (options.spanInput) {
        const choices = options.spanInput.presets
            .map((span) => `      <choice value="${xml(span)}">${xml(span)}</choice>`)
            .join('\n');
        parts.push(`    <input type="dropdown" token="${SPAN_TOKEN}" searchWhenChanged="true">
      <label>${xml(options.spanInput.label ?? 'Time span')}</label>
      <default>${xml(options.spanInput.defaultSpan)}</default>
${choices}
    </input>`);
    }
    if (parts.length === 0) {
        return '';
    }
    return `
  <fieldset submitButton="false">
${parts.join('\n')}
  </fieldset>`;
}

function panelXml(panel: PanelSpec, timeInput = false): string {
    const stack = panel.stacked ? '\n          <option name="charting.chart.stackMode">stacked</option>' : '';
    const nulls =
        panel.chart === 'line' || panel.chart === 'area'
            ? `\n          <option name="charting.chart.nullValueMode">${panel.showGaps ? 'gaps' : 'connect'}</option>`
            : '';
    const trellis = panel.trellis
        ? `\n          <option name="trellis.enabled">1</option>\n          <option name="trellis.splitBy">${xml(panel.trellis.splitBy)}</option>\n          <option name="trellis.size">${trellisSize(panel.trellis.minColumnWidth)}</option>\n          <option name="trellis.scales.shared">1</option>`
        : '';
    const earliest = timeInput ? `$${TIME_TOKEN}.earliest$` : panel.earliest;
    const latest = timeInput ? `$${TIME_TOKEN}.latest$` : panel.latest;
    return `    <row>
      <panel>
        <title>${xml(panel.title)}</title>
        <chart>
          <search>
            <query>${cdata(panel.search)}</query>
            <earliest>${xml(earliest)}</earliest>
            <latest>${xml(latest)}</latest>
          </search>
          <option name="charting.chart">${panel.chart}</option>${stack}${nulls}${trellis}
        </chart>
      </panel>
    </row>`;
}

/** A Classic dashboard. One row per panel. */
export function classicDashboard(label: string, panels: PanelSpec[], options: DashboardExportOptions = {}): string {
    if (panels.length === 0) {
        throw new Error('Nothing to save.');
    }
    const description = options.description?.trim() ? `\n  <description>${xml(options.description.trim())}</description>` : '';
    const prepared = panels.map((panel) => ({ ...panel, search: applyExportTokens(panel.search, options) }));
    const fieldset = classicFieldset(prepared, options);
    return `<dashboard version="1.1" theme="${options.theme === 'dark' ? 'dark' : 'light'}">
  <label>${xml(label)}</label>${description}${fieldset}
${prepared.map((panel) => panelXml(panel, Boolean(options.timeInput))).join('\n')}
</dashboard>
`;
}

/** Inserts panels before the closing tag of a Classic dashboard. Studio dashboards are left unchanged. */
export function appendClassicPanels(xmlText: string, panels: PanelSpec[]): string {
    if (!xmlText.includes('<dashboard') || xmlText.includes('version="2"')) {
        throw new Error('That dashboard is not a Classic dashboard.');
    }
    const close = xmlText.lastIndexOf('</dashboard>');
    if (close < 0) {
        throw new Error('That dashboard is not a Classic dashboard.');
    }
    const timeInput = xmlText.includes(`token="${TIME_TOKEN}"`);
    return `${xmlText.slice(0, close)}${panels.map((panel) => panelXml(panel, timeInput)).join('\n')}\n${xmlText.slice(close)}`;
}

/** Classic trellis has three sizes. The pixel width used in the explorer picks the closest one. */
export function trellisSize(minColumnWidth: number): 'small' | 'medium' | 'large' {
    if (minColumnWidth <= 200) {
        return 'small';
    }
    if (minColumnWidth <= 360) {
        return 'medium';
    }
    return 'large';
}

function studioOptions(panel: PanelSpec): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    if (panel.stacked) {
        options.stackMode = 'stacked';
    }
    if (panel.chart === 'line' || panel.chart === 'area') {
        options.nullValueDisplay = panel.showGaps ? 'gaps' : 'connect';
    }
    if (panel.trellis) {
        options.splitByLayout = 'trellis';
        options.trellisSplitBy = panel.trellis.splitBy;
        options.trellisMinColumnWidth = panel.trellis.minColumnWidth;
        options.trellisRowHeight = panel.trellis.rowHeight;
        options.trellisColumns = panel.trellis.columns;
        options.trellisPageCount = panel.trellis.pageSize;
    }
    return options;
}

/** A trellis panel is as tall as one page of small charts, plus the title and the pager. */
function studioHeight(panel: PanelSpec): number {
    if (!panel.trellis) {
        return 300;
    }
    const columns = Math.max(1, panel.trellis.columns);
    const rows = Math.ceil(Math.max(1, panel.trellis.pageSize) / columns);
    return rows * Math.max(80, panel.trellis.rowHeight) + 80;
}

function studioViz(panel: PanelSpec, id: string): Record<string, unknown> {
    return {
        type: panel.chart === 'area' ? 'splunk.area' : panel.chart === 'column' ? 'splunk.column' : 'splunk.line',
        title: panel.title,
        dataSources: { primary: `ds_${id}` },
        options: studioOptions(panel),
    };
}

function studioInputs(panels: PanelSpec[], options: DashboardExportOptions): {
    inputs: Record<string, unknown>;
    dataSources: Record<string, unknown>;
    globalInputs: string[];
} {
    const inputs: Record<string, unknown> = {};
    const dataSources: Record<string, unknown> = {};
    const globalInputs: string[] = [];
    const earliest = options.timeInput ? `$${TIME_TOKEN}.earliest$` : panels[0].earliest;
    const latest = options.timeInput ? `$${TIME_TOKEN}.latest$` : panels[0].latest;
    if (options.timeInput) {
        globalInputs.push('input_mx_time');
        inputs.input_mx_time = {
            type: 'input.timerange',
            options: {
                token: TIME_TOKEN,
                defaultValue: `${panels[0].earliest},${panels[0].latest}`,
            },
        };
    }
    if (options.splitInput) {
        globalInputs.push('input_mx_split');
        dataSources.ds_mx_split = {
            type: 'ds.search',
            name: options.splitInput.label,
            options: {
                query: options.splitInput.search,
                queryParameters: { earliest, latest },
            },
        };
        inputs.input_mx_split = {
            type: 'input.multiselect',
            title: options.splitInput.label,
            dataSources: { primary: 'ds_mx_split' },
            encoding: {
                label: `primary.fields.${options.splitInput.field}`,
                value: `primary.fields.${options.splitInput.field}`,
            },
            options: {
                token: SPLIT_TOKEN,
                defaultValue: '*',
                items: [{ label: options.splitInput.allLabel ?? 'All', value: '*' }],
                delimiter: ' OR ',
                tokenPrefix: '(',
                tokenSuffix: ')',
                itemPrefix: `${options.splitInput.field}="`,
                itemSuffix: '"',
            },
        };
    }
    if (options.spanInput) {
        globalInputs.push('input_mx_span');
        inputs.input_mx_span = {
            type: 'input.dropdown',
            title: options.spanInput.label ?? 'Time span',
            options: {
                token: SPAN_TOKEN,
                defaultValue: options.spanInput.defaultSpan,
                items: options.spanInput.presets.map((span) => ({ label: span, value: span })),
            },
        };
    }
    return { inputs, dataSources, globalInputs };
}

/** A Dashboard Studio definition. Panels sit in a grid, one under the other. */
export function studioDashboard(label: string, panels: PanelSpec[], options: DashboardExportOptions = {}): string {
    if (panels.length === 0) {
        throw new Error('Nothing to save.');
    }
    const prepared = panels.map((panel) => ({ ...panel, search: applyExportTokens(panel.search, options) }));
    const extra = studioInputs(prepared, options);
    const visualizations: Record<string, unknown> = {};
    const dataSources: Record<string, unknown> = { ...extra.dataSources };
    const structure: unknown[] = [];
    let top = 0;
    prepared.forEach((panel, index) => {
        const id = `chart_${index + 1}`;
        visualizations[`viz_${id}`] = studioViz(panel, id);
        dataSources[`ds_${id}`] = {
            type: 'ds.search',
            name: panel.title,
            options: {
                query: panel.search,
                queryParameters: {
                    earliest: options.timeInput ? `$${TIME_TOKEN}.earliest$` : panel.earliest,
                    latest: options.timeInput ? `$${TIME_TOKEN}.latest$` : panel.latest,
                },
            },
        };
        const height = studioHeight(panel);
        structure.push({
            item: `viz_${id}`,
            type: 'block',
            position: { x: 0, y: top, w: 1200, h: height },
        });
        top += height + 20;
    });
    const size = { width: 1200, height: Math.max(320, top) };
    const layout =
        options.layout === 'grid'
            ? { type: 'grid', options: size, structure, globalInputs: extra.globalInputs }
            : { type: 'absolute', options: size, structure, globalInputs: extra.globalInputs };
    const definition = {
        title: label,
        description: options.description?.trim() ?? '',
        inputs: extra.inputs,
        defaults: {},
        visualizations,
        dataSources,
        layout,
    };
    return `<dashboard version="2" theme="${options.theme === 'dark' ? 'dark' : 'light'}">
  <label>${xml(label)}</label>
  <definition>${cdata(JSON.stringify(definition))}</definition>
</dashboard>
`;
}

export function chartKind(type: string): { chart: PanelSpec['chart']; stacked: boolean } {
    if (type === 'area') {
        return { chart: 'area', stacked: false };
    }
    if (type === 'column' || type === 'stacked' || type === 'heatmap' || type === 'category' || type === 'stackCategory') {
        return { chart: 'column', stacked: type === 'stacked' || type === 'stackCategory' };
    }
    return { chart: 'line', stacked: false };
}
