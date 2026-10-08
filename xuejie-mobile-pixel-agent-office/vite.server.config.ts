import {defineConfig} from 'vite';
export default defineConfig({build:{ssr:'server/index.ts',outDir:'dist-server',emptyOutDir:true,target:'node24',rollupOptions:{output:{entryFileNames:'index.js'}}}});
