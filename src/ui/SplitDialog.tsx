import React, { useState } from 'react';
import { t } from '../i18n';
import { GlobalSplitLimit } from '../model/workspace';
import { SPLIT_LIMITS } from '../spl/buildMstats';
import { Button, FormRow, Inline, Modal, Picker } from './Modal';

/** "Split metrics by a dimension": the split for every series that inherits it, with how many values to show. */
export function SplitDialog(props: {
    dimensions: string[];
    split: string;
    limit: GlobalSplitLimit;
    onApply: (split: string, limit: GlobalSplitLimit) => void;
    onClose: () => void;
}): React.ReactElement {
    const [split, setSplit] = useState(props.dimensions.includes(props.split) ? props.split : '');
    const [direction, setDirection] = useState(props.limit.direction);
    const [limit, setLimit] = useState(props.limit.limit);
    const choices = props.dimensions;
    return (
        <Modal
            title={t('Split metrics by a dimension')}
            width={520}
            onClose={props.onClose}
            onSubmit={() => props.onApply(split, { direction, limit })}
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
            <FormRow>
                <span>{t('Split on')}</span>
                <Picker aria-label={t('Split on')} value={split} onChange={(event) => setSplit(event.target.value)}>
                    <option value="">{t('None')}</option>
                    {choices.map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </Picker>
            </FormRow>
            <FormRow>
                <span>{t('Show')}</span>
                <Inline>
                    <Picker
                        aria-label={t('Split limit type')}
                        value={direction}
                        disabled={!split}
                        onChange={(event) => setDirection(event.target.value === 'lowest' ? 'lowest' : 'highest')}
                    >
                        <option value="highest">{t('Highest:')}</option>
                        <option value="lowest">{t('Lowest:')}</option>
                    </Picker>
                    <Picker aria-label={t('Split limit')} value={limit} disabled={!split} onChange={(event) => setLimit(Number(event.target.value))}>
                        {SPLIT_LIMITS.map((item) => (
                            <option key={item} value={item}>
                                {item}
                            </option>
                        ))}
                    </Picker>
                </Inline>
            </FormRow>
        </Modal>
    );
}
