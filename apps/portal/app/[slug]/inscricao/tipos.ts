/** Formas que a API do convite devolve. Uma cópia só, usada por toda a tela. */

export interface CategoriaAberta {
  id: string;
  nome: string;
  tipo: string;
  genero: string;
  modalidade: string;
  vagas: number;
  numTimes: number;
  inscritos: number;
  maxAtletas: number;
  maxComissao: number;
}

export interface Convite {
  competicao: {
    nome: string;
    slug: string;
    cidade: string;
    estado: string;
    corPrimaria: string;
    logoUrl: string | null;
    status: string;
  };
  inscricoesAbertas: boolean;
  categorias: CategoriaAberta[];
}

/**
 * Um campo da ficha, como a categoria pediu (RF005 · 2.4). A tela não
 * conhece a lista de campos possíveis — ela desenha o que vier.
 */
export interface CampoDaFicha {
  campo: string;
  rotulo: string;
  tipo:
    | 'texto'
    | 'data'
    | 'email'
    | 'tel'
    | 'numero'
    | 'selecao'
    | 'foto'
    | 'responsavel'
    | 'anexos';
  opcoes?: string[];
  obrigatorio: boolean;
}

export type Ficha = Record<string, unknown>;

export interface AtletaDoElenco {
  inscricaoId: string;
  atletaId: string;
  nome: string;
  numero: number | null;
  foraDaFaixa: boolean;
  ficha: Ficha;
}

export interface Membro {
  id: string;
  nome: string;
  cargo: string;
  contato: string | null;
}

export interface CategoriaDaEquipe {
  id: string;
  nome: string;
  modalidade: string;
  tipo: string;
  genero: string;
  maxAtletas: number | null;
  maxComissao: number;
  permiteInscrever: boolean;
  permiteEditar: boolean;
  permiteRemover: boolean;
  inscricoesAbertas: boolean;
  anoEsperado: number | null;
  campos: CampoDaFicha[];
  comissao: Membro[];
  atletas: AtletaDoElenco[];
}

export interface Painel {
  equipe: {
    id: string;
    nome: string;
    escudoUrl: string | null;
    uniformePrimario: string | null;
    uniformeSecundario: string | null;
    cidade: string | null;
    estado: string | null;
    responsavel: string | null;
    contato: string | null;
    email: string | null;
    codigoAcesso: string | null;
  };
  cargosComissao: string[];
  categorias: CategoriaDaEquipe[];
  comissaoSemCategoria: Membro[];
}

export interface AtletaDaBase {
  id: string;
  nome: string;
  apelido: string | null;
  dataNascimento: string | null;
  posicao: string | null;
  fotoUrl: string | null;
  competicoes: string | null;
}

/**
 * Nome do campo na configuração → chave da ficha no corpo da requisição.
 * `responsavel` e `anexos` têm forma própria e não entram aqui.
 */
export const CHAVE_DO_CAMPO: Record<string, string> = {
  apelido: 'apelido',
  foto: 'fotoUrl',
  cpf: 'cpf',
  rg: 'rg',
  certidao_nascimento: 'certidaoNascimento',
  data_nascimento: 'dataNascimento',
  posicao: 'posicao',
  celular: 'celular',
  email: 'email',
  passaporte: 'passaporte',
  titulo_eleitor: 'tituloEleitor',
  genero: 'genero',
  nacionalidade: 'nacionalidade',
};

/**
 * Limites do campo de data.
 *
 * `<input type="date">` aceita o ano 0218 sem reclamar — quatro dígitos, e
 * o navegador dá por bom. `min`/`max` fazem o próprio campo recusar; a API
 * confere de novo, porque atributo de HTML não é validação.
 */
export const DATA_MINIMA = '1900-01-01';
export const hoje = () => new Date().toISOString().slice(0, 10);
