/**
 * A chart card is a grid item. The row is sized from the plot's fixed height
 * and leaves the title out, so the plot hangs through the bottom border.
 * A metric name has no spaces, so an unbroken title paints into the next card.
 * The card has to size itself to its content and the title has to be allowed to break.
 */
export const chartCardLayout = {
    minWidth: 0,
    height: 'max-content',
    alignSelf: 'start',
    boxSizing: 'border-box',
    titleMinWidth: 0,
    titleOverflowWrap: 'anywhere',
} as const;

/** True when a box sticks out of the card. One pixel absorbs subpixel rounding. */
export function overflowsCard(outer: number, inner: number): boolean {
    return inner > outer + 1;
}
