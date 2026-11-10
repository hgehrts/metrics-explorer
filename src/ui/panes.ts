/** Narrowest a data or analysis pane may be while it is open. */
export const PANE_MIN = 180;

/** Narrowest the chart area may become, so a drag cannot hide the metrics. */
export const CENTER_MIN = 280;

export const LEFT_PANE_DEFAULT = 260;
export const RIGHT_PANE_DEFAULT = 280;

/** The grid tracks: an open pane is its width plus a 6px splitter. A closed pane is the rail. */
export function shellColumns(leftOpen: boolean, rightOpen: boolean, left: number, right: number): string {
    const leftCols = leftOpen ? `${left}px 6px` : '36px';
    const rightCols = rightOpen ? `6px ${right}px` : '36px';
    return `${leftCols} minmax(0, 1fr) ${rightCols}`;
}

/**
 * Keeps a pane between its minimum and the room left by the other pane and the chart area.
 * `sibling` is the width already taken by the opposite side, including its splitter or rail.
 */
export function clampPaneWidth(requested: number, container: number, sibling: number): number {
    if (!Number.isFinite(requested) || !Number.isFinite(container)) {
        return PANE_MIN;
    }
    const max = Math.max(PANE_MIN, Math.floor(container - sibling - CENTER_MIN));
    return Math.min(max, Math.max(PANE_MIN, Math.round(requested)));
}
