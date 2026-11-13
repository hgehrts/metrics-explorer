/**
 * A long dotted metric keeps its first and last segment.
 * Three segments or fewer stay whole, so `lab.cpu.user` does not become `lab.<...>.user`.
 */
export function abbreviateMetricName(name: string): string {
    const parts = name.split('.');
    if (parts.length < 4 || parts.some((part) => part.length === 0)) {
        return name;
    }
    const short = `${parts[0]}.<...>.${parts[parts.length - 1]}`;
    return short.length < name.length ? short : name;
}

/** The full title stays when it fits the title row. One pixel absorbs subpixel rounding. */
export function titleFits(neededWidth: number, availableWidth: number): boolean {
    return neededWidth <= availableWidth + 1;
}

/** Chart titles join several metric names with a comma. Each name is shortened on its own. */
export function abbreviateMetricTitle(title: string): string {
    return title
        .split(', ')
        .map((name) => abbreviateMetricName(name))
        .join(', ');
}
