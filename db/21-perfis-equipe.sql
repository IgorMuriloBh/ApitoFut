-- =====================================================================
--  APITOFUT — Migration 21: perfis da equipe do organizador
--
--  Até aqui a organização tinha um usuário só: o `organizador` que a
--  criou. Quem toca uma liga de verdade trabalha com equipe — alguém na
--  mesa lançando placar no sábado, alguém na secretaria conferindo
--  inscrição na semana — e todo mundo entrava com a MESMA senha do dono.
--  Senha compartilhada não tem autoria: a súmula não sabe quem lançou o
--  gol, e desligar um funcionário obriga a trocar a senha de todos.
--
--  Três perfis novos, todos dentro da organização do dono:
--
--    gestor      — equiparado ao administrador da competição; faz tudo
--                  na competição, mas NÃO mexe em quem entra na conta
--    secretaria  — equipes, atletas e comissão técnica; não opera jogo
--                  nem muda a configuração da competição
--    mesario     — dia de jogo: inicia, lança, corrige e encerra partida,
--                  e imprime súmula. Não cadastra nem configura nada
--
--  POR QUE UM ARQUIVO SÓ PARA ISTO. `ALTER TYPE ... ADD VALUE` pode rodar
--  dentro de transação no PostgreSQL 12+, mas o valor novo não pode ser
--  USADO na mesma transação. O runner (`db/migrar.mjs`) manda cada arquivo
--  numa chamada, e uma chamada com vários comandos vira transação
--  implícita — então separar garante que a migration seguinte já encontre
--  os valores utilizáveis. Sem BEGIN/COMMIT aqui, de propósito.
--
--  Idempotente.
-- =====================================================================

ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'gestor';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'secretaria';
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'mesario';
