import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app adds a card's scripts as classic <script> tags, not modules, so the build
// must be one self-contained file: an IIFE, no code splitting, no module preload.
// CSS goes to its own file (cssCodeSplit: false), so the app can add it before the
// game's theme instead of the script injecting it after.
export default defineConfig({
  plugins: [react()],
  build: {
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
