/** Allowlisted time shifts. The SPL token is rebuilt from the parsed amount and unit, never from the raw field. */
export const SHIFT_UNITS = [
    { id: 'm', label: 'Minutes' },
    { id: 'h', label: 'Hours' },
    { id: 'd', label: 'Days' },
    { id: 'w', label: 'Weeks' },
    { id: 'mon', label: 'Months' },
    { id: 'y', label: 'Years' },
] as const;

export type ShiftUnit = (typeof SHIFT_UNITS)[number]['id'];

const MAX_SHIFT: Record<ShiftUnit, number> = {
    m: 9999,
    h: 8760,
    d: 3660,
    w: 520,
    mon: 120,
    y: 10,
};

const UNIT_SECONDS: Record<'m' | 'h' | 'd' | 'w', number> = {
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
};

export type ParsedShift = { amount: number; unit: ShiftUnit; token: string };

export function parseTimeShift(value: string): ParsedShift | null {
    const match = /^([1-9]\d{0,3})(mon|m|h|d|w|y)$/.exec(value.trim());
    if (!match) {
        return null;
    }
    const amount = Number(match[1]);
    const unit = match[2] as ShiftUnit;
    if (!Number.isInteger(amount) || amount > MAX_SHIFT[unit]) {
        return null;
    }
    return { amount, unit, token: `${amount}${unit}` };
}

/** Builds a shift token from the custom fields. Rejects 0, decimals, and values above the unit cap. */
export function timeShiftToken(amountText: string, unit: ShiftUnit): string | null {
    const text = amountText.trim();
    if (!/^\d{1,4}$/.test(text)) {
        return null;
    }
    return parseTimeShift(`${Number(text)}${unit}`)?.token ?? null;
}

/** Fixed-length units only. Months and years stay calendar units in the search window. */
export function shiftSeconds(value: string): number | null {
    const parsed = parseTimeShift(value);
    if (!parsed || parsed.unit === 'mon' || parsed.unit === 'y') {
        return null;
    }
    return parsed.amount * UNIT_SECONDS[parsed.unit];
}
