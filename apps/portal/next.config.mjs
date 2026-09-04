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
   * Tudo que o NAVEGADOR chama da API passa por aqui: a área da equipe
   * (`/{slug}/inscricao`) e o feed SSE do placar ao vivo. Mesma origem,
   * então sem CORS e sem uma `NEXT_PUBLIC_API_URL` que exporia o endereço
   * interno da API no bundle — e que, quando faltava no build, deixava o
   * cliente apontando para `localhost` sem nenhum sintoma visível.
   *
   * O rewrite repassa `text/event-stream` sem bufferizar: o evento nasce
   * no NOTIFY do Postgres e chega ao navegador na hora. Verificado.
   *
   * O white-label por domínio próprio vive em `proxy.ts`.
   */
  async rewrites() {
    return [{ source: '/api/:caminho*', destination: `${API}/:caminho*` }];
  },
};

export default nextConfig;
