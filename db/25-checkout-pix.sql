-- =====================================================================
--  25 · O que o comprador vê, e o que fazer com dinheiro atrasado
--       (RF035, fase 2)
--
--  A migration 24 deixou pronto o preço e a reserva. Esta fecha duas
--  pontas que só apareceram ao olhar a API do gateway de verdade.
--
--  ── A PÁGINA DO PEDIDO ──────────────────────────────────────────────
--  Entre gerar o Pix e pagar, o comprador precisa de uma página que diga
--  "estamos esperando o pagamento" e que mude sozinha quando cair. Ele
--  não tem login, e `pedidos` não tem ramo público no RLS. O id do
--  pedido é um uuid — impossível de adivinhar —, então ele funciona como
--  a credencial do próprio dono, igual ao código do ingresso.
--  `fn_situacao_do_pedido` devolve só o que essa página mostra, e **os
--  códigos dos ingressos apenas depois de pago**.
--
--  ── DINHEIRO QUE CHEGA DEPOIS DA HORA ───────────────────────────────
--  Descoberto conferindo o gateway: o Pix do Asaas continua pagável até
--  o vencimento da cobrança, muito depois dos 30 minutos da nossa
--  reserva. Ou seja, existe uma janela real em que a vaga já voltou ao
--  estoque e o dinheiro entra assim mesmo.
--
--  Duas defesas, porque uma só não basta:
--
--   1. ao expirar a reserva, a API APAGA a cobrança no gateway (provado:
--      `DELETE /v3/payments/{id}` responde `deleted: true`). Por isso
--      `fn_expira_pedidos` passou a devolver as cobranças que venceram,
--      em vez de só contar quantas foram;
--   2. se mesmo assim um pagamento chegar para pedido que não está mais
--      aguardando, o sistema **não finge que está tudo bem**: escreve
--      na observação do pedido, em maiúsculas, que houve pagamento após
--      a expiração e que precisa de estorno. Silenciar seria deixar
--      alguém pagar por um ingresso que não existe mais.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. A página do pedido, para quem comprou
--
--  Sem e-mail, sem documento e sem o que a pessoa não precisa ver: o
--  link pode ser reencaminhado, como o do ingresso.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_situacao_do_pedido(p_pedido uuid)
RETURNS TABLE (
  status          text,
  total_centavos  int,
  taxa_centavos   int,
  metodo          text,
  pix_payload     text,
  link_pagamento  text,
  expira_em       timestamptz,
  evento_nome     text,
  evento_slug     text,
  codigos         text[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT p.status::text,
         p.total_centavos,
         p.taxa_centavos,
         p.metodo,
         -- o "copia e cola" some assim que o pedido deixa de aguardar:
         -- mostrar um Pix de pedido já pago convida a pagar de novo
         CASE WHEN p.status = 'aguardando' THEN p.pix_payload END,
         CASE WHEN p.status = 'aguardando' THEN p.link_pagamento END,
         p.expira_em,
         e.nome,
         e.slug,
         -- os códigos só depois de pago. Antes disso o ingresso existe
         -- (é a reserva), mas não é dele até o dinheiro entrar
         CASE WHEN p.status = 'pago' THEN (
           SELECT array_agg(i.codigo ORDER BY i.criado_em)
             FROM ingressos i
            WHERE i.pedido_id = p.id AND i.status = 'valido'
         ) END
    FROM pedidos p
    JOIN eventos e ON e.id = p.evento_id
   WHERE p.id = p_pedido;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ---------------------------------------------------------------------
-- 2. Expirar devolve as cobranças, para a API apagá-las no gateway
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS fn_expira_pedidos();

-- SECURITY DEFINER não é detalhe: quem chama esta função é o checkout
-- PÚBLICO, que roda sem contexto de organização. Sem isto o RLS esconde
-- `pedidos` do próprio UPDATE, que afeta zero linhas e não reclama —
-- a reserva nunca expiraria, a cobrança nunca seria apagada, e nada no
-- log diria por quê. Aconteceu em teste, e foi assim que apareceu.
CREATE FUNCTION fn_expira_pedidos()
RETURNS TABLE (pedido_id uuid, cobranca text)
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE pedidos
     SET status       = 'cancelado',
         cancelado_em = now(),
         observacoes  = concat_ws(' | ', observacoes,
                          'Reserva expirada sem pagamento.')
   WHERE status = 'aguardando'
     AND expira_em IS NOT NULL
     AND expira_em < now()
  RETURNING id, asaas_cobranca_id;
END; $$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 3. Pagamento fora de hora não passa em silêncio
-- ---------------------------------------------------------------------

-- Devolve TAMBÉM o que de fato aconteceu, e não só o pedido afetado: o
-- webhook registra isso no log, e "pago" num caso que na verdade virou
-- aviso de estorno engana quem for investigar depois.
DROP FUNCTION IF EXISTS fn_aplica_pagamento(text, text, timestamptz);

CREATE FUNCTION fn_aplica_pagamento(
  p_cobranca text,
  p_status   text,       -- 'pago' | 'cancelado' | 'estornado'
  p_quando   timestamptz
) RETURNS TABLE (pedido_id uuid, resultado text)
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pedido uuid;
  v_atual  status_pedido;
BEGIN
  SELECT id, status INTO v_pedido, v_atual
    FROM pedidos WHERE asaas_cobranca_id = p_cobranca
    FOR UPDATE;

  IF NOT FOUND THEN
    -- cobrança que não é nossa: o webhook responde 200 mesmo assim
    RETURN;
  END IF;

  IF p_status = 'pago' THEN
    IF v_atual = 'pago' THEN
      RETURN QUERY SELECT v_pedido, 'ja_estava_pago'::text;
      RETURN;
    END IF;

    IF v_atual <> 'aguardando' THEN
      -- a reserva já tinha caído e o dinheiro entrou assim mesmo. O
      -- ingresso não volta sozinho: a vaga pode ter sido vendida a
      -- outra pessoa, e ressuscitá-lo furaria o limite do lote
      UPDATE pedidos
         SET observacoes = concat_ws(' | ', observacoes,
               'ATENÇÃO: PAGAMENTO RECEBIDO APÓS A EXPIRAÇÃO DA RESERVA — CONFERIR ESTORNO.'),
             atualizado_em = now()
       WHERE id = v_pedido;
      RETURN QUERY SELECT v_pedido, 'pago_apos_expirar'::text;
      RETURN;
    END IF;

    UPDATE pedidos
       SET status = 'pago', pago_em = COALESCE(p_quando, now()),
           expira_em = NULL, atualizado_em = now()
     WHERE id = v_pedido;
    RETURN QUERY SELECT v_pedido, 'pago'::text;
    RETURN;

  ELSIF p_status IN ('cancelado', 'estornado') THEN
    IF v_atual IN ('cancelado', 'estornado') THEN
      RETURN QUERY SELECT v_pedido, 'sem_mudanca'::text;
      RETURN;
    END IF;
    UPDATE pedidos
       SET status = p_status::status_pedido,
           cancelado_em = COALESCE(p_quando, now()),
           atualizado_em = now()
     WHERE id = v_pedido;
    RETURN QUERY SELECT v_pedido, p_status;
    RETURN;

  ELSE
    RAISE EXCEPTION 'Situação de pagamento desconhecida: %', p_status
      USING ERRCODE = 'AF035';
  END IF;
END; $$ LANGUAGE plpgsql;


GRANT EXECUTE ON FUNCTION fn_situacao_do_pedido(uuid) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_aplica_pagamento(text, text, timestamptz) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_expira_pedidos() TO apitofut_app;

COMMIT;
