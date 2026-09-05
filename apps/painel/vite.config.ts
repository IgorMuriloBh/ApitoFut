import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // O proxy evita CORS e deixa o token no mesmo host durante o
    // desenvolvimento. O alvo é a 3000 por padrão, e `API_URL` sobrescreve —
    // mesma variável que o portal já usa, para quem tiver a 3000 ocupada por
    // outro projeto não precisar editar arquivo versionado.
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
});
