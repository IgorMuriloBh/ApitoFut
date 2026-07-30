-- =====================================================================
--  APITOFUT — Migration 08: apoio de autenticação
--
--  O RLS esconde `usuarios` de quem não tem contexto de organização
--  (migration 06) — mas o login acontece ANTES de existir contexto. Em vez
--  de abrir a tabela ao papel da aplicação, esta função SECURITY DEFINER
--  é a única fresta: recebe um e-mail, devolve uma linha. Sem varredura,
--  sem filtro arbitrário, sem listar usuários.
--
--  Idempotente.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_busca_usuario_login(p_email citext)
RETURNS TABLE (
  id             uuid,
  organizacao_id uuid,
  nome           text,
  senha_hash     text,
  perfil         perfil_usuario,
  situacao       situacao_usuario
)
LANGUAGE sql
SECURITY DEFINER
-- fixa o search_path: regra básica de higiene em SECURITY DEFINER, senão
-- um schema malicioso na frente do public poderia sombrear a tabela
SET search_path = public
AS $$
  SELECT u.id, u.organizacao_id, u.nome, u.senha_hash, u.perfil, u.situacao
    FROM usuarios u
   WHERE u.email = p_email
   LIMIT 1;
$$;

-- a função roda como o dono; o papel da aplicação só pode executá-la
REVOKE ALL ON FUNCTION fn_busca_usuario_login(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_busca_usuario_login(citext) TO apitofut_app;

-- Registro de acesso, também por fresta controlada: o papel da aplicação
-- não enxerga a linha do usuário antes do SET LOCAL, e o carimbo de último
-- acesso acontece no instante do login.
CREATE OR REPLACE FUNCTION fn_registra_acesso(p_usuario uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE usuarios SET ultimo_acesso = now() WHERE id = p_usuario;
$$;

REVOKE ALL ON FUNCTION fn_registra_acesso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_registra_acesso(uuid) TO apitofut_app;

COMMIT;
