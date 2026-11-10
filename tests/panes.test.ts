import { clampPaneWidth, shellColumns } from '../src/ui/panes';

test('the shell gives an open pane a splitter and a closed pane only its rail', () => {
    expect(shellColumns(true, true, 260, 280)).toBe('260px 6px minmax(0, 1fr) 6px 280px');
    expect(shellColumns(false, true, 260, 300)).toBe('36px minmax(0, 1fr) 6px 300px');
    expect(shellColumns(true, false, 200, 280)).toBe('200px 6px minmax(0, 1fr) 36px');
});

test('a pane cannot cover the charts or shrink below its minimum', () => {
    expect(clampPaneWidth(100, 1200, 286)).toBe(180);
    expect(clampPaneWidth(900, 1200, 286)).toBe(1200 - 286 - 280);
    expect(clampPaneWidth(320.4, 1200, 286)).toBe(320);
    expect(clampPaneWidth(Number.NaN, 1200, 286)).toBe(180);
});
