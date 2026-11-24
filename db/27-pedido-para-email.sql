-- =====================================================================
--  27 · O que o e-mail de ingresso precisa saber (RF035)
--
--  O envio acontece quando o pedido é confirmado, e isso acontece em
--  três lugares: no webhook do gateway (sem sessão nenhuma), no
--  checkout gratuito (sem sessão) e na venda de balcão (com sessão).
--  Os dois primeiros não têm contexto de organização, e `pedidos` não
--  tem ramo público no RLS — é o que protege nome, e-mail e documento
--  de quem comprou.
--
--  Daí esta fresta. Ela é diferente de `fn_ingresso_publico`: aquela
--  serve a página aberta a quem tem o link e por isso **esconde** o
--  e-mail; esta serve o servidor, que precisa justamente do e-mail
--  para mandar a mensagem. Por isso não é exposta a nenhuma rota: só o
--  `EmailService` a chama, e o resultado não volta para o cliente.
--
--  Uma linha por ingresso, repetindo os dados do evento. Poderia
--  devolver um objeto aninhado, mas uma tabela plana é o que o
--  TypeScript consome sem ginástica — e a mensagem é curta.
--
--  Idempotente.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_pedido_para_email(p_pedido uuid)
RETURNS TABLE (
  comprador_nome  text,
  comprador_email text,
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
