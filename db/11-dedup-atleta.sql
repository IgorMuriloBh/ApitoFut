-- =====================================================================
--  APITOFUT — Migration 11: identidade do atleta sem CPF
--
--  A base de atletas é global e reaproveitada entre competições, mas a
--  única chave de identidade era `cpf UNIQUE` — e a maioria das categorias
--  é de menores, que costumam não ter CPF. Resultado: o mesmo atleta era
--  recriado a cada inscrição, minando o reaproveitamento que justifica a
--  base única.
--
--  A CHAVE ESCOLHIDA: nome normalizado + data de nascimento.
--
--  Por quê: é o par que o organizador sempre tem em mãos na ficha, e que
--  o protótipo já pedia. Certidão de nascimento seria mais forte, porém é
--  campo opcional na configuração da categoria (RF005 · 2.4) — não dá para
--  apoiar identidade em algo que pode não ser pedido.
--
--  É índice ÚNICO PARCIAL, não constraint cega:
--   • só vale quando há data de nascimento (sem ela não há como afirmar
--     que dois "João Silva" são a mesma pessoa);
--   • quem tem CPF continua protegido pela unicidade do CPF.
--
--  Homônimos legítimos nascidos no mesmo dia existem. Por isso a coluna
--  `desambiguacao`: o organizador informa um diferenciador (apelido, nome
--  da mãe, escola) e os dois cadastros passam a coexistir.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- Normalização: sem acento, sem caixa, sem espaço duplicado. IMMUTABLE
-- porque índice exige — unaccent() sozinha é STABLE, então encapsulamos.
CREATE OR REPLACE FUNCTION fn_nome_normalizado(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public, pg_catalog
AS $$
  SELECT btrim(regexp_replace(lower(unaccent(txt)), '\s+', ' ', 'g'));
$$;

COMMENT ON FUNCTION fn_nome_normalizado(text) IS
  'Nome comparável: minúsculo, sem acento e sem espaço repetido. Usado na deduplicação de atletas.';

-- Diferenciador para homônimos de mesma data de nascimento.
ALTER TABLE atletas
  ADD COLUMN IF NOT EXISTS desambiguacao text;

COMMENT ON COLUMN atletas.desambiguacao IS
  'Preenchido só quando existe homônimo com a mesma data de nascimento (ex.: nome da mãe, escola). Participa da chave de deduplicação.';

-- Antes de criar o índice: apontar duplicatas que já existam, para não
-- falhar a migration num banco com dados sujos.
DO $$
DECLARE
  duplicados int;
BEGIN
  SELECT count(*) INTO duplicados FROM (
    SELECT 1
      FROM atletas
     WHERE data_nascimento IS NOT NULL
     GROUP BY fn_nome_normalizado(nome), data_nascimento, coalesce(desambiguacao, '')
    HAVING count(*) > 1
  ) d;

  IF duplicados > 0 THEN
    RAISE EXCEPTION
      'Existem % grupo(s) de atletas duplicados (mesmo nome e data de nascimento). Resolva-os antes de aplicar esta migration: preencha atletas.desambiguacao ou funda os cadastros.',
      duplicados;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_atleta_identidade
  ON atletas (
    fn_nome_normalizado(nome),
    data_nascimento,
    coalesce(desambiguacao, '')
  )
  WHERE data_nascimento IS NOT NULL;

COMMENT ON INDEX uq_atleta_identidade IS
  'Deduplicação da base global: mesmo nome normalizado + data de nascimento = mesma pessoa, salvo desambiguacao diferente. Parcial: atleta sem data fica de fora.';

-- Busca por nome normalizado fica indexada também (a tela do painel
-- procura na base global antes de criar um atleta novo).
CREATE INDEX IF NOT EXISTS idx_atletas_nome_normalizado
  ON atletas (fn_nome_normalizado(nome));

COMMIT;
