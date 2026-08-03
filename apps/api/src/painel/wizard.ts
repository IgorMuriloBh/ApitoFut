import {
  formato_categoria,
  genero_categoria,
  modalidade,
  tipo_categoria,
} from '@prisma/client';

/**
 * Payload do wizard "Criar campeonato" (RF003/RF004) e sua validação,
 * espelhando o protótipo: as mensagens são as dos toasts de wzNext1 e
 * wzFinishCats, e as regras de saneamento são as de catSet/wzCreate.
 * Função pura para ser testável sem HTTP.
 */

export interface WizardCategoria {
  nome: string;
  tipo?: tipo_categoria;
  genero?: genero_categoria;
  modalidade?: modalidade;
  formato?: formato_categoria;
  numTimes?: number;
  numGrupos?: number;
  faseMataMata?: string;
  turnoReturno?: boolean;
}

export interface WizardCompeticao {
  nome: string;
  pais?: string;
  estado: string;
  cidade: string;
  dataInicio: string;
  dataFim?: string | null;
  regulamento?: string | null;
  cor?: string;
  temporada?: number;
  possuiCategorias?: boolean;
  categorias?: WizardCategoria[];
  /** Caminho devolvido por POST /painel/uploads. */
  logoUrl?: string | null;
}

export interface CategoriaSaneada {
  nome: string;
  tipo: tipo_categoria;
  genero: genero_categoria;
  modalidade: modalidade;
  formato: formato_categoria;
  num_times: number;
  num_grupos: number;
  fase_mata_mata: string;
  turno_returno: boolean;
  ordem: number;
}

const FASES_MATA = ['oitavas', 'quartas', 'semi', 'final'];
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export class WizardInvalido extends Error {}

function exigir(cond: unknown, mensagem: string): asserts cond {
  if (!cond) throw new WizardInvalido(mensagem);
}

/**
 * Saneia UMA categoria. Extraído do wizard porque o CRUD de categoria
 * (criar e editar depois que a competição existe) precisa exatamente das
 * mesmas regras — e duas cópias divergiriam na primeira mudança.
 */
export function validarCategoria(
  c: WizardCategoria,
  ordem = 0,
): CategoriaSaneada {
  // mensagem de wzFinishCats
  exigir(c?.nome?.trim(), 'Todas as categorias precisam de um nome.');

  const formato = c.formato ?? 'grupos_mata';
  const numTimes = c.numTimes ?? 8;
  const numGrupos = formato === 'pontos_mata' ? 1 : (c.numGrupos ?? 2); // catSet força 1
  const fase = c.faseMataMata ?? 'semi';

  exigir(
    Number.isInteger(numTimes) && numTimes >= 2 && numTimes <= 128,
    `Categoria "${c.nome}": nº de times deve estar entre 2 e 128.`,
  );
  exigir(
    Number.isInteger(numGrupos) && numGrupos >= 1 && numGrupos <= 16,
    `Categoria "${c.nome}": nº de grupos deve estar entre 1 e 16.`,
  );
  exigir(
    FASES_MATA.includes(fase),
    `Categoria "${c.nome}": fase do mata-mata deve ser ${FASES_MATA.join(', ')}.`,
  );

  return {
    nome: c.nome.trim(),
    tipo: (c.tipo ?? 'adulto') as CategoriaSaneada['tipo'],
    genero: (c.genero ?? 'masculino') as CategoriaSaneada['genero'],
    modalidade: (c.modalidade ?? 'fut7') as CategoriaSaneada['modalidade'],
    formato: formato as CategoriaSaneada['formato'],
    num_times: numTimes,
    num_grupos: numGrupos,
    fase_mata_mata: fase,
    turno_returno: c.turnoReturno ?? false,
    ordem,
  };
}

/** Valida e normaliza; devolve o que o INSERT precisa. Lança WizardInvalido. */
export function validarWizard(w: WizardCompeticao): {
  competicao: {
    nome: string;
    pais: string;
    estado: string;
    cidade: string;
    data_inicio: Date;
    data_fim: Date | null;
    regulamento: string | null;
    cor_primaria: string;
    logo_url: string | null;
    temporada: number | null;
    possui_categorias: boolean;
  };
  categorias: CategoriaSaneada[];
} {
  // mensagens de wzNext1
  exigir(w?.nome?.trim(), 'Informe o nome do campeonato.');
  exigir(w.estado?.trim(), 'Selecione o estado.');
  exigir(w.cidade?.trim(), 'Informe a cidade.');
  exigir(w.dataInicio, 'Informe a data de início.');

  exigir(/^[A-Za-z]{2}$/.test(w.estado.trim()), 'Estado deve ser a sigla UF (2 letras).');
  exigir(DATA_ISO.test(w.dataInicio), 'Data de início deve ser AAAA-MM-DD.');
  if (w.dataFim) {
    exigir(DATA_ISO.test(w.dataFim), 'Data de término deve ser AAAA-MM-DD.');
    exigir(w.dataFim >= w.dataInicio, 'Data de término anterior à de início.');
  }

  const cor = (w.cor ?? '#16A34A').trim();
  exigir(/^#[0-9a-fA-F]{6}$/.test(cor), 'Cor deve ser hex no formato #RRGGBB.');

  const possuiCategorias = w.possuiCategorias ?? true;

  // wzNext1: sem categorias → categoria única com o nome do campeonato
  const brutas: WizardCategoria[] = possuiCategorias
    ? (w.categorias ?? [])
    : [{ nome: w.nome.trim() }];

  exigir(
    brutas.length > 0,
    'Inclua ao menos uma categoria, ou envie possuiCategorias=false para a categoria única.',
  );

  const categorias = brutas.map((c, i) => validarCategoria(c, i));

  const nomes = new Set(categorias.map((c) => c.nome.toLowerCase()));
  exigir(nomes.size === categorias.length, 'Há categorias com o mesmo nome.');

  return {
    competicao: {
      nome: w.nome.trim(),
      pais: w.pais?.trim() || 'Brasil',
      estado: w.estado.trim().toUpperCase(),
      cidade: w.cidade.trim(),
      data_inicio: new Date(`${w.dataInicio}T00:00:00Z`),
      data_fim: w.dataFim ? new Date(`${w.dataFim}T00:00:00Z`) : null,
      regulamento: w.regulamento?.trim() || null,
      cor_primaria: cor.toUpperCase(),
      // o caminho vem de POST /painel/uploads; o serviço normaliza
      logo_url: w.logoUrl ?? null,
      temporada: w.temporada ?? new Date(w.dataInicio).getUTCFullYear(),
      possui_categorias: possuiCategorias,
    },
    categorias,
  };
}
