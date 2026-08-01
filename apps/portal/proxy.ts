import { NextResponse, type NextRequest } from 'next/server';

/**
 * White-label por domínio próprio (RF002).
 *
 * A federação aponta um CNAME para o portal; a competição responde no
 * domínio dela sem `/{slug}` na URL. Esta camada é a razão de o portal ser
 * Next e não uma SPA: a resolução precisa acontecer no servidor, antes de
 * renderizar, e o `rewrite` não muda o endereço que o visitante vê.
 *
 * Arquivo `proxy.ts`, não `middleware.ts`: o Next 16 renomeou a convenção
 * e avisa em toda subida que a antiga vai sair.
 *
 *   copa.federacao.com/            → /copa-2026
 *   copa.federacao.com/{cat}       → /copa-2026/{cat}
 *   apitofut.com/copa-2026         → segue direto, sem reescrever
 *
 * Quem decide é a API (`/competicoes/resolver`), que aplica a mesma regra
 * de visibilidade do slug: competição `em_criacao` não resolve. Apontar o
 * CNAME antes de publicar não pode entregar ao público uma competição
 * ainda em montagem.
 */

const API = process.env.API_URL ?? 'http://localhost:3000';

/**
 * Hosts que são a própria plataforma — nestes o caminho já traz o slug.
 * `PLATAFORMA_HOSTS` aceita lista separada por vírgula para cobrir os
 * ambientes (apitofut.com, staging, o domínio da Vercel).
 */
const HOSTS_DA_PLATAFORMA = new Set(
  (process.env.PLATAFORMA_HOSTS ?? 'apitofut.com,localhost')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Cache de host → slug em memória.
 *
 * Sem ele, toda navegação em todo domínio próprio custaria uma ida à API
 * antes de qualquer renderização. O TTL é curto de propósito: quando o
 * organizador troca o domínio, o erro dura no máximo um minuto.
 *
 * O `null` também é cacheado — host desconhecido é o caso mais provável de
 * repetição (varredura de bot), e é justamente o que não pode virar carga
 * no banco.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { slug: string | null; expira: number }>();

async function slugDoHost(host: string): Promise<string | null> {
  const agora = Date.now();
  const guardado = cache.get(host);
  if (guardado && guardado.expira > agora) return guardado.slug;

  try {
    const r = await fetch(
      `${API}/competicoes/resolver?host=${encodeURIComponent(host)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(2000) },
    );
    if (!r.ok) return null;

    const { slug } = (await r.json()) as { slug: string | null };
    cache.set(host, { slug, expira: agora + TTL_MS });
    return slug;
  } catch {
    // API fora do ar ou lenta: não cacheia o erro como "não existe", senão
    // um soluço de 2s deixaria o domínio quebrado pelo TTL inteiro
    return null;
  }
}

/** Remove porta, ponto final e `www.` — mesma normalização da API. */
function normalizar(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

export default async function proxy(req: NextRequest) {
  const host = normalizar(
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '',
  );

  if (!host || HOSTS_DA_PLATAFORMA.has(host)) return NextResponse.next();

  const slug = await slugDoHost(host);
  if (!slug) return NextResponse.next();

  // Já reescrito ou o visitante digitou o slug no domínio próprio: seguir
  // sem prefixar de novo, senão viraria /copa-2026/copa-2026.
  const caminho = req.nextUrl.pathname;
  if (caminho === `/${slug}` || caminho.startsWith(`/${slug}/`)) {
    return NextResponse.next();
  }

  const destino = req.nextUrl.clone();
  destino.pathname = `/${slug}${caminho === '/' ? '' : caminho}`;
  return NextResponse.rewrite(destino);
}

export const config = {
  /**
   * Fora daqui: assets, imagens e metadados. Cada requisição destas
   * custaria uma resolução de host — e nenhuma delas depende da competição.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
