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

const SHIFT_SECONDS: Record<string, number> = {
    '30m': 30 * 60,
    '60m': 60 * 60,
    '2h': 2 * 3600,
    '24h': 24 * 3600,
    '2d': 2 * 86400,
    '7d': 7 * 86400,
};

export function searchWindow(range: string, shift = ''): { earliest: string; latest: string } {
    if (!shift) {
        return { earliest: range, latest: 'now' };
    }
    const shiftSeconds = SHIFT_SECONDS[shift];
    if (!shiftSeconds) {
        throw new Error('Time shift is not allowed.');
    }
    const duration = RANGE_SECONDS[range] ?? 3600;
    return { earliest: `-${duration + shiftSeconds}s`, latest: `-${shiftSeconds}s` };
}
