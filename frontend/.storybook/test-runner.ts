import type { TestRunnerConfig } from '@storybook/test-runner'
import { toMatchImageSnapshot } from 'jest-image-snapshot'

const customSnapshotsDir = `${process.cwd()}/.storybook/__snapshots__`

/**
 * Visual regression check — captures a screenshot of every story after it
 * renders and diffs it against the baseline committed in .storybook/__snapshots__.
 * See docs/STORYBOOK.md for how to review and approve an intentional change.
 */
const config: TestRunnerConfig = {
  tags: {
    // Stories tagged 'skip-visual-test' render incorrectly in isolation for
    // reasons unrelated to this check (missing provider, etc.) — see the
    // story file for details. Tracked separately from visual regression.
    skip: ['skip-visual-test'],
  },
  setup() {
    expect.extend({ toMatchImageSnapshot })
  },
  async postVisit(page, context) {
    const image = await page.screenshot()
    expect(image).toMatchImageSnapshot({
      customSnapshotsDir,
      customSnapshotIdentifier: context.id,
      failureThreshold: 0.01,
      failureThresholdType: 'percent',
    })
  },
}

export default config
