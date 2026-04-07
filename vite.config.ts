import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
      base: './',
      server: {
        port: 5173,
        strictPort: false,
        host: 'localhost',
      },
      plugins: [react(), viteSingleFile()],
      build: {
        // 把所有资源内联到一个 HTML 文件
        assetsInlineLimit: Infinity,
        cssCodeSplit: false,
        rollupOptions: {
          output: {
            manualChunks: undefined, // 禁用代码分割，全部合并
          }
        }
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname),
        }
      },
      optimizeDeps: {
        include: ['react', 'react-dom'],
      }
    };
});
