-- =====================================================================
--  29 · Ficha de consumo: uso único (RF035)
--
--  O núcleo de eventos nasceu com três espécies de lote — `ingresso`,
--  `inscricao` e `ficha` —, mas até aqui só `ingresso` era vendido. A
--  ficha entra agora, e traz uma regra que o ingresso não tem.
--
--  ── O PERIGO QUE ESTA MIGRATION EXISTE PARA EVITAR ──────────────────
--  A trava de uso é `uq_checkin_do_dia (ingresso_id, dia)`: um ingresso
--  entra UMA VEZ POR DIA. Numa ficha de consumo isso seria desastroso —
--  a mesma ficha compraria uma cerveja por dia, para sempre. Num evento
--  de dois dias, cada ficha valeria duas.
--
--  ── A SOLUÇÃO: A BAIXA DA FICHA NÃO TEM DIA ─────────────────────────
--  `dia` passa a aceitar NULL, e o índice vira `NULLS NOT DISTINCT`.
--  Com isso o banco permite **uma única linha com `dia` nulo** por
--  ingresso — que é exatamente "esta ficha foi usada, e acabou".
--
--  Não é truque de implementação: é o que o dado significa. Um check-in
--  de ingresso consome UM DIA do evento, e por isso tem data. Uma ficha
--  não consome um dia — consome a si mesma. `registrado_em` continua
--  guardando QUANDO a entrega aconteceu, que é o que a auditoria pede.
--
--  Por que no índice e não num gatilho: índice único não tem corrida.
--  Dois atendentes lendo a mesma ficha no mesmo instante é o normal num
--  balcão com duas filas — um grava, o outro bate na unicidade e recebe
--  "já utilizada". Um gatilho que conferisse antes de gravar deixaria
--  passar as duas.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. A baixa pode não pertencer a dia nenhum
-- ---------------------------------------------------------------------

ALTER TABLE ingresso_checkins ALTER COLUMN dia DROP NOT NULL;

COMMENT ON COLUMN ingresso_checkins.dia IS
  'O dia do evento que esta baixa consumiu. NULL na ficha de consumo: '
  'ela não consome um dia, consome a si mesma. Ver uq_checkin_do_dia.';


-- ---------------------------------------------------------------------
-- 2. O índice passa a tratar NULL como valor
--
--  Sem `NULLS NOT DISTINCT`, o Postgres considera cada NULL diferente
--  de todos os outros — e a mesma ficha poderia ser entregue infinitas
--  vezes, cada entrega com `dia` nulo e nenhuma colidindo. É o oposto
--  do que se quer, e falharia em silêncio.
-- ---------------------------------------------------------------------

DROP INDEX IF EXISTS uq_checkin_do_dia;

CREATE UNIQUE INDEX uq_checkin_do_dia
  ON ingresso_checkins (ingresso_id, dia) NULLS NOT DISTINCT;

COMMENT ON INDEX uq_checkin_do_dia IS
  'Ingresso entra uma vez por dia; ficha é entregue uma vez só (dia NULL). '
  'É esta linha que impede a entrada dupla e a ficha reutilizada.';


-- ---------------------------------------------------------------------
-- 3. A ficha não tem dia próprio
--
--  `lotes.dia` existe para o ingresso de um dia específico de um evento
--  de vários. Ficha vale enquanto o evento acontece, e ponto: deixar
--  alguém marcar um dia criaria a expectativa de uma regra que o
--  balcão não aplica.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_lote_ficha_sem_dia'
  ) THEN
    ALTER TABLE lotes ADD CONSTRAINT ck_lote_ficha_sem_dia
      CHECK (especie <> 'ficha' OR dia IS NULL);
  END IF;
END $$;

COMMIT;
