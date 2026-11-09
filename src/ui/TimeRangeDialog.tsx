import React, { useState } from 'react';
import { t } from '../i18n';
import {
    boundForInput,
    boundSeconds,
    customRange,
    parseRelativeStart,
    relativeStart,
    RELATIVE_UNITS,
    RelativeUnit,
} from '../spl/timeRange';
import { Button, FormRow, Hint, Inline, Input, Modal, Picker } from './Modal';

function localTime(seconds: number): string {
    return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The custom time range, as in the original: a relative start ("N units ago" until now),
 * or a start and end typed as dates or Splunk time tokens.
 */
export function TimeRangeDialog(props: {
    earliest: string;
    latest: string;
    onApply: (earliest: string, latest: string) => void;
    onClose: () => void;
}): React.ReactElement {
    const parsed = props.latest === 'now' ? parseRelativeStart(props.earliest) : null;
    const [mode, setMode] = useState<'relative' | 'absolute'>(parsed ? 'relative' : 'absolute');
    const [amount, setAmount] = useState(parsed?.amount ?? '1');
    const [unit, setUnit] = useState<RelativeUnit>(parsed?.unit ?? 'h');
    const [start, setStart] = useState(boundForInput(props.earliest));
    const [end, setEnd] = useState(boundForInput(props.latest));
    const [error, setError] = useState('');
    const token = relativeStart(amount, unit);
    const now = Date.now() / 1000;

    function apply(): void {
        if (mode === 'relative') {
            if (!token) {
                setError(t('Enter a whole number from 1 to 9999.'));
                return;
            }
            props.onApply(token, 'now');
            return;
        }
        const result = customRange(start, end, now);
        if ('error' in result) {
            setError(result.error);
            return;
        }
        props.onApply(result.earliest, result.latest);
    }

    return (
        <Modal
            title={t('Custom time range')}
            width={620}
            onClose={props.onClose}
            onSubmit={apply}
            footer={
                <>
                    <Button type="button" onClick={props.onClose}>
                        {t('Cancel')}
                    </Button>
                    <Button type="submit" $primary>
                        {t('Apply')}
                    </Button>
                </>
            }
        >
            <Inline role="radiogroup" aria-label={t('Range type')}>
                <label>
                    <input type="radio" checked={mode === 'relative'} onChange={() => setMode('relative')} /> {t('Relative')}
                </label>
                <label>
                    <input type="radio" checked={mode === 'absolute'} onChange={() => setMode('absolute')} /> {t('Date & time range')}
                </label>
            </Inline>
            {mode === 'relative' ? (
                <>
                    <FormRow>
                        <span>{t('Earliest')}</span>
                        <div>
                            <Inline>
                                <Input
                                    aria-label={t('Earliest amount')}
                                    inputMode="numeric"
                                    style={{ width: 80 }}
                                    value={amount}
                                    onChange={(event) => setAmount(event.target.value)}
                                />
                                <Picker aria-label={t('Earliest unit')} value={unit} onChange={(event) => setUnit(event.target.value as RelativeUnit)}>
                                    {RELATIVE_UNITS.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {t(item.label)}
                                        </option>
                                    ))}
                                </Picker>
                            </Inline>
                            {token ? <Hint>{`${t('From')} ${localTime(boundSeconds(token, now))}`}</Hint> : null}
                        </div>
                    </FormRow>
                    <FormRow>
                        <span>{t('Latest')}</span>
                        <div>
                            <div style={{ paddingTop: 6 }}>{t('Now')}</div>
                            <Hint>{`${t('To')} ${localTime(now)}`}</Hint>
                        </div>
                    </FormRow>
                </>
            ) : (
                <>
                    <FormRow>
                        <span>{t('Earliest')}</span>
                        <Input
                            aria-label={t('Custom time range start')}
                            placeholder={t('e.g. -7d or 2026-11-09 20:44')}
                            value={start}
                            onChange={(event) => setStart(event.target.value)}
                        />
                    </FormRow>
                    <FormRow>
                        <span>{t('Latest')}</span>
                        <Input
                            aria-label={t('Custom time range end')}
                            placeholder={t('e.g. now or 2026-11-09 20:44')}
                            value={end}
                            onChange={(event) => setEnd(event.target.value)}
                        />
                    </FormRow>
                </>
            )}
            {error ? <span role="alert">{error}</span> : null}
        </Modal>
    );
}
