/** The zoom window as the time picker shows it: `20:08 - 20:24`, with dates when it spans days. */
export function formatZoomRange(earliest: string, latest: string, locale?: string): string {
    const start = new Date(Number(earliest) * 1000);
    const end = latest === 'now' ? new Date() : new Date(Number(latest) * 1000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
        return `${earliest} - ${latest}`;
    }
    const sameDay = start.toDateString() === end.toDateString();
    const options: Intl.DateTimeFormatOptions = sameDay
        ? { hour: '2-digit', minute: '2-digit' }
        : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
    const format = new Intl.DateTimeFormat(locale, options);
    return `${format.format(start)} - ${format.format(end)}`;
}
