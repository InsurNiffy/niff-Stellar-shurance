import type { Preview } from '@storybook/react'
import '../src/app/globals.css'

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#0a0a0a' },
      ],
    },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: {
      // Fail axe checks on any violation so the test-runner enforces accessibility.
      config: {},
      options: {},
    },
  },
}

export default preview
