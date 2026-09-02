/** @type {import('next').NextConfig} */
const API = process.env.API_URL ?? 'http://localhost:3000';

const nextConfig = {
  /**
   * Build autocontido: o Next copia para `.next/standalone` só o que a
   * aplicação usa em runtime, com um `server.js` próprio. É o que o
   * Dockerfile empacota — sem isto a imagem carregaria o `node_modules`
   * inteiro do monorepo, e o `next start` exigiria o workspace montado.
   */
  output: 'standalone',
  // a raiz do monorepo, não a da app: é de lá que vêm os node_modules
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  /**
   * A área da equipe (`/{slug}/inscricao`) é client component e fala com a
   * API do navegador. Passar por `/api/*` do próprio portal mantém tudo na
   * mesma origem: sem CORS, e sem precisar de uma `NEXT_PUBLIC_API_URL`
   * que exporia o endereço interno da API no bundle.
   *
   * O white-label por domínio próprio vive em `proxy.ts`.
   */
  async rewrites() {
    return [{ source: '/api/:caminho*', destination: `${API}/:caminho*` }];
  },
};

export default nextConfig;
