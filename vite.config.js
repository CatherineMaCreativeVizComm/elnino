import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
// import dsv from '@rollup/plugin-dsv'
// import tailwindcss from '@tailwindcss/vite'
// import svg from "vite-plugin-svgstring"

// https://vitejs.dev/config/
export default defineConfig({
  base: 'https://multimedia.scmp.com/components/2026/elnino-wgc',
  server: {
    proxy: {
      '/api/multimedia': {
        target: 'https://multimedia.scmp.com', 
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/multimedia/, '') 
      }
    }
  },
  plugins: [
    svelte(),
    // tailwindcss(),
    // svg(),
    // dsv({
    //   processRow: (row, id) => {
    //     Object.keys(row).forEach((key) => {
    //       var value = row[key]
    //       row[key] = isNaN(+value) ? value : +value
    //     })
    //   }
    // })
  ],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-v1.js',
        chunkFileNames: 'assets/[name]-v1.js',
        assetFileNames: ({ name }) => {
          if (name && name.endsWith('.css')) return 'assets/[name]-v1.css'
          return 'assets/[name]-[ext]'
        }
      }
    }
  }
})
