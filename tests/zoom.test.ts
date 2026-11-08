import { zoomWindow } from '../src/chart/zoom';

const NOW = 1_800_000_000;

test('a selection in epoch milliseconds becomes epoch seconds', () => {
    expect(zoomWindow({ startXValue: 1_799_990_000_500, endXValue: 1_799_993_600_000 }, NOW)).toEqual({
        earliest: '1799990000',
        latest: '1799993600',
    });
});

test('a selection that reaches the present ends at now', () => {
    expect(zoomWindow({ startXValue: 1_799_990_000, endXValue: NOW + 60 }, NOW)).toEqual({
        earliest: '1799990000',
        latest: 'now',
    });
});

test('date text is read as a time', () => {
    const start = Date.parse('2026-11-06T10:00:00Z') / 1000;
    const end = Date.parse('2026-11-06T11:00:00Z') / 1000;
    expect(zoomWindow({ startXValue: '2026-11-06T10:00:00Z', endXValue: '2026-11-06T11:00:00Z' }, NOW)).toEqual({
        earliest: String(start),
        latest: String(end),
    });
});

test('an empty, reversed, or unreadable selection does not zoom', () => {
    expect(zoomWindow({ startXValue: 1_799_990_000, endXValue: 1_799_990_000 }, NOW)).toBeNull();
    expect(zoomWindow({ startXValue: 1_799_993_600, endXValue: 1_799_990_000 }, NOW)).toBeNull();
    expect(zoomWindow({ startXValue: 'soon', endXValue: 1_799_990_000 }, NOW)).toBeNull();
    expect(zoomWindow(undefined, NOW)).toBeNull();
});
