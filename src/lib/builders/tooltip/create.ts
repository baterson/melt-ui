import {
	addEventListener,
	builder,
	createElHelpers,
	effect,
	executeCallbacks,
	generateId,
	makeHullFromElements,
	noop,
	omit,
	pointInPolygon,
	styleToString,
} from '$lib/internal/helpers';

import { useFloating, usePortal } from '$lib/internal/actions';
import type { Defaults } from '$lib/internal/types';
import { tick } from 'svelte';
import { get, writable } from 'svelte/store';
import type { CreateTooltipProps } from './types';

const defaults = {
	positioning: {
		placement: 'bottom',
	},
	arrowSize: 8,
	open: false,
	closeOnPointerDown: false,
	openDelay: 1000,
	closeDelay: 0,
} satisfies Defaults<CreateTooltipProps>;

type TooltipParts = 'trigger' | 'content' | 'arrow';
const { name } = createElHelpers<TooltipParts>('tooltip');

// TODO: Add grace area to prevent tooltip from closing when moving from trigger to tooltip

export function createTooltip(props?: CreateTooltipProps) {
	const withDefaults = { ...defaults, ...props } as CreateTooltipProps;
	const options = writable(omit(withDefaults, 'open'));

	const open = writable(withDefaults.open);

	const ids = {
		content: generateId(),
		trigger: generateId(),
	};

	let openTimeout: number | null = null;
	let closeTimeout: number | null = null;
	let clickedTrigger = false;

	const openTooltip = () => {
		const $options = get(options);

		if (openTimeout) {
			window.clearTimeout(openTimeout);
			openTimeout = null;
		}

		if (clickedTrigger) return;
		openTimeout = window.setTimeout(() => {
			open.set(true);
		}, $options.openDelay);
	};

	const closeTooltip = () => {
		const $options = get(options);

		if (closeTimeout) {
			window.clearTimeout(closeTimeout);
			closeTimeout = null;
		}

		closeTimeout = window.setTimeout(() => {
			open.set(false);
			clickedTrigger = false;
		}, $options.closeDelay);
	};

	const trigger = builder(name('trigger'), {
		returned: () => {
			return {
				'aria-describedby': ids.content,
				id: ids.trigger,
			};
		},
		action: (node: HTMLElement) => {
			const unsub = executeCallbacks(
				addEventListener(node, 'pointerdown', () => {
					const $options = get(options);
					if ($options.closeOnPointerDown) {
						open.set(false);
						clickedTrigger = true;
					}
				}),
				addEventListener(node, 'mouseover', openTooltip),
				addEventListener(node, 'mouseleave', () => {
					if (openTimeout) {
						window.clearTimeout(openTimeout);
						openTimeout = null;
					}
					clickedTrigger = false;
				}),
				addEventListener(node, 'focus', openTooltip),
				addEventListener(node, 'blur', closeTooltip),
				addEventListener(node, 'keydown', (e) => {
					if (e.key === 'Escape') {
						if (openTimeout) {
							window.clearTimeout(openTimeout);

							openTimeout = null;
						}

						if (closeTimeout) {
							window.clearTimeout(closeTimeout);
							closeTimeout = null;
						}

						clickedTrigger = false;
						open.set(false);
					}
				})
			);

			return {
				destroy: unsub,
			};
		},
	});

	const content = builder(name('content'), {
		stores: open,
		returned: ($open) => {
			return {
				role: 'tooltip',
				hidden: $open ? undefined : true,
				tabindex: -1,
				style: styleToString({
					display: $open ? undefined : 'none',
				}),
				id: ids.content,
			};
		},
		action: (node: HTMLElement) => {
			let unsub = noop;

			const portalReturn = usePortal(node);

			let unsubFloating = noop;
			const unsubOpen = open.subscribe(($open) => {
				if ($open) {
					tick().then(() => {
						const triggerEl = document.querySelector(`[aria-describedby="${ids.content}"]`);
						if (!triggerEl || node.hidden) return;
						const $options = get(options);
						const floatingReturn = useFloating(triggerEl, node, $options.positioning);
						unsubFloating = floatingReturn.destroy;
					});
				} else {
					unsubFloating();
				}
			});

			unsub = executeCallbacks(
				addEventListener(node, 'mouseover', openTooltip),
				portalReturn && portalReturn.destroy ? portalReturn.destroy : noop,
				unsubOpen
			);

			return {
				destroy() {
					unsub();
					unsubFloating();
				},
			};
		},
	});

	const arrow = builder(name('arrow'), {
		stores: options,
		returned: ($options) => ({
			'data-arrow': true,
			style: styleToString({
				position: 'absolute',
				width: `var(--arrow-size, ${$options.arrowSize}px)`,
				height: `var(--arrow-size, ${$options.arrowSize}px)`,
			}),
		}),
	});

	effect(open, ($open) => {
		if ($open) {
			return executeCallbacks(
				addEventListener(document, 'mousemove', (e) => {
					const triggerEl = document.getElementById(ids.trigger);
					if (!triggerEl || document.activeElement === triggerEl) return;

					const contentEl = document.getElementById(ids.content);
					if (!contentEl) return;

					const polygon = makeHullFromElements([triggerEl, contentEl]);

					const isMouseInTooltipArea = pointInPolygon(
						{
							x: e.clientX,
							y: e.clientY,
						},
						polygon
					);

					if (isMouseInTooltipArea) {
						closeTimeout = null;
						return;
					}

					closeTooltip();
				}),
				addEventListener(document, 'mouseleave', () => {
					closeTooltip();
				})
			);
		}
	});

	return { trigger, open, content, arrow, options };
}
