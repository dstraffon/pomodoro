import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (e.g. GitHub Pages at /pomodoro/).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
