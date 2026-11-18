import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const isAiStudioPreview =
    process.env.DISABLE_HMR === 'true' ||
    Boolean(process.env.K_SERVICE?.startsWith('ais-')) ||
    Boolean(process.env.APP_URL?.includes('ais-'));

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio preview environments to avoid port 24678 WS collisions and watcher overhead.
      hmr: isAiStudioPreview ? false : process.env.DISABLE_HMR !== 'true',
      ws: isAiStudioPreview ? (false as const) : undefined,
      watch: isAiStudioPreview ? null : {},
    },
  };
});
