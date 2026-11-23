/**
 * Vocabulário do domínio, espelhando o protótipo (STATUS, MODALIDADES,
 * FORMATOS, FASES, CORES, UFS). O painel apenas rotula — as regras que
 * importam vivem no banco e na API.
 */

export const STATUS: Record<string, { rotulo: string; descricao: string; cor: string }> = {
  em_criacao: {
    rotulo: 'Em criação',
    descricao: 'Ambiente privado. Nada aparece no portal público.',
    cor: 'bg-slate-100 text-slate-700',
  },
  publicada: {
    rotulo: 'Publicada',
    descricao:
      'Tabela de jogos e classificação ficam visíveis. Nenhum nome de atleta é exibido.',
    cor: 'bg-blue-100 text-blue-700',
  },
  em_andamento: {
    rotulo: 'Em andamento',
    descricao:
      'Todos os dados ficam visíveis, inclusive escalações e súmula ao vivo.',
    cor: 'bg-green-100 text-green-700',
  },
  encerrada: {
    rotulo: 'Encerrada',
    descricao: 'Competição finalizada; o histórico permanece público.',
    cor: 'bg-amber-100 text-amber-700',
  },
};

export const CORES = [
  '#16A34A', '#2563EB', '#DC2626', '#7C3AED', '#EA580C',
  '#0891B2', '#DB2777', '#CA8A04', '#0F172A', '#059669',
];

export const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

export const PAISES = ['Brasil', 'Portugal', 'Espanha', 'Argentina', 'Estados Unidos'];

export const MODALIDADES: [string, string][] = [
  ['fut7', 'Fut7'], ['fut9', 'Fut9'], ['futsal', 'Futsal'], ['fut11', 'Fut11'],
];

export const TIPOS: [string, string][] = [
  ['infanto_juvenil', 'Infanto-juvenil'], ['adulto', 'Adulto'],
];

export const GENEROS: [string, string][] = [
  ['masculino', 'Masculino'], ['feminino', 'Feminino'],
];

export const FORMATOS: [string, string][] = [
  ['grupos_mata', 'Grupos e Mata-mata'],
  ['pontos_mata', 'Pontos corridos e Mata-mata'],
];

export const FASES: [string, string, number][] = [
  ['oitavas', 'Oitavas de final', 16],
  ['quartas', 'Quartas de final', 8],
  ['semi', 'Semifinal', 4],
  ['final', 'Final', 2],
];

/** Defaults de novaCategoriaObj no protótipo. */
export function categoriaPadrao(nome = '', base?: Partial<CategoriaBase>): CategoriaBase {
  return {
    nome,
    tipo: base?.tipo ?? 'adulto',
    genero: base?.genero ?? 'masculino',
    modalidade: base?.modalidade ?? 'fut7',
    formato: base?.formato ?? 'grupos_mata',
    numTimes: base?.numTimes ?? 8,
    numGrupos: base?.numGrupos ?? 2,
    faseMataMata: base?.faseMataMata ?? 'semi',
    turnoReturno: base?.turnoReturno ?? false,
  };
}

export interface CategoriaBase {
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

export function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function formataData(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Status do evento (RF035). Mapa próprio, separado do `STATUS` da
 * competição: as palavras são parecidas ("publicado" / "publicada") e os
 * significados não são — evento tem bilheteria, competição não.
 */
export const STATUS_DO_EVENTO: Record<
  string,
  { rotulo: string; descricao: string; cor: string }
> = {
  rascunho: {
    rotulo: 'Rascunho',
    descricao: 'Invisível ao público. Dá para vender no balcão e testar o portão.',
    cor: 'bg-slate-100 text-slate-700',
  },
  publicado: {
    rotulo: 'Publicado',
    descricao: 'A página do evento está no ar com os lotes ativos.',
    cor: 'bg-green-100 text-green-700',
  },
  encerrado: {
    rotulo: 'Encerrado',
    descricao: 'Evento realizado. A página continua no ar; a venda, não.',
    cor: 'bg-amber-100 text-amber-700',
  },
  cancelado: {
    rotulo: 'Cancelado',
    descricao: 'Fora do ar e fora do portão: nenhum ingresso entra.',
    cor: 'bg-red-100 text-red-700',
  },
};

/**
 * Dinheiro — sempre centavos inteiros do lado de dentro.
 *
 * Nada aqui converte para número de ponto flutuante: `19,90` vira 1990 por
 * contagem de dígitos, não por `parseFloat(…) * 100`, que devolve
 * 1989.9999999999998 e arredonda o preço de um lote para baixo.
 */
export function moeda(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/** `R$ 19,90`, `19.90`, `1990` com dois decimais → 1990 centavos. */
export function centavosDeTexto(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/gi, '');
  if (!limpo) return null;
  // vírgula e ponto são ambos separador decimal aqui: quem digita no
  // teclado numérico do celular produz "19.90", quem digita no teclado
  // brasileiro produz "19,90", e as duas coisas querem dizer o mesmo
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(limpo);
  if (!m) return null;
  const reais = Number(m[1]);
  const cents = Number((m[2] ?? '0').padEnd(2, '0'));
  return reais * 100 + cents;
}

/** O inverso, para preencher o campo de edição sem símbolo de moeda. */
export function textoDeCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',');
}
