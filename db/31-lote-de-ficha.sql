-- =====================================================================
--  31 · O lote de ficha aponta para um produto (RF035)
--
--  Vender ficha é colocar um item do cardápio à venda num evento. O
--  lote continua sendo o que se compra; `produto_id` diz O QUE o
--  balcão entrega.
--
--  ── POR QUE O LOTE GUARDA NOME E PREÇO MESMO ASSIM ──────────────────
--  Eles já existem em `lotes` e continuam a valer: são a FOTOGRAFIA do
--  produto no dia da venda. Se amanhã a cerveja subir para R$ 10, quem
--  comprou a R$ 8 comprou a R$ 8 — e o relatório daquele evento precisa
--  continuar dizendo R$ 8. Ler o preço do produto na hora de exibir
--  reescreveria o passado toda vez que o cardápio mudasse.
--
--  `produto_id` serve ao presente: a foto e o nome que o atendente vê
--  no balcão, e o vínculo que permite perguntar "quantas cervejas eu
--  vendi em todos os eventos".
--
--  ── O APAGAR DO PRODUTO NÃO PODE APAGAR A VENDA ─────────────────────
--  `ON DELETE SET NULL`: tirar um item do cardápio é decisão de
--  cardápio, não de contabilidade. O lote continua com o nome e o preço
--  que tinha, e o balcão continua sabendo o que entregar — só perde a
--  foto e o vínculo para relatório.
--
--  Idempotente.
-- =====================================================================

BEGIN;

ALTER TABLE lotes
  ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lotes_produto
  ON lotes (produto_id) WHERE produto_id IS NOT NULL;

-- Ficha sem produto não diz o que entregar; ingresso com produto
-- sugeriria uma entrega que o portão não faz. Os dois são engano de
-- preenchimento, e o banco recusa os dois.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_lote_produto_da_especie'
  ) THEN
    ALTER TABLE lotes ADD CONSTRAINT ck_lote_produto_da_especie
      CHECK (
        (especie = 'ficha'    AND produto_id IS NOT NULL) OR
        (especie <> 'ficha'   AND produto_id IS NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN lotes.produto_id IS
  'O item do cardápio que esta ficha entrega. Obrigatório na espécie '
  'ficha, proibido nas demais. Nome e preço do lote continuam sendo a '
  'fotografia do produto no dia da venda.';

COMMIT;
