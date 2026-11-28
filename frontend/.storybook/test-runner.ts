import { injectAxe, checkA11y } from 'axe-playwright';
import type { TestRunnerConfig } from '@storybook/test-runner';

/**
 * Storybook test-runner configuration.
 *
 * Runs axe accessibility checks against every story rendered by the
 * test-runner. This provides the accessibility portion of the visual
 * regression baseline required by F-29.
 */
const config: TestRunnerConfig = {
  async preVisit(page) {
    await injectAxe(page);
  },
  async postVisit(page) {
    await checkA11y(page, '#storybook-root', {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  },
};

export default config;
