import { parseSession, serializeSession, sessionKey } from '../src/model/session';
import { createChart } from '../src/model/workspace';

function sample(): string {
    const chart = createChart('lab.net.bytes_total');
    return serializeSession(
        { charts: [chart], layout: 'grid', range: '-60m', catalogRange: '-7d', globalSplit: 'host' },
        1234
    );
}

test('a saved session comes back with its charts and view', () => {
    const session = parseSession(sample());
    expect(session).not.toBeNull();
    expect(session?.charts).toHaveLength(1);
    expect(session?.charts[0].series[0].metric).toBe('lab.net.bytes_total');
    expect(session?.layout).toBe('grid');
    expect(session?.range).toBe('-60m');
    expect(session?.catalogRange).toBe('-7d');
    expect(session?.globalSplit).toBe('host');
    expect(session?.savedAt).toBe(1234);
});

test('a session saved without a catalog range gets the default one', () => {
    const text = JSON.stringify({ version: 1, charts: [chart()], layout: 'grid', range: '-1h', globalSplit: '', savedAt: 1 });
    expect(parseSession(text)?.catalogRange).toBe('-2d');
});

function chart() {
    return { id: 'chart-1', settings: {}, series: [{ id: 'series-1', metric: 'm', aggregation: 'Avg', splitBy: '' }] };
}

test('missing, broken, or foreign values are ignored', () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession('')).toBeNull();
    expect(parseSession('{not json')).toBeNull();
    expect(parseSession('[]')).toBeNull();
    expect(parseSession(JSON.stringify({ version: 2, charts: [], layout: 'grid', range: '-1h', globalSplit: '', savedAt: 1 }))).toBeNull();
    expect(parseSession(JSON.stringify({ version: 1, charts: [], layout: 'grid', range: '-1h', globalSplit: '', savedAt: 1 }))).toBeNull();
    expect(parseSession(JSON.stringify({ version: 1, charts: [{ id: 'x', settings: {}, series: [{ id: 's' }] }], layout: 'grid', range: '-1h', globalSplit: '', savedAt: 1 }))).toBeNull();
    expect(parseSession(JSON.stringify({ version: 1, charts: [], layout: 'table', range: '-1h', globalSplit: '', savedAt: 1 }))).toBeNull();
});

test('keys are per user and fall back to a default name', () => {
    expect(sessionKey('admin')).toBe('metrics-explorer.session.v1.admin');
    expect(sessionKey('')).toBe('metrics-explorer.session.v1.default');
});