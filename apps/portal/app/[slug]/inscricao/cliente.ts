/**
 * Cliente da área da equipe.
 *
 * Fala com `/api/convite/...` — o rewrite do `next.config.mjs` mantém tudo
 * na mesma origem, então não há CORS nem endereço da API no bundle.
 *
 * O código de acesso vai no cabeçalho `X-Codigo-Equipe`, nunca na URL: é
 * credencial, e em query string apareceria em log de proxy e no histórico
 * do navegador da secretaria do clube.
 */

/** Preserva o corpo do erro: o 409 da faixa etária vem com `avisos`. */
export class ErroDaApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly dados: { erro?: string; avisos?: AvisoDeFaixa[] } | null,
  ) {
    super(mensagem);
  }
}

export interface AvisoDeFaixa {
  categoria: string;
  anoEsperado: number;
  anoDoAtleta: number;
}

export function criarCliente(slug: string) {
  return async function chamar(
    caminho: string,
    opcoes: { metodo?: string; corpo?: unknown; codigo?: string } = {},
  ) {
    const r = await fetch(`/api/convite/${slug}${caminho}`, {
      method: opcoes.metodo ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opcoes.codigo ? { 'X-Codigo-Equipe': opcoes.codigo } : {}),
      },
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
    });
    const dados = (await r.json().catch(() => null)) as {
      message?: string;
      erro?: string;
      avisos?: AvisoDeFaixa[];
    } | null;

    if (!r.ok) {
      throw new ErroDaApi(
        dados?.message ?? 'Não foi possível concluir.',
        r.status,
        dados,
      );
    }
    return dados;
  };
}

export type Chamar = ReturnType<typeof criarCliente>;

/**
 * Upload de imagem pela equipe. O corpo são os bytes crus, com o
 * `Content-Type` do arquivo — a API decide o formato pelos bytes, não pelo
 * que o cliente declara.
 */
export async function enviarImagem(
  slug: string,
  codigo: string,
  arquivo: File,
): Promise<string> {
  const r = await fetch(`/api/convite/${slug}/equipe/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': arquivo.type || 'application/octet-stream',
      'X-Codigo-Equipe': codigo,
    },
    body: arquivo,
  });
  const dados = (await r.json().catch(() => null)) as {
    url?: string;
    message?: string;
  } | null;

  if (!r.ok || !dados?.url) {
    throw new ErroDaApi(dados?.message ?? 'Falha ao enviar a imagem.', r.status, null);
  }
  return dados.url;
}
