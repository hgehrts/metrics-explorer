import { chartCardLayout, overflowsCard } from '../src/ui/chartFrame';

test('a chart card sizes to its content and lets a long metric name break', () => {
    expect(chartCardLayout).toEqual({
        minWidth: 0,
        height: 'max-content',
        alignSelf: 'start',
        boxSizing: 'border-box',
        titleMinWidth: 0,
        titleOverflowWrap: 'anywhere',
    });
});

test('a long metric name and the plot must stay inside the card', () => {
    // Measured on the grid before the fix: the title ran past the card,
    // and the 260px plot hung out of the bottom border.
    expect(overflowsCard(740, 801)).toBe(true);
    expect(overflowsCard(464, 499)).toBe(true);
    expect(overflowsCard(740, 614)).toBe(false);
    expect(overflowsCard(338, 333)).toBe(false);
});
