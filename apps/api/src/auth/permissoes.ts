/**
 * Quem pode escrever o quê (RF031).
 *
 * O dono da conta convida funcionários com um de três perfis. A permissão
 * é por RECURSO, não por rota: rota nova entra herdando o recurso do
 * controller, e não passa a ser liberada só porque ninguém lembrou de
 * decorá-la.
 *
 * Duas decisões que sustentam o resto:
 *
 *  • **Leitura é livre dentro da organização.** Um mesário precisa ver a
 *    tabela para achar o jogo, e a classificação para conferir o que
 *    lançou. Esconder leitura daria a impressão de dado faltando sem
 *    proteger nada — a organização já é o recorte do RLS.
 *
 *  • **Escrita nasce fechada.** Recurso sem mapa aqui não é liberado para
 *    ninguém além do dono e do gestor. Errar para o lado de negar produz
 *    um chamado; errar para o lado de permitir produz um mesário
 *    apagando a competição.
 *
 * Módulo puro de propósito: a matriz é o coração da regra e merece teste
 * sem banco nem HTTP.
 */

/** Os recursos que uma escrita pode tocar. */
export const RECURSOS = [
  /** criar competição, status, domínio, logo */
  'competicao',
  /** categorias, configuração, fases, campos, árbitros, coluna extra */
  'estrutura',
  /** equipes, atletas, inscrições, comissão técnica */
  'elenco',
  /** gerar tabela, programar jogo, definir classificados */
  'tabela',
  /** operar a partida: iniciar, lançar, corrigir, encerrar */
  'sumula',
  /** suspensão manual e revogação */
  'disciplina',
  /** convidar e gerenciar os usuários da conta */
  'equipe',
  /** criar evento, lotes, emitir e cancelar pedido (RF035) */
  'evento',
  /** ler o QR no portão e dar baixa no ingresso do dia (RF035) */
  'portaria',
  /** entregar o produto da ficha de consumo no balcão (RF035) */
  'balcao',
  /** cobrar a inscrição da equipe e liberá-la na mão (RF035) */
  'inscricao',
] as const;

export type Recurso = (typeof RECURSOS)[number];

/**
 * `organizador` é o dono; `superadmin` administra qualquer conta que tenha
 * assumido (migration 15) e por isso escreve como o dono escreveria — menos
 * em `equipe`, que é sempre da própria conta.
 */
const TODOS_OS_DONOS = ['organizador', 'superadmin'] as const;

export const PERMISSOES: Record<Recurso, readonly string[]> = {
  competicao: [...TODOS_OS_DONOS, 'gestor'],
  estrutura: [...TODOS_OS_DONOS, 'gestor'],
  elenco: [...TODOS_OS_DONOS, 'gestor', 'secretaria'],
  tabela: [...TODOS_OS_DONOS, 'gestor'],
  sumula: [...TODOS_OS_DONOS, 'gestor', 'mesario'],
  disciplina: [...TODOS_OS_DONOS, 'gestor'],
  // o banco reconfere em fn_exige_dono_da_conta; aqui é só para a resposta
  // sair 403 com mensagem em vez de estourar o erro do Postgres
  equipe: [...TODOS_OS_DONOS],

  // Vender e conferir são turnos diferentes: quem monta o evento e mexe
  // em preço não é quem fica no portão com o celular na mão. Por isso são
  // dois recursos, e `portaria` inclui o mesário — é o perfil operacional
  // que já existe, e o plantão é o mesmo.
  //
  // Quando a portaria for gente contratada só para o dia, o certo é um
  // perfil `portaria` próprio, que entra pela equipe da conta sem enxergar
  // súmula. Não foi criado agora porque ninguém pediu — e perfil novo mexe
  // no enum do banco e na tela de equipe.
  evento: [...TODOS_OS_DONOS, 'gestor'],
  portaria: [...TODOS_OS_DONOS, 'gestor', 'mesario'],

  // Recurso próprio, e não "portaria": quem fica no bar e quem fica na
  // entrada são turnos diferentes, e a tela de cada um recusa o código
  // do outro. Hoje a lista de perfis é a mesma — o que separa de fato é
  // a tela. Quando houver gente contratada só para o bar, um perfil
  // `balcao` entra aqui sem mexer em mais nada.
  balcao: [...TODOS_OS_DONOS, 'gestor', 'mesario'],

  // Não é `elenco`, apesar de falar de equipe na categoria: quem
  // cadastra equipe e atleta é a secretaria, e dispensar o pagamento de
  // uma inscrição é decisão de dinheiro. Com o recurso `elenco`, a
  // secretaria liberaria quem quisesse.
  inscricao: [...TODOS_OS_DONOS, 'gestor'],
};

/** Perfis que o dono pode distribuir. Nem `organizador`, nem `superadmin`. */
export const PERFIS_DA_EQUIPE = ['gestor', 'secretaria', 'mesario'] as const;
export type PerfilDaEquipe = (typeof PERFIS_DA_EQUIPE)[number];

export const ROTULO_DO_PERFIL: Record<string, string> = {
  superadmin: 'ADM do sistema',
  organizador: 'Responsável pela conta',
  gestor: 'Gestor',
  secretaria: 'Secretaria',
  mesario: 'Mesário',
};

export const DESCRICAO_DO_PERFIL: Record<PerfilDaEquipe, string> = {
  gestor:
    'Faz tudo na competição, como o responsável: categorias, equipes, tabela, jogos e configuração. Não gerencia quem entra na conta.',
  secretaria:
    'Cadastra e edita equipes, atletas e comissão técnica. Não opera jogos nem altera a configuração da competição.',
  mesario:
    'Opera a partida: inicia, lança os acontecimentos, corrige e encerra. Imprime súmula, lê o QR no portão e entrega ficha no balcão. Não cadastra, não configura e não mexe em preço.',
};

export function podeEscrever(perfil: string | undefined, recurso: Recurso) {
  return PERMISSOES[recurso]?.includes(perfil ?? '') ?? false;
}

/** O que este perfil pode escrever — usado pela tela para não oferecer beco sem saída. */
export function recursosDoPerfil(perfil: string | undefined): Recurso[] {
  return RECURSOS.filter((r) => podeEscrever(perfil, r));
}
