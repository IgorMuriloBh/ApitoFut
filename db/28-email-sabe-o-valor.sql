-- =====================================================================
--  28 · O e-mail precisa saber quanto custou (RF035)
--
--  Encontrado lendo o primeiro e-mail que chegou de verdade: um
--  ingresso de **entrada franca** foi anunciado como
--  "Seu pagamento foi confirmado".
--
--  Quem recebe uma cortesia e lê isso fica em dúvida se foi cobrado — e
--  a dúvida sobre cobrança é justamente a que ninguém quer ter. O texto
--  não tinha como acertar: `fn_pedido_para_email` devolvia tudo sobre o
--  evento e o ingresso, e nada sobre dinheiro.
--
--  Passa a devolver o total do pedido. A frase do e-mail decide a
--  partir dele: pagamento confirmado, com o valor, quando houve
--  cobrança; ingresso confirmado, sem falar em pagamento, quando foi de
--  graça.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- o tipo de retorno muda, e CREATE OR REPLACE não altera assinatura
DROP FUNCTION IF EXISTS fn_pedido_para_email(uuid);

CREATE FUNCTION fn_pedido_para_email(p_pedido uuid)
RETURNS TABLE (
  comprador_nome  text,
  comprador_email text,
  total_centavos  int,
  evento_nome     text,
  local_nome      text,
  data_inicio     date,
  data_fim        date,
  codigo          text,
  lote            text,
  dia             date
)
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT p.comprador_nome,
         p.comprador_email::text,
         p.total_centavos,
         e.nome,
         COALESCE(c.nome, e.local_nome),
         e.data_inicio::date,
         e.data_fim::date,
         i.codigo,
         l.nome,
         l.dia::date
    FROM pedidos  p
    JOIN eventos  e ON e.id = p.evento_id
    LEFT JOIN campos c ON c.id = e.campo_id
    JOIN ingressos i ON i.pedido_id = p.id
    JOIN lotes     l ON l.id = i.lote_id
   -- só pedido pago e ingresso válido: não se manda por e-mail um
   -- ingresso que o portão vai recusar
   WHERE p.id = p_pedido
     AND p.status = 'pago'
     AND i.status = 'valido'
   ORDER BY i.criado_em;
END; $$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION fn_pedido_para_email(uuid) TO apitofut_app;

COMMIT;
