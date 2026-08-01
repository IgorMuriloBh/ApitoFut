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
  /**
   * Preenchido quando o ADM assumiu a organização de outro organizador.
   * É o que acende a tarja de aviso e o botão de voltar — o token também
   * carrega essa informação, mas a tela precisa do nome para exibir.
   */
  assumida?: { competicaoId: string; organizacao: string } | null;
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

/**
 * Erro com a mensagem que a API devolveu — é ela que a tela mostra. O
 * corpo inteiro vem junto porque alguns 409 carregam dados que a tela
 * usa, como os avisos de faixa etária.
 */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly dados?: Record<string, unknown>,
  ) {
    super(mensagem);
  }

  /** 409 de faixa etária: aviso que o organizador pode confirmar. */
  get ehAvisoDeFaixaEtaria(): boolean {
    return this.status === 409 && this.dados?.erro === 'faixa_etaria';
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
    throw new ErroDaApi(
      r.status,
      Array.isArray(msg) ? msg.join(', ') : msg,
      (dados ?? undefined) as Record<string, unknown> | undefined,
    );
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


export interface EquipeDoPainel {
  id: string;
  nome: string;
  escudoUrl: string | null;
  uniformePrimario: string | null;
  uniformeSecundario: string | null;
  cidade: string | null;
  estado: string | null;
  contato: string | null;
  email: string | null;
  responsavel: string | null;
  origem: string;
  comissao: number;
  categorias: { id: string; nome: string; grupo: { id: string; nome: string } | null }[];
}

export interface AtletaDaBase {
  id: string;
  nome: string;
  apelido: string | null;
  dataNascimento: string | null;
  posicao: string | null;
}

export interface AtletaInscrito {
  inscricaoId: string;
  atletaId: string;
  nome: string;
  apelido: string | null;
  posicao: string | null;
  numero: number | null;
  dataNascimento: string | null;
  /** Aviso de faixa etária — nunca esconde nem impede o atleta. */
  foraDaFaixa: boolean;
}

export interface Elenco {
  categoria: { id: string; nome: string; maxAtletas: number | null };
  equipes: {
    id: string;
    nome: string;
    vagas: number | null;
    atletas: AtletaInscrito[];
  }[];
}

export interface PedidoDeInscricao {
  timeId: string;
  categoriaIds: string[];
  atletaId?: string;
  atleta?: {
    nome: string;
    dataNascimento?: string | null;
    posicao?: string | null;
    apelido?: string | null;
  };
  numeroCamisa?: number | null;
  confirmarFaixaEtaria?: boolean;
}

/** Avisos que a API devolve no 409 de faixa etária. */
export interface AvisoDeFaixa {
  categoria: string;
  anoEsperado: number;
  anoDoAtleta: number;
}


export interface JogoDaTabela {
  id: string;
  fase: { chave: string; nome: string; tipo: string } | null;
  grupo: string | null;
  rodada: number | null;
  ordem: number;
  data: string | null;
  hora: string | null;
  campo: { id: string; nome: string } | null;
  status: string;
  mandante: { id: string | null; nome: string };
  visitante: { id: string | null; nome: string };
  placar: { mandante: number; visitante: number } | null;
}

export interface OpcoesDeGeracao {
  simples?: boolean;
  dataInicio?: string;
  intervaloDias?: number;
  primeiroHorario?: string;
  intervaloMinutos?: number;
  substituir?: boolean;
}

export interface ResumoDaGeracao {
  categoria: { id: string; nome: string };
  grupos: { id: string; nome: string; equipes: string[] }[];
  jogos: { total: number; faseDeGrupos: number; mataMata: number; semProgramacao: number };
}


export interface EstadoDoJogo {
  id: string;
  status: string;
  periodo: number;
  cronoRodando: boolean;
  cronoBaseSeg: number;
  placar: { mandante: number; visitante: number };
  penaltis: { mandante: number; visitante: number } | null;
}

export interface LanceRegistrado {
  lance: {
    id: string;
    tipo: string;
    minuto: number;
    periodo: number;
    timeId: string;
    atletaId: string | null;
    assistenciaAtletaId: string | null;
  };
  placar: { mandante: number; visitante: number };
  status: string;
}

// ------------------------------------------------- área do ADM (RF031)

export interface UsuarioDaPlataforma {
  id: string;
  nome: string;
  email: string;
  organizacao: string | null;
  perfil: 'organizador' | 'superadmin';
  situacao: 'pendente' | 'ativo' | 'bloqueado';
  competicoes: number;
  atletas: number;
  ultimoAcesso: string | null;
  criadoEm: string;
}

export interface CompeticaoDaPlataforma {
  id: string;
  nome: string;
  slug: string;
  status: string;
  temporada: number | null;
  cidade: string;
  estado: string;
  organizacaoId: string;
  organizacao: string;
  dono: string | null;
  categorias: number;
  times: number;
  atletas: number;
  jogos: number;
  criadoEm: string;
}

export interface IndicadoresDaPlataforma {
  usuarios: number;
  organizadores: number;
  pendentes: number;
  competicoes: number;
  competicoesAtivas: number;
  times: number;
  atletas: number;
  jogos: number;
  jogosEncerrados: number;
}

/** Resposta do auto-cadastro: só a primeira conta da base recebe token. */
export interface RespostaDeCadastro {
  situacao: 'pendente' | 'ativo';
  perfil: string;
  mensagem: string;
  token: string | null;
  usuario: Sessao['usuario'] | null;
}

export const api = {
  login: (email: string, senha: string) =>
    requisitar<Sessao>('/auth/login', {
      metodo: 'POST',
      corpo: { email, senha },
      autenticado: false,
    }),

  cadastrar: (dados: {
    nome: string;
    email: string;
    senha: string;
    organizacao: string;
  }) =>
    requisitar<RespostaDeCadastro>('/auth/cadastro', {
      metodo: 'POST',
      corpo: dados,
      autenticado: false,
    }),

  admin: {
    indicadores: () => requisitar<IndicadoresDaPlataforma>('/admin/indicadores'),

    usuarios: () => requisitar<UsuarioDaPlataforma[]>('/admin/usuarios'),

    definirSituacao: (id: string, situacao: 'ativo' | 'bloqueado') =>
      requisitar<{ situacao: string }>(`/admin/usuarios/${id}/situacao`, {
        metodo: 'PATCH',
        corpo: { situacao },
      }),

    alternarPerfil: (id: string) =>
      requisitar<{ perfil: string }>(`/admin/usuarios/${id}/perfil`, {
        metodo: 'PATCH',
      }),

    competicoes: () => requisitar<CompeticaoDaPlataforma[]>('/admin/competicoes'),

    assumir: (competicaoId: string) =>
      requisitar<{ token: string; organizacaoId: string; competicaoId: string }>(
        `/admin/competicoes/${competicaoId}/assumir`,
        { metodo: 'POST' },
      ),

    voltar: () =>
      requisitar<{ token: string; organizacaoId: string }>('/admin/voltar', {
        metodo: 'POST',
      }),
  },

  competicoes: () => requisitar<CompeticaoDoPainel[]>('/painel/competicoes'),

  criarCompeticao: (dados: NovaCompeticao) =>
    requisitar<{ id: string; nome: string; slug: string; status: string }>(
      '/painel/competicoes',
      { metodo: 'POST', corpo: dados },
    ),


  equipes: (competicaoId: string) =>
    requisitar<EquipeDoPainel[]>(`/painel/competicoes/${competicaoId}/times`),

  criarEquipe: (competicaoId: string, dados: Record<string, unknown>) =>
    requisitar<{ id: string; nome: string }>(
      `/painel/competicoes/${competicaoId}/times`,
      { metodo: 'POST', corpo: dados },
    ),

  editarEquipe: (timeId: string, dados: Record<string, unknown>) =>
    requisitar<{ id: string; nome: string }>(`/painel/times/${timeId}`, {
      metodo: 'PATCH',
      corpo: dados,
    }),

  removerEquipe: (timeId: string) =>
    requisitar<{ removido: string }>(`/painel/times/${timeId}`, { metodo: 'DELETE' }),

  vincular: (categoriaId: string, timeId: string, grupoId: string | null) =>
    requisitar(`/painel/categorias/${categoriaId}/times/${timeId}`, {
      metodo: 'PUT',
      corpo: { grupoId },
    }),

  desvincular: (categoriaId: string, timeId: string) =>
    requisitar(`/painel/categorias/${categoriaId}/times/${timeId}`, {
      metodo: 'DELETE',
    }),

  buscarAtletas: (busca: string) =>
    requisitar<AtletaDaBase[]>(`/painel/atletas?busca=${encodeURIComponent(busca)}`),

  elenco: (categoriaId: string) =>
    requisitar<Elenco>(`/painel/categorias/${categoriaId}/elenco`),

  inscrever: (pedido: PedidoDeInscricao) =>
    requisitar<{ atletaId: string; categorias: { id: string; nome: string }[] }>(
      '/painel/inscricoes',
      { metodo: 'POST', corpo: pedido },
    ),

  editarInscricao: (inscricaoId: string, dados: { numeroCamisa?: number | null }) =>
    requisitar(`/painel/inscricoes/${inscricaoId}`, { metodo: 'PATCH', corpo: dados }),

  removerInscricao: (inscricaoId: string) =>
    requisitar(`/painel/inscricoes/${inscricaoId}`, { metodo: 'DELETE' }),


  tabela: (categoriaId: string) =>
    requisitar<JogoDaTabela[]>(`/painel/categorias/${categoriaId}/tabela`),

  gerarTabela: (categoriaId: string, opcoes: OpcoesDeGeracao) =>
    requisitar<ResumoDaGeracao>(`/painel/categorias/${categoriaId}/tabela`, {
      metodo: 'POST',
      corpo: opcoes,
    }),

  programarJogo: (
    jogoId: string,
    dados: { data?: string | null; hora?: string | null },
  ) =>
    requisitar<{ id: string; data: string | null; hora: string | null }>(
      `/painel/jogos/${jogoId}/programacao`,
      { metodo: 'PATCH', corpo: dados },
    ),


  iniciarJogo: (jogoId: string) =>
    requisitar<EstadoDoJogo>(`/painel/jogos/${jogoId}/iniciar`, { metodo: 'POST' }),

  trocarPeriodo: (jogoId: string, periodo: number) =>
    requisitar<EstadoDoJogo>(`/painel/jogos/${jogoId}/periodo`, {
      metodo: 'POST',
      corpo: { periodo },
    }),

  encerrarJogo: (
    jogoId: string,
    penaltis?: { mandante: number; visitante: number },
  ) =>
    requisitar<EstadoDoJogo>(`/painel/jogos/${jogoId}/encerrar`, {
      metodo: 'POST',
      corpo: penaltis ? { penaltis } : {},
    }),

  registrarLance: (jogoId: string, lance: Record<string, unknown>) =>
    requisitar<LanceRegistrado>(`/painel/jogos/${jogoId}/lances`, {
      metodo: 'POST',
      corpo: lance,
    }),

  removerLance: (jogoId: string, lanceId: string) =>
    requisitar(`/painel/jogos/${jogoId}/lances/${lanceId}`, { metodo: 'DELETE' }),

  mudarStatus: (id: string, status: string) =>
    requisitar<{ id: string; slug: string; status: string }>(
      `/painel/competicoes/${id}/status`,
      { metodo: 'PATCH', corpo: { status } },
    ),
};
