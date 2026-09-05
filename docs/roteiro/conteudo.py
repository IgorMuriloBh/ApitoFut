# -*- coding: utf-8 -*-
"""Conteúdo do roteiro de teste do ApitoFut."""

INTRO = [
    ("O que é este documento",
     "Um roteiro para percorrer o ApitoFut de ponta a ponta, do cadastro da conta "
     "ao encerramento da competição. Cada passo diz <b>o que fazer</b> e <b>o que "
     "esperar</b>. Onde o resultado for diferente do descrito, anote — é justamente "
     "isso que o teste procura."),
    ("Como usar",
     "Siga na ordem. As etapas dependem umas das outras: não dá para lançar um gol "
     "sem antes ter jogo, equipe e atleta. Marque o quadradinho de cada passo que "
     "se comportou como esperado."),
    ("Quanto tempo leva",
     "Cerca de 2 horas fazendo com calma. Dá para parar e retomar: nada se perde "
     "entre sessões."),
    ("O que anotar quando algo der errado",
     "Três coisas, nesta ordem: (1) em que passo você estava; (2) o que você fez, "
     "exatamente; (3) o que apareceu na tela, de preferência com print. "
     "\"Não funcionou\" não é reportável; \"no passo 7.3, cliquei em Gerar tabela e "
     "apareceu erro 500\" é."),
]

ENDERECOS = [
    ("Painel do organizador", "apitofutpainel-production.up.railway.app",
     "Onde você administra tudo. Exige login."),
    ("Portal público", "apitofutportal-production.up.railway.app",
     "O que a torcida e as equipes veem. Não exige login."),
]

AVISOS = [
    "Este é um ambiente de <b>testes</b>. Pode errar à vontade — nada aqui é oficial.",
    "Os dados que você criar ficam salvos. Use nomes que deixem claro que são teste "
    "(ex.: “Copa Teste João”), para não confundir com competição de verdade.",
    "Em qualquer tela do painel há o menu <b>Ajuda</b>. Se travar, escreva a dúvida "
    "lá antes de me perguntar — parte do teste é justamente descobrir se a ajuda "
    "responde.",
]

ETAPAS = [
    {
        "n": 1,
        "titulo": "Criar sua conta",
        "objetivo": "Verificar que conta nova nasce bloqueada e depende de liberação.",
        "passos": [
            ("Abra o painel e clique em <b>“Primeiro campeonato? Criar conta”</b>.",
             "Aparece um formulário pedindo nome, e-mail, organização e senha."),
            ("Preencha com dados de teste. Use uma senha de pelo menos 8 caracteres.",
             "Senha com menos de 8 caracteres deve ser recusada, com mensagem clara."),
            ("Envie o cadastro.",
             "Mensagem dizendo que o cadastro foi enviado e aguarda liberação do "
             "administrador. <b>Você NÃO entra no sistema.</b> Isso é o correto."),
            ("Tente entrar com esse e-mail e senha.",
             "O acesso é recusado. A conta ainda está pendente."),
            ("Peça ao administrador para liberar sua conta.",
             "Ele entra em Administração do sistema › Usuários, encontra você no "
             "topo da lista e clica em “Liberar acesso”."),
            ("Entre novamente.",
             "Agora entra e cai no Painel do Organizador, com os contadores zerados."),
        ],
        "observar": "Repare que a mensagem de senha errada é igual à de e-mail "
                    "inexistente. É proposital: evita que alguém descubra quais "
                    "contas existem testando e-mails.",
    },
    {
        "n": 2,
        "titulo": "Criar o campeonato",
        "objetivo": "Criar a competição e suas categorias pelo assistente.",
        "passos": [
            ("No Painel do Organizador, clique em <b>“+ Criar novo campeonato”</b>.",
             "Abre o assistente, pedindo os dados da competição."),
            ("Preencha nome, temporada, cidade/estado e datas de início e fim.",
             "A cidade vem de uma lista (não é campo livre). Digitar parte do nome "
             "filtra os municípios."),
            ("Escolha uma cor para a competição.",
             "Ela é a cor do portal público depois."),
            ("Crie <b>duas categorias</b>. Sugestão: uma “Sub-13” com formato de "
             "grupos + mata-mata e 8 equipes; outra “Sub-15” com 4 equipes.",
             "Cada categoria pede tipo, gênero, modalidade, formato e número de "
             "equipes."),
            ("Conclua.",
             "Volta ao painel com o campeonato listado, marcado como "
             "<b>“Em criação”</b>."),
        ],
        "observar": "Use “Sub-13” e “Sub-15” com esse formato de nome. O sistema "
                    "reconhece o padrão “Sub-N” e passa a conferir a idade dos "
                    "atletas mais adiante no roteiro.",
    },
    {
        "n": 3,
        "titulo": "Conferir que o campeonato ainda é invisível",
        "objetivo": "Validar a regra de visibilidade antes de publicar.",
        "passos": [
            ("Abra o campeonato e vá em <b>Visão geral</b>. Anote o endereço público "
             "que aparece ali (algo como <i>/copa-teste-joao</i>).",
             "A tela avisa que “o portal só abre depois de publicar”."),
            ("Abra esse endereço no portal, numa aba anônima.",
             "<b>Página não encontrada.</b> Isso é o correto: enquanto está “Em "
             "criação”, o sistema não confirma nem que a competição existe."),
        ],
        "observar": "Essa regra existe porque a maioria das categorias tem menores "
                    "de idade. Nome de atleta não pode aparecer antes da hora.",
    },
    {
        "n": 4,
        "titulo": "Configurar uma categoria",
        "objetivo": "Ver como a configuração muda o que o sistema pede adiante.",
        "passos": [
            ("Dentro do campeonato, vá em <b>Configurações</b> e escolha a Sub-13.",
             "Quatro abas: Regras, Classificação e súmula, Inscrições e Ficha do atleta."),
            ("Na aba <b>Regras</b>, ligue a suspensão automática. Deixe 3 amarelos = "
             "1 jogo de suspensão.",
             "Os campos aceitam a alteração."),
            ("Na aba <b>Ficha do atleta</b>, marque <b>Pedir</b> para Foto, Número da "
             "camisa e Data de nascimento. Marque <b>Obrigatório</b> só para a data.",
             "O “obrigatório” só fica disponível se “pedir” estiver marcado."),
            ("Na aba <b>Inscrições</b>, coloque limite de 12 atletas e 3 membros de "
             "comissão. Deixe ligado “permite inscrever”.",
             "Aceita os valores."),
            ("Clique em <b>Salvar configuração</b>.",
             "Confirmação de que salvou. <b>Antes de salvar</b>, um selo âmbar "
             "“alterações não salvas” fica visível ao lado do botão."),
            ("Agora teste a proteção: mude alguma coisa e, <b>sem salvar</b>, troque "
             "de categoria no seletor do topo.",
             "O sistema pergunta se você quer descartar as alterações. Cancele."),
            ("Salve e clique em <b>“Replicar para as outras”</b>.",
             "A configuração é copiada para a Sub-15. Se houver alteração não salva, "
             "o sistema recusa e pede para salvar antes."),
        ],
        "observar": "O que você marcou na Ficha do atleta define exatamente quais "
                    "campos vão aparecer no cadastro de atleta. Guarde isso — vamos "
                    "conferir na etapa 6.",
    },
    {
        "n": 5,
        "titulo": "Cadastrar equipes",
        "objetivo": "Os dois caminhos: pelo painel e pelo link de convite.",
        "passos": [
            ("Vá em <b>Equipes</b> e cadastre uma equipe manualmente. Dê um escudo "
             "(qualquer imagem PNG ou JPG até 2 MB) e escolha as duas categorias.",
             "A equipe aparece na lista com o escudo. Sem escudo, ela apareceria com "
             "as iniciais sobre uma cor."),
            ("Tente enviar um arquivo que não seja imagem, renomeado para .png.",
             "É recusado. O sistema confere os bytes do arquivo, não a extensão."),
            ("Na mesma tela, copie o <b>link de convite</b> da competição.",
             "É um endereço terminado em <i>/inscricao</i>."),
            ("Abra o link numa aba anônima (simulando o responsável pela equipe).",
             "Abre a área de inscrição, mesmo com a competição “Em criação” — este "
             "fluxo funciona antes de publicar, de propósito."),
            ("Cadastre uma segunda equipe por ali: nome, responsável, telefone, "
             "escudo, cor do uniforme e as categorias.",
             "A <b>cor do uniforme principal é obrigatória</b>; a secundária só se "
             "houver. Ao concluir, aparece um <b>código de 6 caracteres</b>."),
            ("<b>Anote esse código.</b> Feche a aba e abra o link de novo.",
             "Com o código, você volta para a área daquela equipe. Sem ele, não."),
            ("Tente entrar com um código inventado.",
             "Recusado."),
        ],
        "observar": "São duas credenciais diferentes: o <b>link</b> só permite criar "
                    "equipe (é o que se distribui); o <b>código</b> permite mexer "
                    "naquela equipe específica. Nenhuma equipe alcança o elenco de outra.",
    },
    {
        "n": 6,
        "titulo": "Cadastrar atletas",
        "objetivo": "Ficha configurável, limite de elenco e aviso de idade.",
        "passos": [
            ("Na área da equipe (aba da Sub-13), clique em <b>Inscrever atleta</b>.",
             "O formulário mostra <b>exatamente os campos que você marcou na etapa "
             "4</b>: nome, foto, data de nascimento e nº da camisa. Não mostra CPF, "
             "RG nem os outros."),
            ("Tente salvar sem a data de nascimento.",
             "Recusado, dizendo qual campo falta — era o que você marcou como "
             "obrigatório."),
            ("Preencha com uma data de nascimento <b>de 2012</b> (fora da faixa da "
             "Sub-13) e salve.",
             "Aparece um <b>aviso</b> dizendo o ano esperado. O botão muda para "
             "“Inscrever mesmo assim”. Confirmando, a inscrição passa. É aviso, "
             "não bloqueio."),
            ("Tente uma data com ano inválido, como <b>0218</b>.",
             "<b>Recusado.</b> Ano fora da faixa 1900–ano atual não passa."),
            ("Cadastre mais 5 ou 6 atletas com datas corretas para a categoria.",
             "Aparecem na lista com número e nome. Quem está fora da faixa fica marcado."),
            ("Na aba <b>Comissão técnica</b> da mesma categoria, adicione um Treinador.",
             "O cargo é uma <b>lista fechada</b>: Treinador, Comissão técnica, "
             "Diretoria, Médico(a)/Enfermeiro(a). Não é campo livre."),
            ("Troque para a aba da <b>Sub-15</b>.",
             "Elenco e comissão são <b>outros</b>, independentes. Cada categoria tem "
             "os seus e o seu limite."),
            ("Volte ao painel, vá em <b>Atletas</b> e escolha a Sub-13.",
             "Os atletas cadastrados pela equipe aparecem aqui."),
            ("Cadastre um atleta pelo painel usando a <b>busca na base</b>: digite "
             "parte do nome de um atleta já cadastrado.",
             "Ele é encontrado e reaproveitado — o sistema não cria um segundo cadastro."),
        ],
        "observar": "Se você tentar inscrever o mesmo atleta em duas equipes "
                    "diferentes da mesma competição, o sistema recusa e diz por qual "
                    "equipe ele já está inscrito.",
    },
    {
        "n": 7,
        "titulo": "Gerar a tabela de jogos",
        "objetivo": "Montar os confrontos e programar as partidas.",
        "passos": [
            ("Antes, complete as equipes: a Sub-13 precisa das 8 que você definiu no "
             "assistente (ou reduza o número de equipes da categoria enquanto ainda "
             "não há tabela).",
             "Enquanto faltar equipe, o sistema avisa."),
            ("Vá em <b>Tabela de jogos</b>, escolha a Sub-13 e clique em "
             "<b>Gerar tabela</b>.",
             "Abre um diálogo com duas opções: <b>Com programação</b> (o sistema "
             "distribui datas e horários sozinho, a partir da data que você informar) "
             "e <b>Somente confrontos</b> (você programa depois, jogo a jogo)."),
            ("Escolha uma das duas e confirme.",
             "Os confrontos da fase de grupos aparecem organizados por rodada — e os "
             "jogos do mata-mata aparecem com o <b>rótulo da vaga</b> (“1º Grupo A”, "
             "“Vencedor Semifinal 1”), ainda sem equipe."),
            ("Tente <b>mudar o formato ou o número de equipes</b> da categoria agora, "
             "em Categorias.",
             "<b>Recusado</b>, porque a tabela já existe. Mudar deixaria a tabela "
             "incoerente."),
            ("Vá em <b>Campos e árbitros</b> e cadastre um campo e um árbitro.",
             "Ficam disponíveis para escalar."),
            ("Volte à tabela e programe um jogo: data, hora, campo e árbitro. "
             "Se você gerou <i>com programação</i>, os jogos já vêm com data e hora — "
             "aproveite para <b>trocar</b> a de um deles.",
             "O jogo passa a mostrar o local e o horário."),
            ("Tente excluir o campo que acabou de escalar.",
             "<b>Recusado</b>: campo em uso não é excluído, para não esvaziar o local "
             "de jogos já programados."),
            ("Imprima a súmula de um jogo.",
             "Sai o elenco inscrito das duas equipes e a comissão técnica, em branco, "
             "para a arbitragem preencher em campo."),
        ],
    },
    {
        "n": 8,
        "titulo": "Publicar e conferir o portal",
        "objetivo": "Ver a diferença entre “publicada” e “em andamento”.",
        "passos": [
            ("Em <b>Visão geral</b>, mude o status para <b>Publicada</b>.",
             "Confirmação da mudança."),
            ("Abra o endereço público numa aba anônima.",
             "Agora a competição aparece: tabela de jogos e classificação. "
             "<b>Nenhum nome de atleta em lugar nenhum.</b>"),
            ("Procure as escalações e a lista de atletas no portal.",
             "Não estão disponíveis. É o correto neste status."),
            ("Volte ao painel e mude o status para <b>Em andamento</b>.",
             "Confirmação."),
            ("Recarregue o portal.",
             "Agora aparecem as escalações e os elencos."),
        ],
        "observar": "Essa é a regra mais sensível do sistema. Se você conseguir ver "
                    "nome de atleta com a competição apenas “Publicada”, isso é um "
                    "defeito grave — reporte imediatamente.",
    },
    {
        "n": 9,
        "titulo": "Operar um jogo ao vivo",
        "objetivo": "Lançar os acontecimentos e ver o placar se formar.",
        "passos": [
            ("Vá em <b>Central ao vivo</b> e escolha um jogo da Sub-13.",
             "Abre a tela de operação, com as duas equipes e seus elencos."),
            ("Inicie o jogo.",
             "O cronômetro começa a correr e o jogo passa a “ao vivo”."),
            ("Lance um <b>gol</b> para a equipe mandante, escolhendo o autor.",
             "O placar muda para 1 a 0 <b>sozinho</b>. Você não digita o placar em "
             "lugar nenhum — ele é calculado a partir dos lances."),
            ("Lance um gol com <b>assistência</b>.",
             "A assistência é escolhida junto com o gol, e o sistema não deixa "
             "escolher o próprio autor do gol como assistente."),
            ("Lance um <b>gol contra</b>.",
             "O ponto vai para o lado <b>adversário</b>."),
            ("Lance um <b>escanteio</b>.",
             "É o único lance que não pede atleta."),
            ("Lance um <b>cartão amarelo</b> para um atleta.",
             "Aparece na cronologia."),
            ("Lance um <b>cartão vermelho</b> para outro atleta.",
             "Aparece na cronologia, e o expulso <b>continua</b> na súmula desta "
             "partida — ele estava em campo, foi por isso que foi expulso. A punição "
             "vale a partir do próximo jogo."),
            ("Abra o portal público numa outra aba, no jogo em questão.",
             "O placar aparece atualizado, <b>sem precisar recarregar a página</b>."),
            ("Encerre o jogo.",
             "O placar final é registrado e o jogo sai de “ao vivo”."),
        ],
    },
    {
        "n": 10,
        "titulo": "Corrigir um erro de lançamento",
        "objetivo": "Ver o que pode e o que não pode ser corrigido.",
        "passos": [
            ("Na cronologia do jogo, edite um gol e troque o autor.",
             "Aceita a troca."),
            ("Tente alterar o <b>minuto</b> do lance.",
             "<b>Não é permitido.</b> Minuto e período são imutáveis depois do "
             "registro — se o momento está errado, apague o lance e lance de novo."),
            ("Apague um gol.",
             "O placar <b>volta</b> ao valor anterior, sozinho."),
            ("Apague o cartão amarelo que você lançou.",
             "Se ele tivesse gerado suspensão, ela é desfeita junto."),
        ],
    },
    {
        "n": 11,
        "titulo": "Classificação e suspensões",
        "objetivo": "Conferir os cálculos e as travas de configuração.",
        "passos": [
            ("Encerre mais 2 ou 3 jogos com placares diferentes.",
             "Cada um vai alimentando a classificação."),
            ("Abra <b>Classificação</b> na Sub-13.",
             "As equipes aparecem ordenadas. <b>Todas as inscritas aparecem</b>, "
             "inclusive as que ainda não jogaram, zeradas."),
            ("Vá em Configurações › Classificação e súmula e <b>esconda a coluna "
             "“saldo de gols”</b>. Salve e volte à classificação.",
             "A coluna some — <b>e também sai dos critérios de desempate</b>. Não dá "
             "para desempatar por algo que a tabela não mostra."),
            ("Vá em Configurações › Regras e marque <b>Habilitar suspensões "
             "automáticas</b>. Confira o número de amarelos que suspende (o padrão "
             "é 3). Salve.",
             "A regra nasce <b>desligada</b>: sem este passo, os cartões são apenas "
             "registrados e ninguém é suspenso."),
            ("Lance cartões, em jogos diferentes, até um atleta atingir o limite "
             "configurado.",
             "A suspensão é gerada automaticamente <b>no momento do cartão</b>."),
            ("Abra <b>Suspensões</b>.",
             "O atleta aparece cumprindo, com o número de jogos restantes."),
            ("Tente lançar um gol para esse atleta no próximo jogo.",
             "<b>Recusado</b>, com a mensagem dizendo quantos jogos faltam. Atleta "
             "suspenso não entra em campo."),
        ],
        "observar": "Ligar a regra <b>depois</b> dos cartões não é retroativo: o "
                    "sistema só recalcula no cartão seguinte. Se precisar punir um "
                    "caso antigo, use a suspensão manual na tela de Suspensões.",
    },
    {
        "n": 12,
        "titulo": "Fases finais",
        "objetivo": "Levar os classificados ao mata-mata e ver o vencedor avançar "
                    "sozinho.",
        "passos": [
            ("Com <b>algum jogo de grupo ainda em aberto</b>, vá à Tabela de jogos e "
             "clique em <b>Definir classificados</b>.",
             "<b>Recusado</b>, dizendo quantos jogos faltam. Classificação parcial "
             "daria vaga a quem ainda pode perder o lugar na última rodada."),
            ("Agora encerre todos os jogos da fase de grupos da Sub-13.",
             "A classificação fica completa."),
            ("Abra a configuração de fases na Tabela de jogos.",
             "Aparecem as fases do mata-mata (semifinal, final, conforme o que você "
             "definiu), com quantos jogos cada uma tem."),
            ("Confira os jogos da fase seguinte.",
             "Estão com o rótulo da vaga (“1º Grupo A”, “Vencedor Semifinal 1”), "
             "ainda sem equipe."),
            ("Clique em <b>Definir classificados</b>.",
             "As vagas da <b>primeira</b> fase eliminatória recebem as equipes que "
             "estão naquelas posições da classificação, e o sistema lista quem foi "
             "para onde. As vagas de “Vencedor…” continuam vazias: elas são "
             "preenchidas sozinhas quando o jogo anterior terminar."),
            ("Opere e encerre uma semifinal.",
             "O <b>vencedor sobe sozinho</b> para a final. Você não precisa "
             "arrastá-lo até lá."),
            ("Reabra esse jogo de semifinal.",
             "A vaga que o vencedor tinha preenchido <b>é esvaziada</b>."),
            ("Encerre novamente e dispute a final.",
             "O campeão fica definido."),
        ],
        "observar": "Se duas equipes empatarem em todos os critérios na posição que "
                    "decide a vaga, o sistema <b>não escolhe</b>: mostra as duas e "
                    "espera. O desempate é seu, em Classificação → “Ajustar Coluna "
                    "Extra” (é onde entra o confronto direto). Para a coluna valer, "
                    "ela precisa estar visível e entre os critérios, em Configurações. "
                    "Depois é só clicar em Definir classificados de novo.",
    },
    {
        "n": 13,
        "titulo": "Estatísticas, premiações e exportação",
        "objetivo": "Conferir os números e levar os dados para planilha.",
        "passos": [
            ("Abra <b>Estatísticas</b> na Sub-13.",
             "Artilharia e assistências, montadas a partir dos lances que você "
             "registrou. Confira se batem com o que você lançou."),
            ("Procure as premiações.",
             "Se houver empate em algum prêmio, o sistema mostra <b>todos os "
             "empatados</b> e avisa, em vez de escolher um sozinho."),
            ("Confira “melhor defesa” e “fair play”.",
             "Equipe que ainda não jogou <b>não concorre</b> — zero jogos não é o "
             "mesmo que zero gols sofridos."),
            ("Exporte a classificação para CSV e abra no Excel.",
             "As colunas ficam separadas corretamente e a acentuação aparece certa "
             "(o arquivo é preparado para o Excel em português)."),
            ("No arquivo, confira a coluna <b>Pos.</b> e a ordem das equipes.",
             "A numeração <b>recomeça em cada grupo</b> e a ordem é a mesma da tela, "
             "com os critérios de desempate que você configurou. Se o líder do "
             "Grupo B aparecer como “5º”, é defeito."),
        ],
    },
    {
        "n": 14,
        "titulo": "Carteirinha do atleta",
        "objetivo": "Ver a credencial que a arbitragem usa.",
        "passos": [
            ("Em <b>Atletas</b>, abra a carteirinha de um atleta inscrito.",
             "Aparece a credencial com QR Code."),
            ("Aponte a câmera do celular para o QR (ou abra o endereço).",
             "Abre uma página pública com nome, foto, equipe, categoria e se o atleta "
             "está apto a jogar."),
            ("Procure o CPF ou documento nessa página.",
             "<b>Não aparece.</b> É proposital: a página é pública e traz dado de "
             "menor de idade. A arbitragem precisa saber quem é e se pode jogar — "
             "não o documento."),
            ("Se o atleta estiver suspenso, confira a carteirinha dele.",
             "A situação de suspensão aparece."),
        ],
    },
    {
        "n": 15,
        "titulo": "Encerrar a competição",
        "objetivo": "Fechar o ciclo.",
        "passos": [
            ("Com todos os jogos encerrados, mude o status para <b>Encerrada</b> na "
             "Visão geral.",
             "Confirmação."),
            ("Abra o portal público.",
             "Tudo continua visível: tabela final, classificação, estatísticas e "
             "elencos."),
            ("Tente cadastrar uma equipe nova pelo link de convite.",
             "<b>Recusado</b>: competição encerrada não recebe inscrição."),
        ],
    },
    {
        "n": 16,
        "titulo": "A ajuda do sistema",
        "objetivo": "Testar se o manual responde de verdade.",
        "passos": [
            ("No menu, abra <b>Ajuda</b> e escreva uma dúvida com suas palavras — por "
             "exemplo “como mando o link para as equipes”.",
             "Aparece o tópico certo, com a explicação e um botão que leva à tela."),
            ("Clique no botão.",
             "Você é levado direto para a tela correspondente."),
            ("Faça o mesmo estando <b>dentro</b> de uma competição.",
             "O botão salta direto para a seção, sem sair da competição."),
            ("Teste com dúvidas suas, escritas do seu jeito.",
             "<b>Anote as perguntas que o manual NÃO respondeu bem.</b> Isso é o "
             "resultado mais valioso deste passo."),
            ("Abra a ajuda do portal público (endereço /ajuda).",
             "Mostra os tópicos que interessam a quem se inscreve, não os de operação."),
        ],
    },
]

FINAL = [
    ("O que reportar ao final",
     "Mesmo que tudo funcione, escreva o que <b>incomodou</b>: tela confusa, "
     "palavra que você não entendeu, caminho que precisou de tentativa e erro, "
     "campo que você não sabia como preencher. Defeito é fácil de encontrar; "
     "atrito é o que costuma passar batido e é o que faz a pessoa desistir de usar."),
    ("Perguntas que ajudam mais que “funcionou?”",
     "Em que momento você ficou em dúvida do que fazer? O que você esperava que "
     "acontecesse e aconteceu diferente? Que informação você procurou na tela e "
     "não achou? Que passo você teria feito em outra ordem?"),
]
