import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Compila a wwwroot/dataviews (ASP.NET Core lo sirve como estático). El build se commitea:
// la publicación solo corre dotnet, sin Node.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../wwwroot/dataviews',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.tsx',
      output: { entryFileNames: 'dataviews.js', assetFileNames: 'dataviews[extname]' },
    },
  },
  test: { environment: 'node' },
});
