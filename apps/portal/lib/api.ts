import { notFound } from 'next/navigation';

/**
 * Cliente dos endpoints PÚBLICOS da API. O portal não autentica nada: o
 * que a API não devolve (competição em_criacao, nomes de atleta antes de
 * em_andamento) simplesmente não existe aqui — a proteção mora no backend
 * e no RLS, nunca neste código.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';

async function buscar<T>(caminho: string): Promise<T> {
  const r = await fetch(`${API}${caminho}`, {
    // dados de campeonato mudam a cada lance: sem cache de SSR por ora
    cache: 'no-store',
  });
  if (r.status === 404) notFound();
  if (!r.ok) throw new Error(`API ${r.status} em ${caminho}`);
  return (await r.json()) as T;
}

export interface Categoria {
  id: string;
  nome: string;
  tipo: string;
  genero: string;
  modalidade: string;
  formato: string;
  numTimes: number;
  numGrupos: number;
  faseMataMata: string;
  turnoReturno: boolean;
  ordem: number;
}

export interface Competicao {
  id: string;
  nome: string;
  slug: string;
  temporada: number | null;
  dataInicio: string | null;
  dataFim: string | null;
  regulamento: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  local: { pais: string; estado: string; cidade: string };
  corPrimaria: string;
  status: string;
  exibeNomesDeAtletas: boolean;
  categorias: Categoria[];
}

export interface LinhaClassificacao {
  posicao: number;
  timeId: string;
  nome: string;
  jogos: number;
  vitorias: number;
  empates: number;
  derrotas: number;
  golsPro: number;
  golsContra: number;
  saldoGols: number;
  pontos: number;
  porcentagem: number;
  colunaExtra: number;
  cartaoAmarelo: number;
  cartaoVermelho: number;
  cartaoAzul: number;
}

export interface Classificacao {
  competicao: { slug: string; nome: string };
  categoria: { id: string; nome: string };
  colunasVisiveis: string[];
  colunaExtraRotulo: string;
  grupos: { grupo: string | null; times: LinhaClassificacao[] }[];
}

export interface LadoDoJogo {
  definido: boolean;
  id: string | null;
  nome: string;
  escudoUrl: string | null;
}

export interface JogoPublico {
  id: string;
  rodada: number | null;
  data: string | null;
  hora: string | null;
  status: string;
  aoVivo: boolean;
  mandante: LadoDoJogo;
  visitante: LadoDoJogo;
  placar: { mandante: number; visitante: number } | null;
  penaltis: { mandante: number; visitante: number } | null;
  campo: { id: string; nome: string } | null;
}

export interface TabelaDeJogos {
  competicao: { slug: string; nome: string };
  categoria: { id: string; nome: string };
  totalJogos: number;
  encerrados: number;
  semData: number;
  faseGrupos: { grupo: string | null; rodadas: { rodada: number; jogos: JogoPublico[] }[] }[];
  mataMata: { chave: string; nome: string; ordem: number; jogos: JogoPublico[] }[];
}

export interface Lance {
  id: string;
  tipo: string;
  minuto: number;
  periodo: number;
  golContra: boolean;
  convertido: boolean | null;
  time: { id: string; nome: string };
  atleta: { id: string; nome: string } | null;
  assistencia: { id: string; nome: string } | null;
  substituido: { id: string; nome: string } | null;
}

export interface Escalado {
  atletaId: string;
  nome: string;
  apelido: string | null;
  posicao: string | null;
  numero: number | null;
  titular: boolean;
  minutos: number | null;
}

export interface DetalheDoJogo {
  competicao: { slug: string; nome: string };
  categoria: { id: string; nome: string };
  jogo: JogoPublico & {
    fase: { chave: string; nome: string } | null;
    grupo: string | null;
    arbitro: { id: string; nome: string } | null;
  };
  exibeNomesDeAtletas: boolean;
  motivoBloqueio: string | null;
  escalacoes: { mandante: Escalado[]; visitante: Escalado[] } | null;
  lances: Lance[] | null;
}

export const api = {
  competicao: (slug: string) => buscar<Competicao>(`/competicoes/${slug}`),
  classificacao: (slug: string, categoriaId: string) =>
    buscar<Classificacao>(
      `/competicoes/${slug}/categorias/${categoriaId}/classificacao`,
    ),
  jogos: (slug: string, categoriaId: string) =>
    buscar<TabelaDeJogos>(`/competicoes/${slug}/categorias/${categoriaId}/jogos`),
  jogo: (slug: string, categoriaId: string, jogoId: string) =>
    buscar<DetalheDoJogo>(
      `/competicoes/${slug}/categorias/${categoriaId}/jogos/${jogoId}`,
    ),
};

/** URL do feed SSE — usada no navegador, então precisa ser pública. */
export function urlAoVivo(slug: string, categoriaId: string, jogoId: string) {
  const publica = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  return `${publica}/competicoes/${slug}/categorias/${categoriaId}/jogos/${jogoId}/ao-vivo`;
}
