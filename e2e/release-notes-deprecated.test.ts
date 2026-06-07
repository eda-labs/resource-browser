import { expect, test } from '@playwright/test';

async function openDeprecatedTab(page: import('@playwright/test').Page) {
	await page.goto('/release-notes');
	await page.locator('.rn-timeline-item').filter({ hasText: '26.4.2' }).first().click();
	await page.locator('.rn-tab').nth(1).click();
	await expect(page.locator('.rn-deprec-card').first()).toBeVisible();
}

test('deprecated tab lists 18 kinds with readable contrast in light and dark', async ({ page }) => {
	await openDeprecatedTab(page);
	const cards = page.locator('.rn-deprec-card');
	await expect(cards).toHaveCount(18);

	for (const mode of ['light', 'dark'] as const) {
		if (mode === 'dark') {
			await page.evaluate(() => document.documentElement.classList.add('dark'));
		} else {
			await page.evaluate(() => document.documentElement.classList.remove('dark'));
		}

		const failures = await cards.evaluateAll((elements, modeLabel) => {
			const toRgb = (color: string): [number, number, number] | null => {
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 1;
				const ctx = canvas.getContext('2d');
				if (!ctx) return null;
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, 1, 1);
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1, 1);
				const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
				return a > 0 ? [r, g, b] : null;
			};

			const luminance = ([r, g, b]: [number, number, number]) => {
				const channel = (c: number) => {
					const s = c / 255;
					return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
				};
				return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
			};

			const contrast = (fg: string, bg: string) => {
				const fgRgb = toRgb(fg);
				const bgRgb = toRgb(bg);
				if (!fgRgb || !bgRgb) return null;
				const l1 = luminance(fgRgb);
				const l2 = luminance(bgRgb);
				const lighter = Math.max(l1, l2);
				const darker = Math.min(l1, l2);
				return (lighter + 0.05) / (darker + 0.05);
			};

			const opaqueBg = (el: Element): string => {
				let node: Element | null = el;
				while (node) {
					const bg = getComputedStyle(node).backgroundColor;
					if (toRgb(bg)) return bg;
					node = node.parentElement;
				}
				return 'rgb(255, 255, 255)';
			};

			const issues: string[] = [];
			for (const el of elements) {
				const bg = opaqueBg(el);
				const nodes = [
					el.querySelector('.rn-deprec-kind-btn span'),
					el.querySelector('.font-mono'),
					el.querySelector('.rn-deprec-migration-oneline'),
					el.querySelector('.rn-deprec-version-pill span.font-mono')
				];

				for (const node of nodes) {
					if (!node) {
						issues.push(`${modeLabel}: missing text node`);
						continue;
					}
					const text = node.textContent?.trim() ?? '';
					const style = getComputedStyle(node);
					if (!text) issues.push(`${modeLabel}: empty text`);
					if (Number(style.opacity) <= 0) issues.push(`${modeLabel}: opacity 0 on "${text.slice(0, 20)}"`);
					if (/rgba?\(0,\s*0,\s*0,\s*0\)/.test(style.webkitTextFillColor)) {
						issues.push(`${modeLabel}: transparent webkit fill on "${text.slice(0, 20)}"`);
					}
					const ratio = contrast(style.color, bg);
					if (ratio == null || ratio <= 3) {
						issues.push(`${modeLabel}: low contrast (${ratio ?? 'n/a'}) on "${text.slice(0, 20)}"`);
					}
				}
			}
			return issues;
		}, mode);

		expect(failures, failures.join('\n')).toEqual([]);
	}
});
