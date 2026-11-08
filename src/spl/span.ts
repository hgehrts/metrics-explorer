import { parseTimeShift, shiftSeconds } from './timeShift';

const SPANS: { seconds: number; spl: string }[] = [
    { seconds: 1, spl: '1s' },
    { seconds: 10, spl: '10s' },
    { seconds: 30, spl: '30s' },
    { seconds: 60, spl: '1m' },
    { seconds: 300, spl: '5m' },
    { seconds: 600, spl: '10m' },
    { seconds: 1800, spl: '30m' },
    { seconds: 3600, spl: '1h' },
    { seconds: 14400, spl: '4h' },
    { seconds: 86400, spl: '1d' },
    { seconds: 604800, spl: '7d' },
];

export function spanForDuration(durationSeconds: number, maxPoints = 1000): string {
    const duration = Math.max(durationSeconds, 1);
    for (const span of SPANS) {
        if (duration / span.seconds <= maxPoints) {
            return span.spl;
        }
    }
    return SPANS[SPANS.length - 1].spl;
}

const RANGE_SECONDS: Record<string, number> = {
    '-15m': 15 * 60,
    '-60m': 60 * 60,
    '-4h': 4 * 3600,
    '-24h': 24 * 3600,
    '-7d': 7 * 86400,
    '-2d': 2 * 86400,
};

export function spanForRange(earliest: string): string {
    return spanForDuration(RANGE_SECONDS[earliest] ?? 3600);
}

export function searchWindow(range: string, shift = ''): { earliest: string; latest: string } {
    if (!shift) {
        return { earliest: range, latest: 'now' };
    }
    const parsed = parseTimeShift(shift);
    if (!parsed || !(range in RANGE_SECONDS)) {
        throw new Error('Time shift is not allowed.');
    }
    if (parsed.unit === 'mon' || parsed.unit === 'y') {
        return { earliest: `${range}-${parsed.token}`, latest: `-${parsed.token}` };
    }
    const seconds = shiftSeconds(shift);
    if (!seconds) {
        throw new Error('Time shift is not allowed.');
    }
    const duration = RANGE_SECONDS[range];
    return { earliest: `-${duration + seconds}s`, latest: `-${seconds}s` };
}
