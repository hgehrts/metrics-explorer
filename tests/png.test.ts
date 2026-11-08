import { safeFileName } from '../src/export/png';

test('file names for downloads keep only safe characters', () => {
    expect(safeFileName('lab.cpu.user')).toBe('lab.cpu.user');
    expect(safeFileName('cpu metric/pctiowait')).toBe('cpu_metric_pctiowait');
    expect(safeFileName('../../x')).toBe('x');
    expect(safeFileName('///')).toBe('chart');
});
