/**
 * Cliente da API autenticada. O token vive em `sessionStorage`, não em
 * `localStorage`: some ao fechar a aba, o que é o comportamento certo para
 * um painel administrativo compartilhado (mesa da secretaria, notebook da
 * federação). Enquanto não houver refresh token, expirar é sair.
 */
const BASE = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_URL ?? '');
const CHAVE = 'apitofut.sessao';

export interface Sessao {
  token: string;
  usuario: { id: string; nome: string; perfil: string; organizacaoId: string };
}

export const sessao = {
  ler(): Sessao | null {
    const cru = sessionStorage.getItem(CHAVE);
    if (!cru) return null;
    try {
      return JSON.parse(cru) as Sessao;
    } catch {
      sessionStorage.removeItem(CHAVE);
      return null;
    }
  },
  gravar(s: Sessao) {
    sessionStorage.setItem(CHAVE, JSON.stringify(s));
  },
  limpar() {
    sessionStorage.removeItem(CHAVE);
  },
};

/** Erro com a mensagem que a API devolveu — é ela que a tela mostra. */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

async function requisitar<T>(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown; autenticado?: boolean } = {},
): Promise<T> {
  const { metodo = 'GET', corpo, autenticado = true } = opcoes;
  const cabecalhos: Record<string, string> = {};

  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (autenticado) {
    const s = sessao.ler();
    if (s) cabecalhos.Authorization = `Bearer ${s.token}`;
  }

  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  if (r.status === 401 && autenticado) {
    // token expirado ou inválido: derruba a sessão e deixa o app redirecionar
    sessao.limpar();
    window.dispatchEvent(new Event('apitofut:sessao-expirada'));
  }

  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    const msg =
      (dados as { message?: string | string[] })?.message ??
      `Erro ${r.status} na requisição.`;
    throw new ErroDaApi(r.status, Array.isArray(msg) ? msg.join(', ') : msg);
  }
  return dados as T;
}

// ---------------------------------------------------------------- tipos

export interface CompeticaoDoPainel {
  id: string;
  nome: string;
  slug: string;
  status: string;
  dataInicio: string;
  dataFim: string | null;
  cidade: string;
  estado: string;
  cor: string;
  categorias: { id: string; nome: string }[];
  totais: { equipes: number; jogos: number; atletas: number };
}

export interface CategoriaDoWizard {
  nome: string;
  tipo: string;
  genero: string;
  modalidade: string;
  formato: string;
  numTimes: number;
  numGrupos: number;
  faseMataMata: string;
  turnoReturno: boolean;
}

export interface NovaCompeticao {
  nome: string;
  pais: string;
  estado: string;
  cidade: string;
  dataInicio: string;
  dataFim?: string | null;
  regulamento?: string | null;
  cor: string;
  possuiCategorias: boolean;
  categorias: CategoriaDoWizard[];
}

export const api = {
  login: (email: string, senha: string) =>
    requisitar<Sessao>('/auth/login', {
      metodo: 'POST',
      corpo: { email, senha },
      autenticado: false,
    }),

  competicoes: () => requisitar<CompeticaoDoPainel[]>('/painel/competicoes'),

  criarCompeticao: (dados: NovaCompeticao) =>
    requisitar<{ id: string; nome: string; slug: string; status: string }>(
      '/painel/competicoes',
      { metodo: 'POST', corpo: dados },
    ),

  mudarStatus: (id: string, status: string) =>
    requisitar<{ id: string; slug: string; status: string }>(
      `/painel/competicoes/${id}/status`,
      { metodo: 'PATCH', corpo: { status } },
    ),
};
