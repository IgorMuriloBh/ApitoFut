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
