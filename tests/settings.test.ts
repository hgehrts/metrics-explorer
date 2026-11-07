import { axisOptions, buildSpan, defaultSettings, parseAxisValue, splitSpan, validateAxis, visualFor } from '../src/chart/settings';

test('reads the short forms the original workspace accepts', () => {
    expect(parseAxisValue('1000')).toBe(1000);
    expect(parseAxisValue('1k')).toBe(1000);
    expect(parseAxisValue('3m')).toBe(3000000);
    expect(parseAxisValue('')).toBeUndefined();
    expect(parseAxisValue('abc')).toBe('invalid');
});

test('rejects a maximum that is not above the minimum', () => {
    const base = defaultSettings();
    expect(validateAxis({ ...base, yMin: '10', yMax: '5' })).toBe('Max must be greater than min.');
    expect(validateAxis({ ...base, yMin: '1', yMax: '5' })).toBe('');
});

test('rejects zero or negative bounds on a log scale', () => {
    expect(validateAxis({ ...defaultSettings(), yMin: '0', yScale: 'log' })).toBe('A log scale needs values above zero.');
});

test('hands only valid bounds to the chart', () => {
    expect(axisOptions({ ...defaultSettings(), yMin: '1k', yMax: '' })).toEqual({ yAxisScale: 'linear', yAxisMin: 1000 });
    expect(axisOptions({ ...defaultSettings(), yMin: '10', yMax: '5' })).toEqual({ yAxisScale: 'linear' });
});

test('builds a span only from a positive whole number and a known unit', () => {
    expect(buildSpan('30', 's')).toBe('30s');
    expect(buildSpan('0', 's')).toBeNull();
    expect(buildSpan('5', 'x')).toBeNull();
    expect(buildSpan('5 | delete', 'm')).toBeNull();
    expect(splitSpan('2h')).toEqual({ count: '2', unit: 'h' });
});

test('maps the chart types to a visualization and stack mode', () => {
    expect(visualFor('line')).toEqual({ kind: 'line', stacked: false });
    expect(visualFor('area')).toEqual({ kind: 'area', stacked: false });
    expect(visualFor('column')).toEqual({ kind: 'column', stacked: false });
    expect(visualFor('stacked')).toEqual({ kind: 'column', stacked: true });
});
