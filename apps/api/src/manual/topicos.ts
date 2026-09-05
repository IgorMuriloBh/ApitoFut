/**
 * =====================================================================
 *  Manual do sistema — base de conhecimento
 *
 *  Vive no código e é publicada junto com a aplicação, então nunca fica
 *  numa versão diferente do sistema que descreve. É a razão de estar aqui
 *  e não num CMS ou num Google Docs.
 *
 *  MORA NA API, não no painel nem no portal, porque os dois consomem o
 *  mesmo conteúdo. Um lugar só para editar, e nenhum rebuild de cliente
 *  quando um texto muda.
 *
 *  ┌─ AO MEXER NO SISTEMA ────────────────────────────────────────────┐
 *  │ Funcionalidade nova, regra alterada ou tela renomeada exigem     │
 *  │ tópico novo ou revisão do existente, NO MESMO COMMIT. Manual     │
 *  │ desatualizado é pior que manual ausente: ele ensina errado com   │
 *  │ ar de autoridade. Ver CLAUDE.md › Ao trabalhar neste projeto.    │
 *  └──────────────────────────────────────────────────────────────────┘
 *
 *  SOBRE `palavras`: são os termos que o usuário digitaria, não os que
 *  nós usamos. Quem procura "não consigo entrar" não escreve "situação
 *  pendente". A busca vive disso.
 * =====================================================================
 */

export const MANUAL_VERSAO = '1.0';

/** Onde o tópico faz sentido. Alguns valem nos dois. */
export type Publico = 'painel' | 'portal';

/**
 * Para onde levar o usuário.
 *
 * No painel a navegação é por estado, não por URL: `tela` é uma das telas
 * globais e `secao` é uma seção de dentro de uma competição aberta. Quando
 * há `secao` e nenhuma competição está aberta, a tela de ajuda leva à
 * lista de competições e explica por quê — em vez de um botão que não faz
 * nada.
 */
export interface Destino {
  painel?: { tela: string; secao?: string };
  /** Caminho do portal. `{slug}` é substituído pela competição em contexto. */
  portal?: string;
}

export interface TopicoDoManual {
  id: string;
  titulo: string;
  resumo: string;
  corpo: string[];
  palavras: string;
  onde: Publico[];
  destino?: Destino;
  acao?: string;
}

export const TOPICOS: TopicoDoManual[] = [
  // ── Acesso e contas ────────────────────────────────────────────────
  {
    id: 'entrar',
    titulo: 'Entrar no painel',
    resumo: 'Acesso do organizador por e-mail e senha.',
    corpo: [
      'O painel é a área do organizador: competições, equipes, súmula e resultados. O acesso é por e-mail e senha.',
      'Se você errou a senha, a mensagem é a mesma de e-mail inexistente. É proposital: dizer "este e-mail não existe" entregaria a quem tentasse adivinhar quais contas existem na plataforma.',
      'Não existe recuperação de senha por e-mail ainda. Perdeu a senha? O administrador do sistema precisa redefini-la.',
    ],
    palavras:
      'entrar login acesso senha email conta logar acessar painel nao consigo entrar esqueci senha',
    onde: ['painel'],
  },
  {
    id: 'conta-pendente',
    titulo: 'Criei a conta e não consigo entrar',
    resumo: 'Toda conta nova nasce pendente e depende de liberação.',
    corpo: [
      'Ao se cadastrar, a conta nasce com situação **pendente** e não autentica. Um administrador do sistema precisa liberá-la em Administração do sistema › Usuários.',
      'A exceção é a primeira conta da plataforma: ela vira administrador e já entra, senão o sistema nasceria sem ninguém para liberar ninguém.',
      'Se você é o organizador e ninguém te liberou, procure quem administra a plataforma.',
    ],
    palavras:
      'cadastrei nao entra pendente aguardando liberacao aprovacao conta nova bloqueado nao autoriza',
    onde: ['painel'],
  },
  {
    id: 'perfis',
    titulo: 'Perfis: organizador e administrador do sistema',
    resumo: 'O que cada um enxerga e pode fazer.',
    corpo: [
      'Organizador: administra apenas as próprias competições. É o perfil de quem toca uma liga, uma escola ou um evento.',
      'Administrador do sistema (superadmin): enxerga todas as contas e todas as competições da base, libera cadastros, bloqueia e promove usuários.',
      'O administrador não tem passe-livre no banco: para abrir a competição de outro organizador ele usa "assumir", que troca o contexto dele para aquela organização — e o painel mostra uma tarja âmbar enquanto isso dura.',
    ],
    palavras:
      'perfil permissao papel organizador superadmin administrador adm o que posso fazer acesso total',
    onde: ['painel'],
  },
  {
    id: 'area-adm',
    titulo: 'Administração do sistema',
    resumo: 'Liberar contas, promover usuários e ver todas as competições.',
    corpo: [
      'Visível só para o administrador do sistema, na barra superior. Três telas: indicadores da plataforma, usuários e todas as competições.',
      'Em Usuários, as solicitações pendentes aparecem no topo. Dali você libera, bloqueia, promove a administrador ou rebaixa.',
      'Duas travas que o sistema não deixa burlar: ninguém altera o próprio perfil ou a própria situação, e a plataforma nunca fica sem nenhum administrador ativo.',
    ],
    palavras:
      'administracao sistema adm usuarios liberar aprovar bloquear promover superadmin indicadores todas competicoes',
    onde: ['painel'],
    destino: { painel: { tela: 'admin:usuarios' } },
    acao: 'Ir para Usuários',
  },

  // ── Competições ────────────────────────────────────────────────────
  {
    id: 'criar-competicao',
    titulo: 'Criar uma competição',
    resumo: 'O assistente que monta a competição em poucos passos.',
    corpo: [
      'Em Meus campeonatos, use "Nova competição". O assistente pede nome, temporada, local, cores e as categorias.',
      'Cada categoria tem tipo, gênero, modalidade, formato (pontos corridos ou grupos + mata-mata) e número de equipes.',
      'A competição nasce em "Em criação", invisível ao público. É de propósito: você monta com calma e só publica quando estiver pronta.',
    ],
    palavras:
      'criar competicao novo campeonato torneio comecar nova copa liga assistente wizard cadastrar competicao',
    onde: ['painel'],
    destino: { painel: { tela: 'wizard' } },
    acao: 'Criar competição',
  },
  {
    id: 'status-visibilidade',
    titulo: 'Status da competição e o que o público vê',
    resumo: 'Em criação, publicada, em andamento e encerrada.',
    corpo: [
      'Em criação: invisível no portal. Nem o endereço direto revela que ela existe.',
      'Publicada: aparecem a tabela de jogos e a classificação — mas nenhum nome de atleta.',
      'Em andamento e Encerrada: tudo liberado, inclusive escalações e acompanhamento ao vivo.',
      'A regra que esconde os nomes antes da hora é sobre menores de idade: elenco de categoria de base não é informação para se publicar durante a montagem.',
      'O status se muda na Visão geral da competição.',
    ],
    palavras:
      'status publicar competicao visivel publico portal esconder nomes atletas em criacao andamento encerrada divulgar nao aparece no site campeonato nao aparece sumiu invisivel por que nao aparece',
    onde: ['painel', 'portal'],
    destino: { painel: { tela: 'competicao', secao: 'visao' } },
    acao: 'Ir para Visão geral',
  },
  {
    id: 'categorias',
    titulo: 'Categorias',
    resumo: 'Sub-11, Sub-13, adulto — cada uma com regras próprias.',
    corpo: [
      'Uma competição tem uma ou mais categorias, e quase tudo no sistema é por categoria: elenco, tabela, classificação, comissão técnica e configurações.',
      'Categoria com tabela já gerada não muda de estrutura (formato, número de grupos ou de equipes). A tabela ficaria incoerente e o problema só apareceria na fase seguinte.',
      'Excluir categoria exige que ela esteja vazia: a exclusão levaria junto jogos, inscrições e configuração sem aviso.',
    ],
    palavras:
      'categoria sub 11 13 15 adulto criar categoria excluir categoria nao consigo mudar formato',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'categorias' } },
    acao: 'Ir para Categorias',
  },
  {
    id: 'configuracao',
    titulo: 'Configurar uma categoria',
    resumo: 'Regras, classificação, inscrições e ficha do atleta.',
    corpo: [
      'Quatro abas. **Regras**: pontuação, cartões e suspensão automática. **Classificação e súmula**: quais colunas aparecem, critérios de desempate e quais lances a súmula aceita. **Inscrições**: limites de elenco e de comissão, e o que a equipe pode fazer sozinha. **Ficha do atleta**: quais campos são pedidos e quais são obrigatórios.',
      'A ficha do atleta manda de verdade: campo não marcado como "pedir" não é exibido na inscrição e **não é gravado**, mesmo que alguém tente enviá-lo.',
      'Salvar é explícito. Trocar de categoria no seletor descarta o que não foi salvo — o sistema avisa antes, e um selo mostra quando há alteração pendente.',
      '"Replicar para as outras" copia o que está **gravado**, não o que está na tela. Salve antes.',
    ],
    palavras:
      'configuracao configurar regras pontuacao desempate colunas ficha atleta campos obrigatorios pedir foto numero camisa limite elenco replicar',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'config' } },
    acao: 'Ir para Configurações',
  },
  // ── Equipes e atletas ──────────────────────────────────────────────
  {
    id: 'cadastrar-equipe',
    titulo: 'Cadastrar equipes',
    resumo: 'Pelo painel ou pelo link de convite.',
    corpo: [
      'Dois caminhos. Você cadastra a equipe direto em Equipes, ou manda o link de convite e a própria equipe se cadastra.',
      'Cada equipe entra em uma ou mais categorias. O limite de equipes por categoria vem da configuração dela — quando lota, o sistema recusa antes de a pessoa preencher o formulário inteiro.',
      'Equipe cadastrada pelo link recebe um código de acesso de 6 caracteres, que é como ela volta depois para montar o elenco.',
    ],
    palavras:
      'equipe time clube adicionar equipe inscrever time convidar equipe escudo uniforme cadastrar time cadastro de equipe cadastro de time nova equipe incluir equipe',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'equipes' } },
    acao: 'Ir para Equipes',
  },
  {
    id: 'link-convite',
    titulo: 'Link de convite para as equipes',
    resumo: 'A equipe se cadastra e monta o próprio elenco.',
    corpo: [
      'Em Equipes há o link da competição. Mande para os responsáveis: por ele a equipe se cadastra sozinha, escolhe as categorias e recebe um código de acesso.',
      'São duas credenciais diferentes, de propósito. O **link** só permite criar equipe — é o que você distribui. O **código de 6 caracteres** permite mexer naquela equipe específica, e nenhuma equipe alcança o elenco de outra.',
      'O link funciona mesmo com a competição em "Em criação". É o fluxo real: montar, juntar as equipes e só então publicar.',
      'Perdeu o código? Ele aparece no cadastro da equipe, no painel.',
    ],
    palavras:
      'link convite inscricao equipes mandar link codigo acesso 6 caracteres equipe se cadastra auto cadastro perdeu codigo',
    onde: ['painel', 'portal'],
    destino: {
      painel: { tela: 'competicao', secao: 'equipes' },
      portal: '/{slug}/inscricao',
    },
    acao: 'Ir para Equipes',
  },
  {
    id: 'area-da-equipe',
    titulo: 'Área da equipe (inscrição pelo link)',
    resumo: 'Onde o responsável monta elenco e comissão técnica.',
    corpo: [
      'Abrindo o link, a equipe se cadastra com nome, responsável, contato, escudo e as cores do uniforme — a cor principal é obrigatória, a secundária só se houver.',
      'Depois de criada, ela recebe o código de acesso. **Anote**: é com ele que se volta.',
      'A área abre em abas, uma por categoria em que a equipe disputa, mais a de dados cadastrais. Cada categoria tem o seu elenco, a sua comissão técnica e os seus limites.',
      'O que a equipe pode fazer sozinha — inscrever, editar, remover atleta — é você quem decide, na configuração da categoria.',
    ],
    palavras:
      'area equipe inscricao link cadastrar atleta pelo link responsavel elenco abas categoria codigo acesso escudo uniforme',
    onde: ['portal', 'painel'],
    destino: { portal: '/{slug}/inscricao' },
    acao: 'Abrir área da equipe',
  },
  {
    id: 'inscrever-atleta',
    titulo: 'Inscrever atletas',
    resumo: 'Ficha configurável, base única e limite por categoria.',
    corpo: [
      'O formulário mostra exatamente os campos que a categoria pediu na configuração. Se foto e número da camisa estão marcados, eles aparecem; se não, não.',
      'Antes de digitar, vale buscar na **base de atletas**: quem já jogou pela mesma equipe em outra competição é reaproveitado, sem redigitar a ficha.',
      'O limite de atletas por categoria vem da configuração. Ao atingi-lo, o botão de inscrever some.',
      'Um atleta pertence a **uma equipe só** dentro da competição, mesmo disputando várias categorias.',
    ],
    palavras:
      'inscrever atleta cadastrar jogador adicionar atleta novo jogador cadastro de atleta elenco ficha campos foto numero camisa limite reaproveitar incluir atleta',
    onde: ['painel', 'portal'],
    destino: {
      painel: { tela: 'competicao', secao: 'atletas' },
      portal: '/{slug}/inscricao',
    },
    acao: 'Ir para Atletas',
  },
  {
    id: 'base-atletas',
    titulo: 'Base única de atletas',
    resumo: 'O mesmo atleta reaproveitado entre competições.',
    corpo: [
      'O atleta é cadastrado uma vez e reaproveitado. Na tela Base de atletas você vê todos os que passaram pelas suas competições, com o histórico de cada um.',
      'Atleta sem CPF é identificado por nome + data de nascimento. Homônimos com a mesma data convivem através de um diferenciador.',
      'Na área da equipe, a busca alcança só quem já jogou por uma equipe de **mesmo nome** — a escolinha que se inscreve todo ano encontra o próprio elenco, e não o dos outros.',
    ],
    palavras:
      'base atletas cadastro unico reaproveitar atleta historico jogador repetido duplicado homonimo mesmo nome',
    onde: ['painel'],
    destino: { painel: { tela: 'base' } },
    acao: 'Ir para Base de atletas',
  },
  {
    id: 'faixa-etaria',
    titulo: 'Atleta fora da faixa etária',
    resumo: 'Aviso, não bloqueio.',
    corpo: [
      'Em categoria Sub-N o sistema calcula o ano esperado (temporada menos N) e avisa quando a data de nascimento não bate.',
      'É **aviso**, não impedimento: confirmando uma segunda vez, a inscrição segue. Casos legítimos existem, e o sistema não decide por você.',
      'Na lista do elenco, quem está fora da faixa aparece marcado.',
      'Ano de nascimento absurdo, esse sim é recusado: o campo de data aceita coisas como 0218 sem reclamar, e o servidor barra.',
    ],
    palavras:
      'idade faixa etaria sub ano nascimento fora da idade aviso data nascimento invalida nao aceita ano idade errada atleta idade nascido em muito velho muito novo',
    onde: ['painel', 'portal'],
  },
  {
    id: 'comissao',
    titulo: 'Comissão técnica',
    resumo: 'É por categoria, com limite próprio.',
    corpo: [
      'A comissão pertence à **categoria**, não à equipe: quem disputa Sub-13 e Sub-15 tem duas listas, cada uma com o limite daquela categoria.',
      'O cargo é lista fechada — Treinador, Comissão técnica, Diretoria, Médico(a)/Enfermeiro(a). Campo livre produzia quatro grafias do mesmo cargo na mesma súmula impressa.',
      'A comissão aparece na súmula do jogo daquela categoria.',
    ],
    palavras:
      'comissao tecnica treinador tecnico da equipe tecnico do time cargo diretoria medico enfermeiro limite membros por categoria staff',
    onde: ['painel', 'portal'],
    destino: { portal: '/{slug}/inscricao' },
  },
  {
    id: 'carteirinha',
    titulo: 'Carteirinha do atleta',
    resumo: 'Credencial com QR para a arbitragem conferir.',
    corpo: [
      'Cada atleta inscrito tem uma carteirinha com QR Code. A arbitragem escaneia e a página pública confirma se aquela pessoa pode jogar.',
      'A página **não mostra documento**. A arbitragem precisa saber quem é e se está apto — e é uma página pública, com dado de menor de idade.',
      'A validação mostra nome, foto, equipe, categoria e se há suspensão em curso.',
    ],
    palavras:
      'carteirinha credencial qr code identificacao atleta arbitro conferir apto jogar validacao',
    onde: ['painel', 'portal'],
    destino: { painel: { tela: 'competicao', secao: 'atletas' } },
    acao: 'Ir para Atletas',
  },

  // ── Tabela e jogos ─────────────────────────────────────────────────
  {
    id: 'gerar-tabela',
    titulo: 'Gerar a tabela de jogos',
    resumo: 'O sistema monta os confrontos da categoria.',
    corpo: [
      'Com as equipes inscritas, gere a tabela em Tabela de jogos. O sistema monta o turno (e o returno, se configurado) e distribui as rodadas.',
      'Em formato com grupos, as equipes são distribuídas e o mata-mata vem depois, conforme as fases definidas.',
      'A ordem das fases decide o chaveamento: é por ela que o vencedor sabe para onde subir.',
      'Os jogos do mata-mata nascem com o rótulo da vaga. Quem os preenche é "Definir classificados", depois que a fase de grupos acabar.',
      'Encolher um mata-mata corta só jogo ainda não disputado. Remover fase que já tem resultado exige confirmação explícita.',
    ],
    palavras:
      'gerar tabela jogos confrontos rodadas turno returno chaveamento fases mata mata grupos sortear',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'tabela' } },
    acao: 'Ir para Tabela de jogos',
  },
  {
    id: 'programar-jogo',
    titulo: 'Programar data, campo e árbitro',
    resumo: 'Cada jogo ganha horário e local.',
    corpo: [
      'Na tabela, cada jogo abre para receber data, hora, campo e arbitragem.',
      'O que você programar aqui aparece no portal, embaixo de cada jogo: data, hora e campo. Jogo sem nada marcado mostra "Data e local a definir".',
      'Campos e árbitros são cadastrados em Campos e árbitros, e só podem ser escalados se pertencerem à mesma competição.',
      'Campo ou árbitro em uso não é excluído: apagá-lo esvaziaria o local de jogos já programados sem aviso.',
    ],
    palavras:
      'programar jogo data hora campo local arbitro escalar agendar partida horario onde vai ser aparece no portal',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'tabela' } },
    acao: 'Ir para Tabela de jogos',
  },
  {
    id: 'coluna-extra',
    titulo: 'Ajuste manual na classificação (coluna extra)',
    resumo: 'O desempate de última instância, na sua mão.',
    corpo: [
      'A coluna extra é um valor que você lança por equipe: positivo sobe, negativo desce. Serve para confronto direto, bônus de fair play, punição por W.O. ou pontuação herdada de uma fase anterior.',
      'Ative a coluna em Configurações › Classificação e súmula e coloque-a entre os critérios de desempate — sem isso ela aparece na tabela mas não desempata nada.',
      'Depois, em Classificação, use o botão de ajuste e informe o valor de cada equipe. A tabela reordena na hora.',
      'É por aqui que se resolve a vaga do mata-mata quando duas equipes empatam em todos os critérios.',
      'Você pode dar um nome próprio à coluna na configuração da categoria — "Confronto direto" diz mais ao torcedor do que "Coluna extra".',
    ],
    palavras:
      'coluna extra ajuste manual desempate confronto direto bonus punicao wo penalizacao pontos a mais tirar ponto criterio',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'classificacao' } },
    acao: 'Ir para Classificação',
  },
  {
    id: 'classificados-mata-mata',
    titulo: 'Levar os classificados para o mata-mata',
    resumo: 'Quem sai dos grupos para a semifinal, e quem sobe depois.',
    corpo: [
      'Enquanto a fase de grupos corre, os jogos do mata-mata aparecem com o rótulo da vaga: "1º Grupo A", "2º Grupo B".',
      'Encerrado o último jogo dos grupos, use "Definir classificados" na Tabela de jogos. Cada vaga recebe a equipe que está naquela posição da classificação — na mesma ordem que a tela mostra, com os critérios de desempate que você configurou.',
      'Da semifinal em diante é automático: encerrar um jogo de mata-mata sobe o vencedor para a fase seguinte sozinho. Reabrir o jogo esvazia a vaga que ele havia preenchido.',
      'Se duas equipes empatarem em todos os critérios na posição que decide a vaga, o sistema não escolhe: mostra as duas e espera. Desempate pelo regulamento em Classificação, no botão de ajuste da coluna extra — é onde entra o confronto direto —, e clique de novo.',
      'Com jogo de grupo ainda em aberto o sistema recusa: classificação parcial daria vaga a quem ainda pode perder o lugar na última rodada.',
      'Jogo eliminatório que já começou não é alterado — trocar a equipe deixaria a súmula falando de quem não entrou em campo.',
    ],
    palavras:
      'classificados semifinal mata mata definir vaga quem passa avanca avancar subir fase seguinte grupo primeiro colocado chaveamento cruzamento eliminatoria quartas oitavas final',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'tabela' } },
    acao: 'Ir para Tabela de jogos',
  },
  {
    id: 'sumula-impressa',
    titulo: 'Súmula impressa',
    resumo: 'A folha em branco para a arbitragem preencher em campo.',
    corpo: [
      'A súmula sai com as duas equipes, o elenco inscrito de cada uma na categoria e a comissão técnica — em branco, para a arbitragem marcar quem entrou.',
      'Ela usa o elenco inscrito, não a escalação: é impressa antes do jogo.',
      'Jogo de mata-mata sem equipe definida sai com as linhas vazias e o rótulo da vaga ("Vencedor da semifinal 1").',
    ],
    palavras:
      'sumula impressa imprimir folha jogo papel arbitragem preencher em campo modelo',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'tabela' } },
  },

  // ── Ao vivo ────────────────────────────────────────────────────────
  {
    id: 'central-ao-vivo',
    titulo: 'Central ao vivo',
    resumo: 'Onde o jogo é operado em tempo real.',
    corpo: [
      'Inicie o jogo, controle os períodos e lance os acontecimentos conforme eles ocorrem. O portal acompanha em tempo real.',
      'O placar **não se digita**: ele é calculado a partir dos lances. Gol e gol de pênalti contam; gol contra inverte o lado.',
      'Escanteio é o único lance sem atleta. Assistência nunca é do próprio autor do gol e é lançada junto com ele.',
    ],
    palavras:
      'ao vivo tempo real operar jogo iniciar cronometro periodo lance gol placar marcar gol sumula online',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'aovivo' } },
    acao: 'Ir para Central ao vivo',
  },
  {
    id: 'corrigir-lance',
    titulo: 'Errei um lance, como corrijo?',
    resumo: 'Dá para trocar atleta e equipe, mas não o tempo.',
    corpo: [
      'Na cronologia do jogo, cada lance pode ser editado ou removido.',
      'Minuto e período são **imutáveis** depois do registro. Trocar o tempo depois reescreveria a história do jogo; se o momento está errado, remova o lance e lance de novo.',
      'Corrigir ou apagar um cartão desfaz a suspensão que ele originou.',
      'Reabrir um jogo de mata-mata esvazia a vaga que o vencedor havia preenchido.',
    ],
    palavras:
      'corrigir lance errado editar gol apagar cartao remover evento desfazer errei minuto tempo',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'aovivo' } },
  },

  // ── Resultados ─────────────────────────────────────────────────────
  {
    id: 'classificacao',
    titulo: 'Classificação',
    resumo: 'Como a tabela é montada e desempatada.',
    corpo: [
      'Conta só a fase de grupos e apenas jogo encerrado — inclusive para os cartões.',
      'Toda equipe inscrita aparece, mesmo sem ter jogado ainda, zerada.',
      'Os critérios de desempate são configuráveis, e há uma regra que pega desprevenido: **esconder uma coluna também a remove dos critérios**. Não dá para desempatar por algo que a tabela não mostra.',
    ],
    palavras:
      'classificacao tabela pontos desempate criterio desempatar quem ganhou empate saldo gols posicao lider ordem colunas',
    onde: ['painel', 'portal'],
    destino: { painel: { tela: 'competicao', secao: 'classificacao' } },
    acao: 'Ir para Classificação',
  },
  {
    id: 'estatisticas',
    titulo: 'Estatísticas e premiações',
    resumo: 'Artilharia, assistências e os prêmios da competição.',
    corpo: [
      'Artilharia, assistências e demais números saem dos lances registrados na súmula.',
      'São quatro listas em abas próprias, no painel e no portal: Artilharia, Assistências, Goleiros e Disciplina — uma por vez, começando pela artilharia.',
      'No portal, cada lista é um endereço próprio: o link que você copiar já abre na que estava vendo. Trocar de categoria mantém a lista; trocar de aba volta para a artilharia.',
      'No painel, a lista escolhida também se mantém ao trocar de categoria ou ao alternar para o ranking geral da plataforma.',
      'Nas premiações, empate volta como **empate**: a lista mostra todos os empatados e avisa, em vez de escolher um sozinho.',
      'Equipe que ainda não jogou não concorre a "melhor defesa" nem a "fair play" — zero jogos não é o mesmo que zero gols sofridos.',
    ],
    palavras:
      'estatisticas artilharia artilheiro assistencia premiacao melhor defesa fair play craque numeros goleiros defesas disciplina cartoes ranking',
    onde: ['painel', 'portal'],
    destino: { painel: { tela: 'competicao', secao: 'estatisticas' } },
    acao: 'Ir para Estatísticas',
  },
  {
    id: 'suspensoes',
    titulo: 'Suspensões por cartão',
    resumo: 'Geradas, cumpridas e controladas pelo sistema.',
    corpo: [
      'Ligue "Habilitar suspensões automáticas" em Configurações › Regras. Sem isso os cartões são apenas registrados e ninguém é suspenso.',
      'Com a regra ligada, o cartão gera a punição conforme o número de amarelos e os jogos por cartão que você configurou.',
      'A suspensão vale a partir do jogo SEGUINTE. Quem foi expulso continua na súmula da partida em que levou o vermelho — ele estava em campo.',
      'Cada jogo que a equipe disputa sem o atleta desconta uma partida. Atleta suspenso não pode ser escalado.',
      'Ligar a regra depois não é retroativo: cartões dados enquanto ela estava desligada não geram suspensão. Se precisar, use a suspensão manual.',
      'Corrigir ou apagar o cartão desfaz a suspensão que ele originou.',
      'A tela de Suspensões mostra quem está cumprindo e quanto falta.',
    ],
    palavras:
      'suspensao suspenso cartao amarelo vermelho expulso expulsao punicao gancho cumprir nao pode jogar automatica habilitar ligar regra terceiro amarelo',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'suspensoes' } },
    acao: 'Ir para Suspensões',
  },

  // ── Portal público ─────────────────────────────────────────────────
  {
    id: 'portal-publico',
    titulo: 'O portal da competição',
    resumo: 'A página pública que torcida e equipes acompanham.',
    corpo: [
      'Cada competição tem endereço próprio no portal, com abas de jogos, classificação, estatísticas e elencos.',
      'O que aparece depende do status: antes de publicar, nada; publicada, tabela e classificação sem nomes de atleta; em andamento, tudo.',
      'Jogo em andamento mostra o placar ao vivo, atualizando sozinho.',
    ],
    palavras:
      'portal publico site pagina competicao divulgar torcida acompanhar jogos link publico',
    onde: ['portal', 'painel'],
    destino: { portal: '/{slug}' },
    acao: 'Abrir o portal',
  },
  {
    id: 'dominio-proprio',
    titulo: 'Domínio próprio da competição',
    resumo: 'Usar o endereço da sua liga em vez do padrão.',
    corpo: [
      'A competição pode responder num domínio seu, além do endereço padrão da plataforma.',
      'Exige apontar o domínio para o portal e registrá-lo na configuração da competição. Fale com quem administra a hospedagem.',
    ],
    palavras:
      'dominio proprio url personalizada endereco site meu dominio white label marca',
    onde: ['painel'],
    destino: { painel: { tela: 'competicao', secao: 'visao' } },
  },

  // ── Operação ───────────────────────────────────────────────────────
  {
    id: 'exportar',
    titulo: 'Exportar dados para planilha',
    resumo: 'CSV que abre certo no Excel em português.',
    corpo: [
      'Classificação, elencos e estatísticas podem ser exportados.',
      'O arquivo sai preparado para o Excel em português: separador ponto-e-vírgula e acentuação correta.',
      'Célula que começa com sinal de igual, mais, menos ou arroba sai protegida — senão o Excel a interpretaria como fórmula.',
    ],
    palavras:
      'exportar csv excel planilha baixar dados relatorio salvar tabela abrir excel',
    onde: ['painel'],
  },
  {
    id: 'imagens',
    titulo: 'Escudos, fotos e logos',
    resumo: 'O que o sistema aceita e onde as imagens aparecem.',
    corpo: [
      'São aceitos PNG, JPEG e WebP, até 2 MB. O tipo é conferido pelos bytes do arquivo, não pela extensão — arquivo renomeado não passa.',
      'Escudo da equipe aparece na tabela de jogos, na classificação, no portal e no cadastro de atletas.',
      'Sem escudo, a equipe aparece com as iniciais sobre uma cor fixa, derivada do nome.',
    ],
    palavras:
      'escudo logo foto imagem upload enviar png jpg tamanho maximo nao aceita imagem brasao',
    onde: ['painel', 'portal'],
  },
];
