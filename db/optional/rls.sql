-- =====================================================================
--  APITOFUT — Row Level Security (OPCIONAL / NÃO auto-aplicado)
--
--  Isolamento multi-tenant no banco. NÃO roda no initdb (está em subpasta).
--  Aplicar manualmente quando a stack estiver definida:
--
--     docker exec -i apitofut-db psql -U apitofut -d apitofut < db/optional/rls.sql
--
--  PRÉ-REQUISITOS IMPORTANTES:
--   • A aplicação NÃO pode conectar como o dono das tabelas ('apitofut'),
--     pois o dono ignora RLS a menos que se use FORCE (abaixo já forçamos).
--     Ainda assim, crie um role de aplicação sem BYPASSRLS:
--        CREATE ROLE apitofut_app LOGIN PASSWORD '...';
--        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO apitofut_app;
--   • A cada conexão/transação, a aplicação define a organização do usuário:
--        SET app.current_org = '<uuid-da-organizacao>';
--     As policies leem esse GUC. Sem ele, nada é visível.
--
--  Modelo: competicoes tem organizacao_id; as demais tabelas herdam a
--  organização via competicao_id. As policies abaixo cobrem as tabelas
--  diretamente ligadas à competição; estenda para descendentes conforme
--  necessário (ou materialize organizacao_id nas filhas para simplificar).
-- =====================================================================

BEGIN;

-- Helper: organização do contexto da sessão (NULL se não definida)
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_org', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ---- competicoes: filtro direto por organizacao_id ----
ALTER TABLE competicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE competicoes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_competicoes_tenant ON competicoes;
CREATE POLICY p_competicoes_tenant ON competicoes
  USING (organizacao_id = app_current_org())
  WITH CHECK (organizacao_id = app_current_org());

-- ---- tabelas filhas ligadas por competicao_id ----
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['categorias','times','campos','arbitros','patrocinadores'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS p_%1$s_tenant ON %1$s;', tbl);
    EXECUTE format($f$
      CREATE POLICY p_%1$s_tenant ON %1$s
      USING (competicao_id IN (SELECT id FROM competicoes WHERE organizacao_id = app_current_org()))
      WITH CHECK (competicao_id IN (SELECT id FROM competicoes WHERE organizacao_id = app_current_org()));
    $f$, tbl);
  END LOOP;
END $$;

-- Netas (jogos, inscricoes, jogo_eventos, ...) herdam via categoria/time.
-- Recomendação: materializar organizacao_id nessas tabelas para policies
-- simples e indexáveis, em vez de subqueries de 2+ níveis. Deixado como
-- decisão de modelagem quando a stack for escolhida.

COMMIT;
