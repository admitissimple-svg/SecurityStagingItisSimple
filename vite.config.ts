import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const kService = (process.env.K_SERVICE || '').toLowerCase();
  const kRevision = (process.env.K_REVISION || '').toLowerCase();
  const appUrl = (process.env.APP_URL || '').toLowerCase();

  const isPublishedCloudRun =
    kService.startsWith('ais-pre-') ||
    kRevision.startsWith('ais-pre-') ||
    appUrl.includes('ais-pre-');

  const isAiStudioPreview =
    process.env.DISABLE_HMR === 'true' ||
    process.env.APP_ENV === 'preview' ||
    process.env.IS_PREVIEW === 'true' ||
    process.env.PREVIEW === 'true' ||
    (!isPublishedCloudRun && Boolean(process.env.APPLET_ID)) ||
    kService.startsWith('ais-dev-') ||
    kService.includes('preview') ||
    kRevision.startsWith('ais-dev-') ||
    kRevision.includes('preview') ||
    appUrl.includes('ais-dev-') ||
    appUrl.includes('preview');

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(isAiStudioPreview
        ? [
            {
              name: 'disable-hmr-client-ws-in-preview',
              enforce: 'post' as const,
              transform(code: string, id: string) {
                if (id.includes('/client/client.mjs') || id.includes('\\client\\client.mjs')) {
                  return code
                    .replace(
                      /transport\.connect\(createHMRHandler\(handleMessage\)\);/g,
                      '/* HMR WebSocket disabled in AI Studio Preview */'
                    )
                    .replace(
                      /new WebSocket\(/g,
                      '(function(){return {readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};})('
                    );
                }
              },
            },
          ]
        : []),
    ],
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
