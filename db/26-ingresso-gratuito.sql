-- =====================================================================
--  26 · Ingresso gratuito não passa por gateway (RF035, fase 2)
--
--  Descoberto na primeira compra de verdade, em produção: o Asaas
--  recusa cobrança abaixo de **R$ 5,00**.
--
--    POST /payments → 400: O valor da cobrança (R$ 1,10) menos o valor
--    do desconto (R$ 0,00) não pode ser menor que R$ 5,00.
--
--  Daí saem duas regras, decididas com o cliente:
--
--   1. lote vendido pela internet custa R$ 5,00 ou mais — validado na
--      criação do lote (`eventos.service`), para o organizador descobrir
--      ao montar o evento e não o comprador no fim do checkout;
--   2. lote de R$ 0,00 é a exceção: **não aciona o gateway**. O pedido
--      nasce pago e o ingresso sai na hora.
--
--  É por (2) que esta migration existe. Marcar como pago um pedido que
--  não passou por gateway é exatamente o tipo de coisa que não pode
--  depender só do código: `fn_confirma_pedido_gratuito` recusa qualquer
--  pedido cujo total não seja zero. Um defeito futuro no checkout pode
--  chamar a função com o pedido errado; o que ele não consegue é fazer
--  o banco dar um ingresso pago de graça.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. `gratuito` entra como forma de pagamento
--
--  Não é um detalhe de rótulo: o relatório do organizador precisa
--  distinguir "entrou dinheiro" de "era de graça", e `balcao` já
--  significa outra coisa — dinheiro recebido na mão.
-- ---------------------------------------------------------------------

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ck_pedido_metodo;
ALTER TABLE pedidos ADD CONSTRAINT ck_pedido_metodo
  CHECK (metodo IS NULL OR metodo IN ('pix', 'cartao', 'balcao', 'gratuito'));


-- ---------------------------------------------------------------------
-- 2. Confirmar um pedido que não custou nada
--
--  Mesma fresta estreita das outras: o checkout público roda sem
--  contexto de organização. E com a trava que importa — total zero, ou
--  a função recusa.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_confirma_pedido_gratuito(p_pedido uuid)
RETURNS void
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total  int;
  v_status status_pedido;
BEGIN
  SELECT total_centavos, status INTO v_total, v_status
    FROM pedidos WHERE id = p_pedido FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'AF033';
  END IF;

  -- a trava: só pedido que não custa nada é confirmado sem dinheiro
  IF v_total <> 0 THEN
    RAISE EXCEPTION 'Pedido de % centavos não pode ser confirmado sem pagamento.', v_total
      USING ERRCODE = 'AF035';
  END IF;

  IF v_status <> 'aguardando' THEN
    RETURN;   -- já resolvido; repetir não muda nada
  END IF;

  UPDATE pedidos
     SET status = 'pago',
         metodo = 'gratuito',
         pago_em = now(),
         -- pedido pago não expira: a reserva virou ingresso
         expira_em = NULL,
         atualizado_em = now()
   WHERE id = p_pedido;
END; $$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION fn_confirma_pedido_gratuito(uuid) TO apitofut_app;

COMMIT;
