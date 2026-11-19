import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH = "/recettes/" pour GitHub Pages, "/" en local
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  // Règles partagées avec les fonctions Supabase (supabase/functions/_shared)
  server: { fs: { allow: ['..'] } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Recettes & Menus',
        short_name: 'Recettes',
        description: 'Carnet de recettes, menus de la semaine et liste de courses partagée',
        lang: 'fr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf7f2',
        theme_color: '#c2562b',
        // Android : l'app apparaît dans le menu Partager. iPhone : via un Raccourci qui ouvre ?import=<lien>
        share_target: {
          action: base,
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // Réception des notifications (rappel du dimanche)
        importScripts: ['push-sw.js'],
        // Police des titres disponible hors ligne (latin et latin étendu suffisent pour le français)
        globPatterns: ['**/*.{js,css,html,svg,png,ico}', '**/fraunces-latin-*.woff2'],
      },
    }),
  ],
})
