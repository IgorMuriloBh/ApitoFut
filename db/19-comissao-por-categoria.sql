-- =====================================================================
--  APITOFUT — Migration 19: comissão técnica por categoria
--
--  A comissão nasceu presa à equipe (`comissao_tecnica.time_id`), mas o
--  limite sempre foi da CATEGORIA (`categoria_inscricao_config.max_comissao`)
--  — e uma equipe que disputa Sub-13 e Sub-15 leva técnico diferente em
--  cada uma. Enquanto a comissão era uma lista só, a API tinha de inventar
--  o limite: usava o MAIOR max_comissao entre as categorias da equipe, o
--  que deixava a categoria mais restritiva estourar sem ninguém perceber.
--
--  Com `categoria_id` a conta volta a fechar: cada categoria tem a sua
--  lista e o seu teto, conferidos contra a própria configuração.
--
--  POR QUE NULLABLE. Linhas antigas (seed, cadastro pelo painel) não têm
--  categoria, e equipe sem vínculo nenhum não tem para onde ser migrada.
--  NULL significa "comissão da equipe, sem categoria" — continua listada
--  no painel e na súmula impressa, e a área da equipe passa a gravar
--  sempre com categoria.
--
--  Idempotente.
-- =====================================================================

BEGIN;

ALTER TABLE comissao_tecnica
  ADD COLUMN IF NOT EXISTS categoria_id uuid
    REFERENCES categorias(id) ON DELETE CASCADE;

COMMENT ON COLUMN comissao_tecnica.categoria_id IS
  'Categoria a que o membro pertence. NULL = comissão da equipe sem recorte de categoria (linhas anteriores à migration 19).';

CREATE INDEX IF NOT EXISTS idx_comissao_categoria
  ON comissao_tecnica(categoria_id);

-- ---------------------------------------------------------------------
--  Backfill: equipe que disputa uma categoria só não tem ambiguidade —
--  a comissão dela é daquela categoria. Com mais de uma, a primeira na
--  ordem do organizador; qualquer escolha aqui seria arbitrária, e essa
--  é a que a tela mostra primeiro.
-- ---------------------------------------------------------------------
UPDATE comissao_tecnica m
   SET categoria_id = (
         SELECT ct.categoria_id
           FROM categoria_times ct
           JOIN categorias k ON k.id = ct.categoria_id
          WHERE ct.time_id = m.time_id
          ORDER BY k.ordem, k.nome
          LIMIT 1
       )
 WHERE m.categoria_id IS NULL;

-- ---------------------------------------------------------------------
--  A categoria informada tem de ser uma que a equipe realmente disputa.
--  Sem isto, o id de outra categoria da mesma competição entraria pela
--  porta lateral — o RLS deixa passar, porque a organização é a mesma.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_comissao_categoria()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.categoria_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM categoria_times ct
     WHERE ct.categoria_id = NEW.categoria_id
       AND ct.time_id      = NEW.time_id
  ) THEN
    RAISE EXCEPTION 'A equipe não disputa a categoria informada.'
      USING ERRCODE = 'AF010';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_valida_comissao_categoria ON comissao_tecnica;
CREATE TRIGGER trg_valida_comissao_categoria
  BEFORE INSERT OR UPDATE OF categoria_id, time_id ON comissao_tecnica
  FOR EACH ROW EXECUTE FUNCTION fn_valida_comissao_categoria();

COMMIT;
