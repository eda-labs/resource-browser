import { expect, test } from '@playwright/test';

test('home page has expected h1', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('h1')).toBeVisible();
});

test('LCP background image should be preloaded and have high priority', async ({ page }) => {
	await page.goto('/');
	const img = page.locator('#main-scroll picture img[fetchpriority="high"]');
	await expect(img).toHaveCount(1);
});
