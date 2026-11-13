import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled, { css } from 'styled-components';
import { variables } from '@splunk/themes';

const Anchor = styled.div<{ $right: boolean }>`
    position: relative;
    display: inline-flex;
    ${(props) =>
        props.$right &&
        css`
            margin-left: auto;
        `}
`;

/** Fixed to the window, so a scrolling stage or a chart card cannot clip it. */
const List = styled.div`
    position: fixed;
    z-index: 4000;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    overflow: auto;
    padding: 4px 0;
    border: 1px solid ${variables.neutral200};
    border-radius: 4px;
    background: ${variables.backgroundColorPopup};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
`;

export const MenuHeading = styled.div`
    padding: 6px 12px 2px;
    color: ${variables.contentColorMuted};
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
`;

export const MenuItem = styled.button.attrs({ type: 'button', role: 'menuitem' })<{ $checked?: boolean }>`
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 12px 6px 28px;
    border: 0;
    background: transparent;
    color: ${variables.contentColorDefault};
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    position: relative;
    ${(props) =>
        props.$checked &&
        css`
            &::before {
                content: '✓';
                position: absolute;
                left: 10px;
            }
        `}
    &:hover:not(:disabled),
    &:focus-visible {
        background: ${variables.interactiveColorOverlayHover};
        outline: none;
    }
    &:disabled {
        color: ${variables.contentColorDisabled};
        cursor: default;
    }
`;

export type MenuAnchor = { left: number; right: number; top: number; bottom: number };

/** Puts the menu in the window. A trigger on the right edge opens the list toward the left, so it stays on screen. */
export function menuPlace(
    box: MenuAnchor,
    alignRight: boolean,
    viewport = { width: window.innerWidth, height: window.innerHeight },
    menuWidth = 320
): React.CSSProperties {
    const gap = 4;
    const margin = 8;
    const width = Math.min(menuWidth, Math.max(160, viewport.width - margin * 2));
    const spaceBelow = viewport.height - box.bottom - margin;
    const spaceAbove = box.top - margin;
    const preferRight = alignRight || box.left + width > viewport.width - margin;
    const horizontal = preferRight
        ? { right: Math.max(margin, viewport.width - box.right), maxWidth: viewport.width - margin * 2 }
        : { left: Math.max(margin, box.left), maxWidth: viewport.width - margin * 2 };
    if (spaceBelow < 180 && spaceAbove > spaceBelow) {
        return {
            bottom: viewport.height - box.top + gap,
            maxHeight: Math.max(80, spaceAbove - gap),
            ...horizontal,
        };
    }
    return {
        top: box.bottom + gap,
        maxHeight: Math.max(80, Math.min(420, spaceBelow)),
        ...horizontal,
    };
}

/**
 * A button that opens a list. The list is portaled to the page so a pane cannot clip it.
 * It opens upward when the trigger sits on the bottom edge. Clicking outside or pressing Escape closes it.
 * `children` gets a close function, so an item can close the menu after it ran.
 */
export function DropdownMenu(props: {
    trigger: (open: boolean, toggle: () => void) => React.ReactElement;
    children: (close: () => void) => React.ReactNode;
    alignRight?: boolean;
    pushRight?: boolean;
    label?: string;
}): React.ReactElement {
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<React.CSSProperties>({});
    const anchor = useRef<HTMLDivElement>(null);
    const list = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open || !anchor.current) {
            return;
        }
        const position = (): void => {
            if (anchor.current) {
                setPlace(menuPlace(anchor.current.getBoundingClientRect(), Boolean(props.alignRight)));
            }
        };
        position();
        const onScroll = (event: Event): void => {
            if (event.target instanceof Node && list.current?.contains(event.target)) {
                return;
            }
            position();
        };
        window.addEventListener('resize', position);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            window.removeEventListener('resize', position);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [open, props.alignRight]);
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const inside = (target: EventTarget | null): boolean =>
            target instanceof Node && Boolean(anchor.current?.contains(target) || list.current?.contains(target));
        const onDown = (event: MouseEvent): void => {
            if (!inside(event.target)) {
                setOpen(false);
            }
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);
    return (
        <Anchor ref={anchor} $right={Boolean(props.pushRight)}>
            {props.trigger(open, () => setOpen((current) => !current))}
            {open
                ? createPortal(
                      <List ref={list} role="menu" aria-label={props.label} style={place}>
                          {props.children(() => setOpen(false))}
                      </List>,
                      document.body
                  )
                : null}
        </Anchor>
    );
}
