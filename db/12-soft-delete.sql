-- =====================================================================
--  APITOFUT — Migration 12: exclusão lógica no topo da árvore
--
--  O problema: organizacoes → competicoes é ON DELETE CASCADE. Apagar uma
--  organização levava junto todas as competições, categorias, equipes,
--  atletas inscritos, jogos e lances — irreversível, sem confirmação, e
--  sem rastro de quem fez.
--
--  ESCOPO DELIBERADO: exclusão lógica em `organizacoes` e `competicoes`,
--  que é onde a perda é catastrófica e onde o CASCADE se propaga. As
--  tabelas abaixo (categorias, jogos, lances) continuam com DELETE físico
--  a partir da competição: são dados DA competição, e apagar a competição
--  logicamente já os preserva. Espalhar `excluido_em` por 27 tabelas
--  custaria complexidade em toda consulta sem ganho proporcional.
--
--  O RLS passa a esconder o que está excluído: nenhuma consulta da
--  aplicação precisa lembrar do filtro, nem o portal, nem o painel.
--
--  Idempotente.
-- =====================================================================

BEGIN;

ALTER TABLE organizacoes ADD COLUMN IF NOT EXISTS excluida_em timestamptz;
ALTER TABLE competicoes  ADD COLUMN IF NOT EXISTS excluida_em timestamptz;

COMMENT ON COLUMN competicoes.excluida_em IS
  'Exclusão lógica: preenchida = invisível para portal e painel, mas os dados permanecem. NULL = ativa.';

CREATE INDEX IF NOT EXISTS idx_comp_ativas
  ON competicoes (organizacao_id) WHERE excluida_em IS NULL;


-- ---------------------------------------------------------------------
-- O RLS incorpora a exclusão: quem está excluído deixa de existir para a
-- aplicação, sem que nenhuma consulta precise lembrar do filtro.
-- As políticas descendentes já herdam via subconsulta em competicoes.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS p_competicoes ON competicoes;
CREATE POLICY p_competicoes ON competicoes
  USING (
    excluida_em IS NULL
    AND CASE
      WHEN app_current_org() IS NOT NULL THEN organizacao_id = app_current_org()
      ELSE status IN ('publicada', 'em_andamento', 'encerrada')
    END
  )
  WITH CHECK (organizacao_id = app_current_org());

DROP POLICY IF EXISTS p_organizacoes ON organizacoes;
CREATE POLICY p_organizacoes ON organizacoes
  USING (excluida_em IS NULL AND id = app_current_org())
  WITH CHECK (id = app_current_org());


-- ---------------------------------------------------------------------
-- Excluir e restaurar por função: a aplicação nunca dá DELETE nessas
-- duas tabelas. SECURITY DEFINER porque a linha excluída fica invisível
-- ao próprio papel da aplicação — sem isso, restaurar seria impossível.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_excluir_competicao(p_competicao uuid, p_organizacao uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  afetadas int;
BEGIN
  -- confere a organização aqui dentro: a função ignora o RLS
  UPDATE competicoes
     SET excluida_em = now()
   WHERE id = p_competicao
     AND organizacao_id = p_organizacao
     AND excluida_em IS NULL;

  GET DIAGNOSTICS afetadas = ROW_COUNT;
  RETURN afetadas > 0;
END; $$;

CREATE OR REPLACE FUNCTION fn_restaurar_competicao(p_competicao uuid, p_organizacao uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  afetadas int;
BEGIN
  UPDATE competicoes
     SET excluida_em = NULL
   WHERE id = p_competicao
     AND organizacao_id = p_organizacao
     AND excluida_em IS NOT NULL;

  GET DIAGNOSTICS afetadas = ROW_COUNT;
  RETURN afetadas > 0;
END; $$;

/** Lixeira: o que foi excluído e ainda pode voltar. */
CREATE OR REPLACE FUNCTION fn_competicoes_excluidas(p_organizacao uuid)
RETURNS TABLE (id uuid, nome text, slug text, excluida_em timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.nome, c.slug, c.excluida_em
    FROM competicoes c
   WHERE c.organizacao_id = p_organizacao
     AND c.excluida_em IS NOT NULL
   ORDER BY c.excluida_em DESC;
$$;

REVOKE ALL ON FUNCTION fn_excluir_competicao(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_restaurar_competicao(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_competicoes_excluidas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_excluir_competicao(uuid, uuid) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_restaurar_competicao(uuid, uuid) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_competicoes_excluidas(uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
-- A rede de segurança: barra o DELETE físico de organização que ainda
-- tenha competições. Sem isto, o CASCADE original continuaria disponível
-- para quem esquecesse e rodasse um DELETE direto.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_barra_delete_organizacao() RETURNS trigger AS $$
DECLARE
  quantas int;
BEGIN
  SELECT count(*) INTO quantas FROM competicoes WHERE organizacao_id = OLD.id;
  IF quantas > 0 THEN
    RAISE EXCEPTION
      'A organização % tem % competição(ões). Use exclusão lógica (excluida_em) — DELETE apagaria jogos e lances em cascata.',
      OLD.nome, quantas
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_barra_delete_organizacao ON organizacoes;
CREATE TRIGGER trg_barra_delete_organizacao
  BEFORE DELETE ON organizacoes
  FOR EACH ROW EXECUTE FUNCTION fn_barra_delete_organizacao();

COMMIT;
