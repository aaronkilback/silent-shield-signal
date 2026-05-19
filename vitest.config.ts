import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/test/**/*.test.ts',
      'src/test/**/*.test.tsx',
      'src/test/**/*.spec.ts',
      'src/test/**/*.spec.tsx',
    ],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/hooks/**'],
      exclude: ['src/integrations/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
