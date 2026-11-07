import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const wasmRuntime = fileURLToPath(
  new URL('./node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs', import.meta.url),
);
const ortDir = new URL('./node_modules/onnxruntime-web/dist/', import.meta.url);
const ortFiles = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'] as const;

function copyOrtRuntime(): Plugin {
  return {
    name: 'copy-ort-runtime',
    generateBundle() {
      for (const file of ortFiles) {
        this.emitFile({
          type: 'asset',
          fileName: `ort/${file}`,
          source: readFileSync(new URL(file, ortDir)),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const name = url.split('?')[0]?.split('/').pop() ?? '';
        if (!url.includes('/ort/') || !ortFiles.includes(name as (typeof ortFiles)[number])) {
          next();
          return;
        }
        res.setHeader(
          'Content-Type',
          name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        );
        res.end(readFileSync(new URL(name, ortDir)));
      });
    },
  };
}

export default defineConfig({
  base: '/sentiment-classifier/',
  plugins: [copyOrtRuntime()],
  resolve: {
    alias: [
      {
        find: /^onnxruntime-web$/,
        replacement: wasmRuntime,
      },
    ],
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    target: 'esnext',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
