-- =====================================================================
--  APITOFUT — Migration 06: Row Level Security multi-tenant
--
--  Até aqui o isolamento entre organizações dependia inteiramente de a
--  aplicação lembrar do WHERE certo. Um endpoint novo que esquecesse o
--  guard vazaria dados de outro organizador.
--
--  DOIS DETALHES QUE, SE IGNORADOS, TORNAM O RLS DECORATIVO:
--
--   1. O papel `apitofut` é SUPERUSER e superuser IGNORA RLS, mesmo com
--      FORCE. Por isso esta migration cria `apitofut_app`, sem superuser
--      e com NOBYPASSRLS — é com ele que a aplicação deve conectar.
--
--   2. Views rodam com os privilégios do DONO por padrão, o que também
--      contorna o RLS das tabelas de base. As três views passam a
--      security_invoker (PostgreSQL 15+).
--
--  MODELO DE ACESSO — a organização vem do GUC `app.current_org`:
--
--   • GUC não definido  → contexto público: enxerga apenas competições
--     publicada/em_andamento/encerrada. É como o portal lê.
--   • GUC definido      → contexto do painel: enxerga tudo da própria
--     organização, inclusive em_criacao. Nada de outras.
--
--  Escrita SEMPRE exige contexto de organização: o portal é somente leitura.
--
--  A aplicação define o contexto com SET LOCAL dentro da transação:
--     BEGIN; SET LOCAL app.current_org = '<uuid>'; ... COMMIT;
--  SET solto vaza para o próximo request no pool de conexões.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Papel de aplicação (sem superuser, sem bypass)
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'apitofut_app') THEN
    -- senha de desenvolvimento — trocar antes de qualquer deploy
    CREATE ROLE apitofut_app LOGIN PASSWORD 'apitofut_app_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO apitofut_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO apitofut_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apitofut_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO apitofut_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO apitofut_app;


-- ---------------------------------------------------------------------
-- 2. Contexto da organização
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_org', true), '')::uuid;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION app_current_org() IS
  'Organização do request atual, lida de app.current_org. NULL = contexto público (portal).';


-- ---------------------------------------------------------------------
-- 3. Views passam a rodar com os privilégios de quem consulta.
--    Sem isto elas rodariam como o dono (superuser) e devolveriam
--    linhas que o RLS deveria ter escondido.
-- ---------------------------------------------------------------------

ALTER VIEW v_classificacao        SET (security_invoker = true);
ALTER VIEW v_estatisticas_atleta  SET (security_invoker = true);
ALTER VIEW v_atletas_fora_faixa   SET (security_invoker = true);


-- ---------------------------------------------------------------------
-- 4. Raiz da árvore: competicoes
-- ---------------------------------------------------------------------

ALTER TABLE competicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE competicoes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_competicoes ON competicoes;
CREATE POLICY p_competicoes ON competicoes
  USING (
    CASE
      WHEN app_current_org() IS NOT NULL THEN organizacao_id = app_current_org()
      ELSE status IN ('publicada', 'em_andamento', 'encerrada')
    END
  )
  -- escrever exige contexto: o portal público nunca grava
  WITH CHECK (organizacao_id = app_current_org());


-- ---------------------------------------------------------------------
-- 5. Descendentes.
--    As subconsultas abaixo também passam pelo RLS, então a visibilidade
--    é herdada em cascata a partir de competicoes — não é preciso repetir
--    a regra de status em cada tabela.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  tbl  text;
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- (tabela, expressão de pertencimento)
      ('categorias',                     'competicao_id IN (SELECT id FROM competicoes)'),
      ('times',                          'competicao_id IN (SELECT id FROM competicoes)'),
      ('campos',                         'competicao_id IN (SELECT id FROM competicoes)'),
      ('arbitros',                       'competicao_id IN (SELECT id FROM competicoes)'),
      ('patrocinadores',                 'competicao_id IN (SELECT id FROM competicoes)'),

      ('categoria_regras',               'categoria_id IN (SELECT id FROM categorias)'),
      ('categoria_inscricao_config',     'categoria_id IN (SELECT id FROM categorias)'),
      ('categoria_coluna_classificacao', 'categoria_id IN (SELECT id FROM categorias)'),
      ('categoria_criterio_desempate',   'categoria_id IN (SELECT id FROM categorias)'),
      ('categoria_campo_sumula',         'categoria_id IN (SELECT id FROM categorias)'),
      ('categoria_campo_atleta',         'categoria_id IN (SELECT id FROM categorias)'),
      ('categoria_times',                'categoria_id IN (SELECT id FROM categorias)'),
      ('categoria_coluna_extra',         'categoria_id IN (SELECT id FROM categorias)'),
      ('fases',                          'categoria_id IN (SELECT id FROM categorias)'),
      ('grupos',                         'categoria_id IN (SELECT id FROM categorias)'),
      ('jogos',                          'categoria_id IN (SELECT id FROM categorias)'),
      ('inscricoes',                     'categoria_id IN (SELECT id FROM categorias)'),
      ('suspensoes',                     'categoria_id IN (SELECT id FROM categorias)'),

      ('comissao_tecnica',               'time_id IN (SELECT id FROM times)'),
      ('campo_fotos',                    'campo_id IN (SELECT id FROM campos)'),
      ('jogo_escalacoes',                'jogo_id IN (SELECT id FROM jogos)'),
      ('jogo_eventos',                   'jogo_id IN (SELECT id FROM jogos)'),
      ('atleta_documentos',              'atleta_id IN (SELECT id FROM atletas)')
    ) AS t(tabela, expr)
  LOOP
    tbl := spec.tabela;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS p_%1$s ON %1$I;', tbl);
    EXECUTE format(
      'CREATE POLICY p_%1$s ON %1$I USING (%2$s) WITH CHECK (%2$s);',
      tbl, spec.expr
    );
  END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- 6. Organizações e usuários: escopo direto do tenant.
-- ---------------------------------------------------------------------

ALTER TABLE organizacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizacoes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_organizacoes ON organizacoes;
CREATE POLICY p_organizacoes ON organizacoes
  USING (id = app_current_org())
  WITH CHECK (id = app_current_org());

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_usuarios ON usuarios;
CREATE POLICY p_usuarios ON usuarios
  USING (organizacao_id = app_current_org())
  WITH CHECK (organizacao_id = app_current_org());


-- ---------------------------------------------------------------------
-- 7. Atletas: base global por desenho (CLAUDE.md), reaproveitada entre
--    competições — não tem organização própria. A leitura fica atrelada a
--    existir inscrição visível; como `inscricoes` já é filtrada pelo RLS,
--    um atleta só aparece para quem enxerga alguma inscrição dele.
--    A escrita segue liberada: cadastrar atleta acontece ANTES da primeira
--    inscrição, então exigir vínculo aqui inviabilizaria o cadastro.
-- ---------------------------------------------------------------------

ALTER TABLE atletas ENABLE ROW LEVEL SECURITY;
ALTER TABLE atletas FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_atletas_leitura ON atletas;
CREATE POLICY p_atletas_leitura ON atletas
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM inscricoes i WHERE i.atleta_id = atletas.id));

DROP POLICY IF EXISTS p_atletas_escrita ON atletas;
CREATE POLICY p_atletas_escrita ON atletas
  FOR ALL
  USING (app_current_org() IS NOT NULL)
  WITH CHECK (app_current_org() IS NOT NULL);

-- faixas_etarias é tabela de referência (Sub-N × ano), sem dado de tenant:
-- fica legível por todos, sem RLS.

COMMIT;

-- =====================================================================
--  COMO A APLICAÇÃO USA
--
--    Portal público  → conectar como apitofut_app e NÃO definir o GUC.
--    Painel          → BEGIN; SET LOCAL app.current_org = '<uuid>'; ...
--
--  O `apitofut` (dono, superuser) continua ignorando RLS de propósito:
--  é quem roda migrations e o initdb. Nunca use esse papel na aplicação.
--
--  ANTES DE PRODUÇÃO
--   • trocar a senha de apitofut_app
--   • medir as políticas com EXPLAIN: as subconsultas em cascata são
--     legíveis, mas em competições grandes vale materializar
--     organizacao_id nas tabelas netas e simplificar as políticas
-- =====================================================================
