-- =====================================================================
--  APITOFUT — Migration 15: área do ADM do sistema (RF031)
--
--  O schema já nasceu com `usuarios.perfil` e `usuarios.situacao`, e o
--  login já recusa quem não está `ativo` (migration 08). O que faltava era
--  o outro lado: como uma conta chega a existir, e como o superadmin
--  enxerga e opera a plataforma inteira.
--
--  Duas coisas nesta migration:
--
--  1. AUTO-CADASTRO. `fn_cadastro_organizador` cria organização + usuário
--     numa transação só. A conta nasce `pendente` — exceto a primeira da
--     base, que vira `superadmin` + `ativo` (senão não haveria quem
--     liberasse ninguém). Essa promoção é do trigger, não da função:
--     assim vale para qualquer caminho de inserção, inclusive o seed.
--
--  2. FRESTAS DO ADM. O superadmin precisa atravessar o RLS por desenho —
--     ele enxerga todas as organizações. Em vez de afrouxar as políticas
--     com um `OR app_is_super()`, que valeria para toda consulta de toda
--     tabela, cada tela do ADM ganha uma função SECURITY DEFINER com
--     recorte fixo. É o mesmo padrão do login (migration 08): a fresta é
--     estreita, nomeada e auditável, e a política continua intacta para
--     o resto do sistema.
--
--     Toda função de ADM recebe `p_ator` e reconfere no banco que ele é
--     `superadmin` + `ativo`. A API também confere, mas quem guarda a
--     porta é quem tem a chave: um bug de rota não deve virar escalação
--     de privilégio.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  1. A primeira conta da base é o ADM do sistema
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_primeiro_usuario_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Caminho rápido: com a base já povoada não há o que decidir, e não
  -- vale pegar lock nenhum no cadastro do milésimo usuário.
  IF EXISTS (SELECT 1 FROM usuarios) THEN
    RETURN NEW;
  END IF;

  -- Base vazia: dois cadastros simultâneos veriam ambos "vazio" e
  -- virariam superadmin. O lock consultivo serializa só esse caso;
  -- depois dele, reconferir é obrigatório — a outra transação pode ter
  -- inserido enquanto esperávamos.
  PERFORM pg_advisory_xact_lock(hashtext('apitofut:primeiro_usuario'));

  IF NOT EXISTS (SELECT 1 FROM usuarios) THEN
    NEW.perfil   := 'superadmin';
    NEW.situacao := 'ativo';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_primeiro_usuario_superadmin ON usuarios;
CREATE TRIGGER trg_primeiro_usuario_superadmin
  BEFORE INSERT ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_primeiro_usuario_superadmin();

COMMENT ON FUNCTION fn_primeiro_usuario_superadmin() IS
  'A primeira conta da plataforma nasce superadmin/ativo — sem ela ninguém libera ninguém.';


-- ---------------------------------------------------------------------
--  2. Auto-cadastro do organizador
-- ---------------------------------------------------------------------

-- Cria organização e usuário juntos. SECURITY DEFINER porque o cadastro,
-- como o login, acontece sem contexto de organização — o RLS de
-- `organizacoes` e `usuarios` recusaria os dois INSERTs.
CREATE OR REPLACE FUNCTION fn_cadastro_organizador(
  p_nome        text,
  p_email       citext,
  p_senha_hash  text,
  p_organizacao text
)
RETURNS TABLE (
  id             uuid,
  organizacao_id uuid,
  perfil         perfil_usuario,
  situacao       situacao_usuario
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org     uuid;
  v_usuario uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM usuarios u WHERE u.email = p_email) THEN
    -- SQLSTATE próprio: a API traduz para 409 sem depender da mensagem
    RAISE EXCEPTION 'E-mail já cadastrado.' USING ERRCODE = 'AF001';
  END IF;

  INSERT INTO organizacoes (nome, email_contato)
       VALUES (p_organizacao, p_email)
    RETURNING organizacoes.id INTO v_org;

  -- perfil/situacao vão nos defaults (`organizador`/`pendente`); o trigger
  -- promove se esta for a primeira conta da base
  INSERT INTO usuarios (organizacao_id, nome, email, senha_hash)
       VALUES (v_org, p_nome, p_email, p_senha_hash)
    RETURNING usuarios.id INTO v_usuario;

  RETURN QUERY
    SELECT u.id, u.organizacao_id, u.perfil, u.situacao
      FROM usuarios u WHERE u.id = v_usuario;
END;
$$;

REVOKE ALL ON FUNCTION fn_cadastro_organizador(text, citext, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_cadastro_organizador(text, citext, text, text) TO apitofut_app;


-- ---------------------------------------------------------------------
--  3. Porteiro das frestas do ADM
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_exige_superadmin(p_ator uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM usuarios u
     WHERE u.id = p_ator AND u.perfil = 'superadmin' AND u.situacao = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Ação restrita ao ADM do sistema.' USING ERRCODE = 'AF403';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_exige_superadmin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_exige_superadmin(uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
--  4. Tela "Usuários"
-- ---------------------------------------------------------------------

-- Contagem por usuário: competições que ele criou e atletas inscritos
-- nelas. `criado_por` é quem responde pela competição — a organização
-- pode ter mais de uma conta.
CREATE OR REPLACE FUNCTION fn_admin_usuarios(p_ator uuid)
RETURNS TABLE (
  id            uuid,
  nome          text,
  email         citext,
  organizacao   text,
  perfil        perfil_usuario,
  situacao      situacao_usuario,
  competicoes   bigint,
  atletas       bigint,
  ultimo_acesso timestamptz,
  criado_em     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_exige_superadmin(p_ator);

  RETURN QUERY
    SELECT u.id,
           u.nome,
           u.email,
           o.nome,
           u.perfil,
           u.situacao,
           coalesce(n.competicoes, 0),
           coalesce(n.atletas, 0),
           u.ultimo_acesso,
           u.criado_em
      FROM usuarios u
      LEFT JOIN organizacoes o ON o.id = u.organizacao_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT c.id) AS competicoes,
               count(DISTINCT i.atleta_id) AS atletas
          FROM competicoes c
          LEFT JOIN categorias k ON k.competicao_id = c.id
          LEFT JOIN inscricoes i ON i.categoria_id = k.id
         WHERE c.criado_por = u.id AND c.excluida_em IS NULL
      ) n ON true
     ORDER BY (u.situacao = 'pendente') DESC, u.criado_em;
END;
$$;

REVOKE ALL ON FUNCTION fn_admin_usuarios(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_admin_usuarios(uuid) TO apitofut_app;


-- Liberar, bloquear, desbloquear. Mexer na própria conta é recusado: o
-- ADM que se bloqueasse tiraria a si mesmo do sistema sem quem restaurar.
CREATE OR REPLACE FUNCTION fn_admin_define_situacao(
  p_ator     uuid,
  p_alvo     uuid,
  p_situacao situacao_usuario
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_exige_superadmin(p_ator);

  IF p_ator = p_alvo THEN
    RAISE EXCEPTION 'Não é possível alterar a situação da própria conta.'
      USING ERRCODE = 'AF422';
  END IF;

  -- 'pendente' é estado de nascimento, não destino: voltar alguém para
  -- lá não significaria nada — o caminho de tirar acesso é `bloqueado`.
  IF p_situacao = 'pendente' THEN
    RAISE EXCEPTION 'Situação inválida: use ativo ou bloqueado.'
      USING ERRCODE = 'AF422';
  END IF;

  UPDATE usuarios
     SET situacao     = p_situacao,
         liberado_por = CASE WHEN p_situacao = 'ativo' THEN p_ator ELSE liberado_por END,
         liberado_em  = CASE WHEN p_situacao = 'ativo' THEN now()  ELSE liberado_em  END
   WHERE id = p_alvo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'AF404';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_admin_define_situacao(uuid, uuid, situacao_usuario) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_admin_define_situacao(uuid, uuid, situacao_usuario) TO apitofut_app;


-- Promover a ADM / rebaixar a organizador.
CREATE OR REPLACE FUNCTION fn_admin_alterna_perfil(p_ator uuid, p_alvo uuid)
RETURNS perfil_usuario
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_novo perfil_usuario;
BEGIN
  PERFORM fn_exige_superadmin(p_ator);

  IF p_ator = p_alvo THEN
    RAISE EXCEPTION 'Não é possível alterar o próprio perfil.' USING ERRCODE = 'AF422';
  END IF;

  SELECT CASE WHEN u.perfil = 'superadmin' THEN 'organizador' ELSE 'superadmin' END
    INTO v_novo
    FROM usuarios u WHERE u.id = p_alvo;

  IF v_novo IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'AF404';
  END IF;

  -- Regra do protótipo (`alternarPerfil`, linha 3824): a plataforma não
  -- pode ficar sem ADM. Conta só quem está ativo — um superadmin
  -- bloqueado não libera ninguém.
  IF v_novo = 'organizador' AND (
       SELECT count(*) FROM usuarios u
        WHERE u.perfil = 'superadmin' AND u.situacao = 'ativo'
     ) <= 1 THEN
    RAISE EXCEPTION 'A plataforma precisa de ao menos um ADM do sistema.'
      USING ERRCODE = 'AF422';
  END IF;

  UPDATE usuarios SET perfil = v_novo WHERE id = p_alvo;
  RETURN v_novo;
END;
$$;

REVOKE ALL ON FUNCTION fn_admin_alterna_perfil(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_admin_alterna_perfil(uuid, uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
--  5. Tela "Todas as competições"
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_admin_competicoes(p_ator uuid)
RETURNS TABLE (
  id             uuid,
  nome           text,
  slug           text,
  status         status_competicao,
  temporada      int,
  cidade         text,
  estado         char(2),
  logo_url       text,
  organizacao_id uuid,
  organizacao    text,
  dono           text,
  categorias     bigint,
  times          bigint,
  atletas        bigint,
  jogos          bigint,
  criado_em      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_exige_superadmin(p_ator);

  RETURN QUERY
    -- Subconsultas escalares em vez de um LATERAL só: equipe pende da
    -- competição, categoria/inscrição/jogo pendem da categoria. Contar
    -- tudo a partir de `categorias` zeraria as equipes de uma competição
    -- ainda sem categoria — que é justamente o estado `em_criacao`.
    SELECT c.id, c.nome, c.slug, c.status, c.temporada, c.cidade, c.estado,
           c.logo_url, c.organizacao_id, o.nome, u.nome,
           (SELECT count(*) FROM categorias k WHERE k.competicao_id = c.id),
           (SELECT count(*) FROM times t WHERE t.competicao_id = c.id),
           (SELECT count(DISTINCT i.atleta_id)
              FROM inscricoes i
              JOIN categorias k ON k.id = i.categoria_id
             WHERE k.competicao_id = c.id),
           (SELECT count(*)
              FROM jogos j
              JOIN categorias k ON k.id = j.categoria_id
             WHERE k.competicao_id = c.id),
           c.criado_em
      FROM competicoes c
      JOIN organizacoes o ON o.id = c.organizacao_id
      LEFT JOIN usuarios u ON u.id = c.criado_por
     WHERE c.excluida_em IS NULL
     ORDER BY c.criado_em DESC;
END;
$$;

REVOKE ALL ON FUNCTION fn_admin_competicoes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_admin_competicoes(uuid) TO apitofut_app;


-- Qual organização responde por esta competição. É o que permite ao
-- superadmin abrir a competição de outro organizador: a API lê a
-- organização aqui e entra no contexto dela pelo caminho normal
-- (`SET LOCAL app.current_org`). O RLS segue valendo — o superadmin não
-- ganha visão de tudo ao mesmo tempo, ele assume uma organização por vez,
-- e é isso que o painel anuncia na tarja de aviso.
CREATE OR REPLACE FUNCTION fn_admin_organizacao_da_competicao(
  p_ator       uuid,
  p_competicao uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  PERFORM fn_exige_superadmin(p_ator);

  SELECT c.organizacao_id INTO v_org
    FROM competicoes c
   WHERE c.id = p_competicao AND c.excluida_em IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Competição não encontrada.' USING ERRCODE = 'AF404';
  END IF;

  RETURN v_org;
END;
$$;

REVOKE ALL ON FUNCTION fn_admin_organizacao_da_competicao(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_admin_organizacao_da_competicao(uuid, uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
--  6. Tela "Visão da plataforma"
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_admin_indicadores(p_ator uuid)
RETURNS TABLE (
  usuarios          bigint,
  organizadores     bigint,
  pendentes         bigint,
  competicoes       bigint,
  competicoes_ativas bigint,
  times             bigint,
  atletas           bigint,
  jogos             bigint,
  jogos_encerrados  bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_exige_superadmin(p_ator);

  RETURN QUERY
    SELECT (SELECT count(*) FROM usuarios),
           (SELECT count(*) FROM usuarios WHERE perfil = 'organizador'),
           (SELECT count(*) FROM usuarios WHERE situacao = 'pendente'),
           (SELECT count(*) FROM competicoes WHERE excluida_em IS NULL),
           (SELECT count(*) FROM competicoes
             WHERE excluida_em IS NULL
               AND status IN ('publicada', 'em_andamento')),
           (SELECT count(*) FROM times t
             JOIN competicoes c ON c.id = t.competicao_id
            WHERE c.excluida_em IS NULL),
           -- atletas de fato inscritos em competição viva; a base tem
           -- atleta órfão de competição excluída e ele não é "volume"
           (SELECT count(DISTINCT i.atleta_id)
              FROM inscricoes i
              JOIN categorias k  ON k.id = i.categoria_id
              JOIN competicoes c ON c.id = k.competicao_id
             WHERE c.excluida_em IS NULL),
           (SELECT count(*) FROM jogos j
              JOIN categorias k  ON k.id = j.categoria_id
              JOIN competicoes c ON c.id = k.competicao_id
             WHERE c.excluida_em IS NULL),
           (SELECT count(*) FROM jogos j
              JOIN categorias k  ON k.id = j.categoria_id
              JOIN competicoes c ON c.id = k.competicao_id
             WHERE c.excluida_em IS NULL AND j.status = 'encerrado');
END;
$$;

REVOKE ALL ON FUNCTION fn_admin_indicadores(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_admin_indicadores(uuid) TO apitofut_app;

COMMIT;
