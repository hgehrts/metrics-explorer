export type PanelSpec = {
    title: string;
    search: string;
    earliest: string;
    latest: string;
    /** line, area, or column. A heatmap is stored as a column chart, as in the original workspace. */
    chart: 'line' | 'area' | 'column';
    stacked: boolean;
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
const TIME_TOKEN = 'mx_time';

function panelXml(panel: PanelSpec, timeInput = false): string {
    const stack = panel.stacked ? '\n          <option name="charting.chart.stackMode">stacked</option>' : '';
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
          <option name="charting.chart">${panel.chart}</option>${stack}
        </chart>
      </panel>
    </row>`;
}

/** A Classic dashboard. One row per panel. */
export function classicDashboard(
    label: string,
    panels: PanelSpec[],
    options: { description?: string; timeInput?: boolean } = {}
): string {
    if (panels.length === 0) {
        throw new Error('Nothing to save.');
    }
    const description = options.description?.trim() ? `\n  <description>${xml(options.description.trim())}</description>` : '';
    const fieldset = options.timeInput
        ? `
  <fieldset submitButton="false">
    <input type="time" token="${TIME_TOKEN}">
      <label></label>
      <default>
        <earliest>${xml(panels[0].earliest)}</earliest>
        <latest>${xml(panels[0].latest)}</latest>
      </default>
    </input>
  </fieldset>`
        : '';
    return `<dashboard version="1.1">
  <label>${xml(label)}</label>${description}${fieldset}
${panels.map((panel) => panelXml(panel, Boolean(options.timeInput))).join('\n')}
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

function studioViz(panel: PanelSpec, id: string): Record<string, unknown> {
    return {
        type: panel.chart === 'area' ? 'splunk.area' : panel.chart === 'column' ? 'splunk.column' : 'splunk.line',
        title: panel.title,
        dataSources: { primary: `ds_${id}` },
        options: panel.stacked ? { stackMode: 'stacked' } : {},
    };
}

/** A Dashboard Studio definition. Panels sit in a grid, one under the other. */
export function studioDashboard(
    label: string,
    panels: PanelSpec[],
    options: { description?: string; layout?: 'absolute' | 'grid' } = {}
): string {
    if (panels.length === 0) {
        throw new Error('Nothing to save.');
    }
    const visualizations: Record<string, unknown> = {};
    const dataSources: Record<string, unknown> = {};
    const structure: unknown[] = [];
    panels.forEach((panel, index) => {
        const id = `chart_${index + 1}`;
        visualizations[`viz_${id}`] = studioViz(panel, id);
        dataSources[`ds_${id}`] = {
            type: 'ds.search',
            name: panel.title,
            options: {
                query: panel.search,
                queryParameters: { earliest: panel.earliest, latest: panel.latest },
            },
        };
        structure.push({
            item: `viz_${id}`,
            type: 'block',
            position: { x: 0, y: index * 320, w: 1200, h: 300 },
        });
    });
    const layout =
        options.layout === 'grid'
            ? { type: 'grid', options: { width: 1200, height: Math.max(320, panels.length * 320) }, structure, globalInputs: [] }
            : { type: 'absolute', options: { width: 1200, height: Math.max(320, panels.length * 320) }, structure, globalInputs: [] };
    const definition = {
        title: label,
        description: options.description?.trim() ?? '',
        inputs: {},
        defaults: {},
        visualizations,
        dataSources,
        layout,
    };
    return `<dashboard version="2" theme="light">
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
