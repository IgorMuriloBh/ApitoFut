-- =====================================================================
--  APITOFUT — Migration 22: a equipe do organizador
--
--  Cria e governa os usuários que o dono da conta convida (migration 21
--  trouxe os perfis). Três coisas moram aqui:
--
--   1. `senha_provisoria` — o convite nasce com uma senha gerada pelo
--      sistema, que o dono repassa ao funcionário. Enquanto a marca
--      estiver ligada, o painel obriga a troca no primeiro acesso. Sem
--      isso o dono conheceria para sempre a senha de cada funcionário, e
--      autoria de lançamento vira ficção.
--
--   2. As frestas SECURITY DEFINER da tela de equipe. Mesmo motivo da
--      migration 15: o RLS de `usuarios` filtra por organização, mas
--      QUEM pode promover quem é regra de negócio, e regra de negócio que
--      só existe no botão da tela é regra que o primeiro endpoint novo
--      esquece. Aqui o banco reconfere o ator antes de qualquer escrita.
--
--  ONDE A PERMISSÃO POR PERFIL É APLICADA. O que cada perfil pode ESCREVER
--  na competição vive na API (`auth/permissoes.ts` + `PermissaoGuard`), não
--  em política de RLS. O RLS recorta por ORGANIZAÇÃO, e reescrever as
--  políticas de todas as tabelas para também recortar por perfil seria mexer
--  na camada que hoje garante o isolamento entre contas — risco alto para
--  proteger contra dano interno já limitado à própria organização. O que o
--  banco guarda é o que seria catastrófico: ninguém se promove, porque
--  promover só acontece pelas funções abaixo.
--
--  A REGRA QUE NÃO PODE CAIR: um convidado nunca vira `organizador` nem
--  `superadmin`, e ninguém altera o próprio perfil ou a própria situação.
--  Sem as duas, um mesário se promove a gestor e o teto do convite deixa
--  de existir.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  1. Colunas novas em usuarios
-- ---------------------------------------------------------------------

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS senha_provisoria boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN usuarios.senha_provisoria IS
  'Senha ainda é a gerada no convite: o painel exige a troca antes de liberar qualquer outra tela.';

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS convidado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN usuarios.convidado_por IS
  'Quem convidou este usuário. NULL = conta criada por auto-cadastro (RF031).';


-- ---------------------------------------------------------------------
--  2. Porteiro: só o dono da conta mexe na equipe
--
--  "Dono" é quem fez o auto-cadastro da organização — `organizador`, ou
--  `superadmin` se for a primeira conta da base, que a migration 15 promove.
--  Gestor tem poder sobre a competição e nenhum sobre quem entra na
--  conta: é o teto que impede um convidado de se multiplicar.
--
--  Dono da PRÓPRIA conta, sempre: o superadmin que assumiu a organização
--  de outro organizador administra a competição alheia, não a equipe
--  alheia. Para isso existe a área do ADM, e ter dois caminhos para o
--  mesmo efeito é como se perde o rastro de quem fez o quê.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_exige_dono_da_conta(p_ator uuid, p_org uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  -- `superadmin` entra porque a PRIMEIRA conta da base é promovida a ele
  -- (migration 15) e perde o rótulo `organizador` — ela continua sendo a
  -- dona da própria organização, e sem isto ficaria sem acesso à própria
  -- equipe.
  SELECT u.organizacao_id INTO v_org
    FROM usuarios u
   WHERE u.id = p_ator
     AND u.perfil IN ('organizador', 'superadmin')
     AND u.situacao = 'ativo';

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Apenas o responsável pela conta gerencia a equipe.'
      USING ERRCODE = 'AF020';
  END IF;

  -- A organização do request tem de ser a DELE. Um superadmin que assumiu
  -- a conta de outro organizador (migration 15) administra a competição
  -- alheia, não a equipe alheia: para isso existe a área do ADM, e ter dois
  -- caminhos para o mesmo efeito é como se perde o rastro de quem fez o quê.
  IF p_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'A equipe é gerenciada dentro da própria conta.'
      USING ERRCODE = 'AF020';
  END IF;

  RETURN v_org;
END;
$$;

REVOKE ALL ON FUNCTION fn_exige_dono_da_conta(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_exige_dono_da_conta(uuid, uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
--  3. Convidar
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_equipe_convidar(
  p_ator       uuid,
  p_nome       text,
  p_email      citext,
  p_senha_hash text,
  p_perfil     perfil_usuario,
  p_org        uuid
)
RETURNS TABLE (
  id       uuid,
  nome     text,
  email    citext,
  perfil   perfil_usuario,
  situacao situacao_usuario
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  uuid;
  v_novo uuid;
BEGIN
  v_org := fn_exige_dono_da_conta(p_ator, p_org);

  -- lista fechada: `organizador` e `superadmin` não se distribuem por
  -- convite, e os perfis herdados do protótipo (tecnico, arbitro, atleta)
  -- não têm tela nem permissão definida
  IF p_perfil NOT IN ('gestor', 'secretaria', 'mesario') THEN
    RAISE EXCEPTION 'Perfil inválido para convite.' USING ERRCODE = 'AF021';
  END IF;

  IF EXISTS (SELECT 1 FROM usuarios u WHERE u.email = p_email) THEN
    RAISE EXCEPTION 'E-mail já cadastrado.' USING ERRCODE = 'AF001';
  END IF;

  -- nasce ATIVO: quem convidou é o responsável pela conta, e exigir que o
  -- ADM da plataforma libere um funcionário de terceiro seria burocracia
  -- sem dono. A situação `pendente` continua valendo para o auto-cadastro.
  INSERT INTO usuarios (
    organizacao_id, nome, email, senha_hash, perfil, situacao,
    senha_provisoria, convidado_por, liberado_por, liberado_em
  ) VALUES (
    v_org, p_nome, p_email, p_senha_hash, p_perfil, 'ativo',
    true, p_ator, p_ator, now()
  ) RETURNING usuarios.id INTO v_novo;

  RETURN QUERY
    SELECT u.id, u.nome, u.email, u.perfil, u.situacao
      FROM usuarios u WHERE u.id = v_novo;
END;
$$;

REVOKE ALL ON FUNCTION fn_equipe_convidar(uuid, text, citext, text, perfil_usuario, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_equipe_convidar(uuid, text, citext, text, perfil_usuario, uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
--  4. Listar
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_equipe_listar(p_ator uuid, p_org uuid)
RETURNS TABLE (
  id               uuid,
  nome             text,
  email            citext,
  perfil           perfil_usuario,
  situacao         situacao_usuario,
  senha_provisoria boolean,
  ultimo_acesso    timestamptz,
  criado_em        timestamptz,
  eh_dono          boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  v_org := fn_exige_dono_da_conta(p_ator, p_org);

  RETURN QUERY
    SELECT u.id, u.nome, u.email, u.perfil, u.situacao, u.senha_provisoria,
           u.ultimo_acesso, u.criado_em,
           (u.perfil IN ('organizador', 'superadmin')) AS eh_dono
      FROM usuarios u
     WHERE u.organizacao_id = v_org
     ORDER BY (u.perfil IN ('organizador', 'superadmin')) DESC, u.nome;
END;
$$;

REVOKE ALL ON FUNCTION fn_equipe_listar(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_equipe_listar(uuid, uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
--  5. Alterar perfil e situação
--
--  As duas guardas que sustentam o modelo:
--   • o alvo tem de ser da MESMA organização e não pode ser o dono —
--     senão o convidado rebaixaria quem o convidou;
--   • ninguém altera a si mesmo, nem por engano de tela.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_equipe_alterar(
  p_ator     uuid,
  p_alvo     uuid,
  p_org      uuid,
  p_perfil   perfil_usuario DEFAULT NULL,
  p_situacao situacao_usuario DEFAULT NULL
)
RETURNS TABLE (
  id       uuid,
  perfil   perfil_usuario,
  situacao situacao_usuario
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  uuid;
  v_alvo usuarios%ROWTYPE;
BEGIN
  v_org := fn_exige_dono_da_conta(p_ator, p_org);

  IF p_ator = p_alvo THEN
    RAISE EXCEPTION 'Você não altera o próprio acesso.' USING ERRCODE = 'AF022';
  END IF;

  SELECT * INTO v_alvo FROM usuarios u WHERE u.id = p_alvo;
  IF NOT FOUND OR v_alvo.organizacao_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Usuário não encontrado nesta conta.' USING ERRCODE = 'AF023';
  END IF;

  IF v_alvo.perfil IN ('organizador', 'superadmin') THEN
    RAISE EXCEPTION 'O responsável pela conta não é alterado por aqui.'
      USING ERRCODE = 'AF024';
  END IF;

  IF p_perfil IS NOT NULL AND p_perfil NOT IN ('gestor', 'secretaria', 'mesario') THEN
    RAISE EXCEPTION 'Perfil inválido para a equipe.' USING ERRCODE = 'AF021';
  END IF;

  IF p_situacao IS NOT NULL AND p_situacao = 'pendente' THEN
    RAISE EXCEPTION 'Convidado não volta a pendente: use bloqueado.'
      USING ERRCODE = 'AF025';
  END IF;

  UPDATE usuarios u
     SET perfil   = COALESCE(p_perfil, u.perfil),
         situacao = COALESCE(p_situacao, u.situacao)
   WHERE u.id = p_alvo;

  RETURN QUERY
    SELECT u.id, u.perfil, u.situacao FROM usuarios u WHERE u.id = p_alvo;
END;
$$;

REVOKE ALL ON FUNCTION fn_equipe_alterar(uuid, uuid, uuid, perfil_usuario, situacao_usuario) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_equipe_alterar(uuid, uuid, uuid, perfil_usuario, situacao_usuario) TO apitofut_app;


-- ---------------------------------------------------------------------
--  6. Nova senha do próprio usuário
--
--  Fresta porque a troca acontece com a sessão já aberta mas antes de
--  qualquer outra tela — e porque limitar ao PRÓPRIO usuário no banco
--  vale mais que limitar no controller: aqui não há como passar o id de
--  outra pessoa.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_trocar_propria_senha(
  p_usuario    uuid,
  p_senha_hash text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE usuarios
     SET senha_hash = p_senha_hash,
         senha_provisoria = false
   WHERE id = p_usuario
     AND situacao = 'ativo';
$$;

REVOKE ALL ON FUNCTION fn_trocar_propria_senha(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_trocar_propria_senha(uuid, text) TO apitofut_app;


-- ---------------------------------------------------------------------
--  7. O login precisa saber da senha provisória
--
--  DROP + CREATE porque o tipo de retorno muda, e `CREATE OR REPLACE` não
--  troca a assinatura de retorno.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS fn_busca_usuario_login(citext);

CREATE FUNCTION fn_busca_usuario_login(p_email citext)
RETURNS TABLE (
  id               uuid,
  organizacao_id   uuid,
  nome             text,
  senha_hash       text,
  perfil           perfil_usuario,
  situacao         situacao_usuario,
  senha_provisoria boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.organizacao_id, u.nome, u.senha_hash, u.perfil, u.situacao,
         u.senha_provisoria
    FROM usuarios u
   WHERE u.email = p_email
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION fn_busca_usuario_login(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_busca_usuario_login(citext) TO apitofut_app;

COMMIT;
