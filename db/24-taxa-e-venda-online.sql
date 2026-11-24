-- =====================================================================
--  24 · Modelo de taxa e fundação da venda online (RF035, fase 2)
--
--  A migration 23 montou a bilheteria de balcão. Esta prepara a venda
--  pela internet: quanto a plataforma cobra, quem paga, e como um
--  pedido fica reservado enquanto o comprador não paga.
--
--  ── DUAS AUTORIDADES DIFERENTES, DE PROPÓSITO ──────────────────────
--  Quem decide **quem paga** a taxa é o ORGANIZADOR, por evento:
--  repassar ao comprador (preço + taxa), absorver (recebe menos) ou
--  isentar. É decisão comercial dele, e muda de evento para evento.
--
--  Quem decide **quanto é** a taxa é a PLATAFORMA. Há um padrão (10%)
--  e um ajuste por evento, que só o `superadmin` altera — é contrato
--  comercial, não configuração de tela. Por isso o ajuste passa por
--  função SECURITY DEFINER que reconfere o perfil no banco, como já
--  fazem as funções da área do ADM (migration 15).
--
--  ── POR QUE A CONTA MORA AQUI, E NÃO NO TYPESCRIPT ─────────────────
--  O mesmo número aparece em três lugares: na tela do comprador
--  ("você vai pagar R$ 110,00"), no pedido gravado e no relatório de
--  repasse. Com a fórmula no código, bastaria um deles ser calculado
--  noutro ponto para divergirem — e divergência em dinheiro só se
--  descobre quando alguém reclama. `fn_precifica_pedido` é a única
--  fonte; o módulo `taxa.ts` existe só para a tela mostrar antes, e um
--  teste confere que os dois concordam.
--
--  ── RESERVA: O QUE SEGURA O INGRESSO ATÉ O PIX CAIR ────────────────
--  O pedido online nasce `aguardando` COM os ingressos já emitidos.
--  Isso não é descuido: `trg_estoque_do_lote` conta ingresso, então a
--  emissão já segura a vaga, e `portaria.service` recusa ingresso cujo
--  pedido não esteja `pago` ("Pagamento não confirmado"). Ou seja, a
--  reserva funciona sem nenhum conceito novo.
--
--  Faltava o reverso: carrinho abandonado não pode tirar o ingresso do
--  mercado para sempre. Por isso `pedidos.expira_em`, e a contagem de
--  estoque passa a ignorar reserva vencida. A vaga volta sozinha, sem
--  depender de rotina agendada que pode não estar rodando.
--
--  ── O CHECKOUT PÚBLICO NÃO GANHA CONTEXTO DE ORGANIZAÇÃO ───────────
--  Quem compra não está logado, e `pedidos` não tem ramo público no
--  RLS (guarda nome, e-mail e documento). A saída NÃO é a API assumir
--  a organização do evento numa requisição anônima — isso daria a um
--  caminho público o poder inteiro da organização. É uma fresta
--  estreita, `fn_criar_pedido_online`, que faz uma coisa só: grava um
--  pedido `aguardando` com preço lido do banco. O mesmo vale para o
--  webhook, que também chega sem sessão.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'modelo_de_taxa') THEN
    CREATE TYPE modelo_de_taxa AS ENUM ('comprador', 'organizador', 'isento');
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 2. Configuração da plataforma — linha única
--
--  `id boolean PRIMARY KEY CHECK (id)` é o jeito de o banco garantir
--  que existe no máximo UMA linha: o único valor aceito é `true`.
--  Tabela de configuração com várias linhas vira pergunta sobre qual
--  delas vale.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS configuracao_plataforma (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),

  -- padrão cobrado quando o evento não tem ajuste próprio
  taxa_percentual    numeric(5,2) NOT NULL DEFAULT 10
                       CHECK (taxa_percentual >= 0 AND taxa_percentual <= 100),
  taxa_fixa_centavos int NOT NULL DEFAULT 0 CHECK (taxa_fixa_centavos >= 0),

  -- quanto tempo uma reserva não paga segura o ingresso
  reserva_minutos    int NOT NULL DEFAULT 30 CHECK (reserva_minutos BETWEEN 5 AND 1440),

  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_por     uuid REFERENCES usuarios(id) ON DELETE SET NULL
);

INSERT INTO configuracao_plataforma (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------
-- 3. O evento ganha o modelo de taxa e o ajuste da plataforma
-- ---------------------------------------------------------------------

ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS taxa_modelo modelo_de_taxa NOT NULL DEFAULT 'comprador';

-- NULL = usa o padrão da plataforma. Não repetir o padrão em cada
-- evento é o que permite mudá-lo num lugar só depois.
ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS taxa_percentual numeric(5,2),
  ADD COLUMN IF NOT EXISTS taxa_fixa_centavos int;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_evento_taxa_percentual'
  ) THEN
    ALTER TABLE eventos ADD CONSTRAINT ck_evento_taxa_percentual
      CHECK (taxa_percentual IS NULL
             OR (taxa_percentual >= 0 AND taxa_percentual <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_evento_taxa_fixa'
  ) THEN
    ALTER TABLE eventos ADD CONSTRAINT ck_evento_taxa_fixa
      CHECK (taxa_fixa_centavos IS NULL OR taxa_fixa_centavos >= 0);
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 4. O pedido ganha o que a venda online precisa
-- ---------------------------------------------------------------------

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS expira_em          timestamptz,
  ADD COLUMN IF NOT EXISTS metodo             text,
  ADD COLUMN IF NOT EXISTS asaas_cobranca_id  text,
  -- o "copia e cola" do Pix. Guardado para a página do comprador não
  -- custar uma ida ao gateway a cada recarga — e para continuar
  -- funcionando se o gateway oscilar enquanto a fila anda
  ADD COLUMN IF NOT EXISTS pix_payload        text,
  ADD COLUMN IF NOT EXISTS link_pagamento     text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_pedido_metodo'
  ) THEN
    ALTER TABLE pedidos ADD CONSTRAINT ck_pedido_metodo
      CHECK (metodo IS NULL OR metodo IN ('pix', 'cartao', 'balcao'));
  END IF;
END $$;

-- uma cobrança do gateway pertence a um pedido só: é esta unicidade que
-- torna o webhook seguro de reprocessar
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_cobranca
  ON pedidos (asaas_cobranca_id) WHERE asaas_cobranca_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_expiram
  ON pedidos (expira_em) WHERE status = 'aguardando';


-- ---------------------------------------------------------------------
-- 5. A conta da taxa — fonte única
--
--  Devolve o que o comprador paga e quanto é da plataforma. As três
--  regras que não podem escapar:
--
--   • ingresso gratuito NUNCA gera taxa, nem a parte fixa. Cobrar R$ 1
--     de taxa sobre uma entrada franca seria cobrar pelo nada;
--   • `isento` zera, qualquer que seja o valor;
--   • no modelo `organizador`, a taxa nunca pode passar do subtotal —
--     o `ck_pedido_taxa` recusaria a linha, e o organizador não pode
--     receber um repasse negativo.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_precifica_pedido(
  p_evento_id uuid,
  p_subtotal_centavos int
) RETURNS TABLE (total_centavos int, taxa_centavos int) AS $$
DECLARE
  v_modelo     modelo_de_taxa;
  v_percentual numeric(5,2);
  v_fixa       int;
  v_taxa       int;
BEGIN
  SELECT e.taxa_modelo,
         COALESCE(e.taxa_percentual,    c.taxa_percentual),
         COALESCE(e.taxa_fixa_centavos, c.taxa_fixa_centavos)
    INTO v_modelo, v_percentual, v_fixa
    FROM eventos e
    CROSS JOIN configuracao_plataforma c
   WHERE e.id = p_evento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado.' USING ERRCODE = 'AF033';
  END IF;

  -- entrada franca: sem taxa, ponto final
  IF p_subtotal_centavos <= 0 OR v_modelo = 'isento' THEN
    RETURN QUERY SELECT p_subtotal_centavos, 0;
    RETURN;
  END IF;

  -- arredonda para o centavo mais próximo: 10% de R$ 9,99 são 99,9
  -- centavos, e meio centavo não existe em boleto nem em Pix
  v_taxa := round(p_subtotal_centavos * v_percentual / 100.0)::int + v_fixa;

  IF v_modelo = 'comprador' THEN
    -- a taxa entra POR CIMA: o organizador recebe o preço cheio
    RETURN QUERY SELECT p_subtotal_centavos + v_taxa, v_taxa;
  ELSE
    -- o organizador absorve: o comprador paga o preço, o repasse encolhe
    RETURN QUERY SELECT p_subtotal_centavos, least(v_taxa, p_subtotal_centavos);
  END IF;
END; $$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------
-- 6. Só o ADM da plataforma mexe no quanto
--
--  Mesma postura da migration 15: o botão da tela não é a garantia. A
--  função reconfere o perfil do ator NO BANCO antes de gravar.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_admin_define_taxa(
  p_ator          uuid,
  p_evento_id     uuid,        -- NULL = mexe no padrão da plataforma
  p_percentual    numeric,
  p_fixa_centavos int
) RETURNS void AS $$
DECLARE
  v_perfil text;
BEGIN
  SELECT perfil INTO v_perfil FROM usuarios WHERE id = p_ator;
  IF v_perfil IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Somente o administrador do sistema altera a taxa.'
      USING ERRCODE = 'AF034';
  END IF;

  IF p_percentual IS NOT NULL
     AND (p_percentual < 0 OR p_percentual > 100) THEN
    RAISE EXCEPTION 'Percentual fora da faixa.' USING ERRCODE = 'AF034';
  END IF;
  IF p_fixa_centavos IS NOT NULL AND p_fixa_centavos < 0 THEN
    RAISE EXCEPTION 'Valor fixo não pode ser negativo.' USING ERRCODE = 'AF034';
  END IF;

  IF p_evento_id IS NULL THEN
    UPDATE configuracao_plataforma
       SET taxa_percentual    = COALESCE(p_percentual, taxa_percentual),
           taxa_fixa_centavos = COALESCE(p_fixa_centavos, taxa_fixa_centavos),
           atualizado_em      = now(),
           atualizado_por     = p_ator
     WHERE id;
  ELSE
    -- NULL aqui significa "volta a seguir o padrão da plataforma", e é
    -- por isso que não usa COALESCE: o ADM precisa conseguir limpar
    UPDATE eventos
       SET taxa_percentual    = p_percentual,
           taxa_fixa_centavos = p_fixa_centavos
     WHERE id = p_evento_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Evento não encontrado.' USING ERRCODE = 'AF033';
    END IF;
  END IF;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ---------------------------------------------------------------------
-- 7. Reserva vencida devolve a vaga
--
--  A contagem de estoque passa a ignorar ingresso de pedido `aguardando`
--  cujo prazo passou. Sem isto, um carrinho abandonado seguraria o
--  último ingresso do lote para sempre — e ninguém descobriria até
--  alguém reclamar que o evento "esgotou" com a casa vazia.
--
--  Fica na CONTAGEM, não numa rotina que apaga pedidos: rotina agendada
--  é algo que pode não estar rodando, e aí o estoque mente em silêncio.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_valida_estoque_do_lote() RETURNS trigger AS $$
DECLARE
  v_limite   int;
  v_emitidos int;
BEGIN
  -- FOR UPDATE: sem ele duas vendas simultâneas furam o limite
  SELECT quantidade INTO v_limite
    FROM lotes WHERE id = NEW.lote_id FOR UPDATE;

  IF v_limite IS NULL THEN
    RETURN NEW;  -- lote sem limite
  END IF;

  SELECT count(*) INTO v_emitidos
    FROM ingressos i
    JOIN pedidos  p ON p.id = i.pedido_id
   WHERE i.lote_id = NEW.lote_id
     AND i.status = 'valido'
     AND i.id <> NEW.id
     -- reserva vencida não ocupa vaga
     AND NOT (p.status = 'aguardando'
              AND p.expira_em IS NOT NULL
              AND p.expira_em < now());

  IF v_emitidos >= v_limite THEN
    RAISE EXCEPTION 'Lote esgotado: % de % já emitidos.', v_emitidos, v_limite
      USING ERRCODE = 'AF030';
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 8. Faxina das reservas vencidas
--
--  A contagem acima já libera a vaga; isto só deixa a lista do
--  organizador honesta, trocando `aguardando` vencido por `cancelado`.
--  O gatilho `trg_cancela_ingressos` derruba os ingressos junto.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_expira_pedidos() RETURNS int AS $$
DECLARE
  v_qtd int;
BEGIN
  WITH vencidos AS (
    UPDATE pedidos
       SET status       = 'cancelado',
           cancelado_em = now(),
           observacoes  = concat_ws(' | ', observacoes,
                            'Reserva expirada sem pagamento.')
     WHERE status = 'aguardando'
       AND expira_em IS NOT NULL
       AND expira_em < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_qtd FROM vencidos;
  RETURN v_qtd;
END; $$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 9. Idempotência do webhook
--
--  Gateway reenvia. O Asaas repete a notificação até receber 200, e um
--  reprocessamento pode chegar enquanto o primeiro ainda está rodando.
--  A chave primária é o id do evento no gateway: quem perder a corrida
--  recebe violação de unicidade, e a API responde 200 sem refazer nada.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gateway_notificacoes (
  id           text PRIMARY KEY,          -- id do evento no gateway
  gateway      text NOT NULL DEFAULT 'asaas',
  tipo         text NOT NULL,
  cobranca_id  text,
  recebido_em  timestamptz NOT NULL DEFAULT now(),
  payload      jsonb
);

CREATE INDEX IF NOT EXISTS idx_gateway_notificacoes_cobranca
  ON gateway_notificacoes (cobranca_id);


-- ---------------------------------------------------------------------
-- 10. A fresta do checkout público
--
--  Quem compra não está logado e `pedidos` não tem ramo público no RLS.
--  Esta função faz UMA coisa: grava um pedido `aguardando` com os
--  ingressos reservados, e com o preço lido do banco — o cliente diz
--  qual lote e quantos, nunca quanto custa.
--
--  Os códigos vêm de fora (`p_codigos`) porque o alfabeto do ingresso
--  mora em `eventos/codigo.ts`, e tê-lo também aqui criaria duas
--  verdades sobre o que é um código válido. Colisão estoura a
--  unicidade e quem chamou tenta de novo com outros códigos.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_criar_pedido_online(
  p_evento_id uuid,
  p_itens     jsonb,     -- [{"loteId":"…","quantidade":2,"titulares":["…"]}]
  p_codigos   text[],    -- um por ingresso, na ordem dos itens
  p_nome      text,
  p_email     text,
  p_telefone  text,
  p_documento text
) RETURNS TABLE (
  pedido_id      uuid,
  total_centavos int,
  taxa_centavos  int,
  expira_em      timestamptz,
  codigos        text[]
) AS $$
DECLARE
  v_evento    eventos%ROWTYPE;
  v_item      jsonb;
  v_lote      lotes%ROWTYPE;
  v_qtd       int;
  v_subtotal  int := 0;
  v_total     int;
  v_taxa      int;
  v_minutos   int;
  v_expira    timestamptz;
  v_pedido    uuid;
  v_i         int := 0;
  v_j         int;
  v_titular   text;
BEGIN
  SELECT * INTO v_evento FROM eventos WHERE id = p_evento_id;
  IF NOT FOUND OR v_evento.excluido_em IS NOT NULL THEN
    RAISE EXCEPTION 'Evento não encontrado.' USING ERRCODE = 'AF033';
  END IF;
  IF v_evento.status <> 'publicado' THEN
    RAISE EXCEPTION 'Este evento não está vendendo ingressos.'
      USING ERRCODE = 'AF035';
  END IF;

  IF p_itens IS NULL OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um ingresso.' USING ERRCODE = 'AF035';
  END IF;

  -- primeira passada: valida e soma. O preço SEMPRE do banco
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := (v_item->>'quantidade')::int;

    SELECT * INTO v_lote FROM lotes WHERE id = (v_item->>'loteId')::uuid;
    IF NOT FOUND OR v_lote.evento_id <> p_evento_id THEN
      RAISE EXCEPTION 'Lote não encontrado neste evento.' USING ERRCODE = 'AF031';
    END IF;
    IF NOT v_lote.ativo THEN
      RAISE EXCEPTION 'O lote "%" não está à venda.', v_lote.nome
        USING ERRCODE = 'AF035';
    END IF;
    IF v_lote.vendas_inicio IS NOT NULL AND v_lote.vendas_inicio > now() THEN
      RAISE EXCEPTION 'A venda do lote "%" ainda não começou.', v_lote.nome
        USING ERRCODE = 'AF035';
    END IF;
    IF v_lote.vendas_fim IS NOT NULL AND v_lote.vendas_fim < now() THEN
      RAISE EXCEPTION 'A venda do lote "%" já encerrou.', v_lote.nome
        USING ERRCODE = 'AF035';
    END IF;
    IF v_qtd IS NULL OR v_qtd < 1 OR v_qtd > v_lote.max_por_pedido THEN
      RAISE EXCEPTION 'O lote "%" permite de 1 a % por pedido.',
        v_lote.nome, v_lote.max_por_pedido USING ERRCODE = 'AF035';
    END IF;

    v_subtotal := v_subtotal + v_lote.preco_centavos * v_qtd;
    v_i := v_i + v_qtd;
  END LOOP;

  IF array_length(p_codigos, 1) IS DISTINCT FROM v_i THEN
    RAISE EXCEPTION 'Faltam códigos para os ingressos pedidos.'
      USING ERRCODE = 'AF035';
  END IF;

  -- qualificado pelo alias: os nomes de saída desta função são os
  -- mesmos, e sem o `preco.` o PL/pgSQL não sabe de qual se trata
  SELECT preco.total_centavos, preco.taxa_centavos INTO v_total, v_taxa
    FROM fn_precifica_pedido(p_evento_id, v_subtotal) AS preco;

  SELECT reserva_minutos INTO v_minutos FROM configuracao_plataforma WHERE id;
  v_expira := now() + make_interval(mins => v_minutos);

  INSERT INTO pedidos (evento_id, comprador_nome, comprador_email,
                       comprador_telefone, comprador_documento,
                       total_centavos, taxa_centavos, status, origem, expira_em)
       VALUES (p_evento_id, p_nome, p_email, p_telefone, p_documento,
               v_total, v_taxa, 'aguardando', 'online', v_expira)
    RETURNING id INTO v_pedido;

  -- segunda passada: emite. É aqui que `trg_estoque_do_lote` pode
  -- recusar por lote esgotado, e a transação inteira volta atrás
  v_i := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := (v_item->>'quantidade')::int;
    FOR v_j IN 1..v_qtd LOOP
      v_i := v_i + 1;
      v_titular := nullif(trim(coalesce(
        v_item->'titulares'->>(v_j - 1), '')), '');
      INSERT INTO ingressos (pedido_id, lote_id, codigo, titular_nome)
           VALUES (v_pedido, (v_item->>'loteId')::uuid,
                   p_codigos[v_i], v_titular);
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_pedido, v_total, v_taxa, v_expira, p_codigos;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ---------------------------------------------------------------------
-- 11. Prender a cobrança do gateway ao pedido
--
--  Em duas etapas de propósito: reserva primeiro, cobra depois. Se a
--  ordem fosse a inversa e o lote estivesse esgotado, existiria uma
--  cobrança no gateway sem ingresso do outro lado — dinheiro pedido por
--  algo que não há. Falhando aqui, a reserva simplesmente expira.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_vincula_cobranca(
  p_pedido_id uuid,
  p_cobranca  text,
  p_metodo    text,
  p_link      text,
  p_pix       text
) RETURNS void AS $$
BEGIN
  UPDATE pedidos
     SET asaas_cobranca_id = p_cobranca,
         metodo            = p_metodo,
         link_pagamento    = p_link,
         pix_payload       = p_pix,
         atualizado_em     = now()
   WHERE id = p_pedido_id
     AND status = 'aguardando';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não está aguardando pagamento.'
      USING ERRCODE = 'AF035';
  END IF;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ---------------------------------------------------------------------
-- 12. O que o webhook muda
--
--  Também sem sessão: a notificação chega do gateway, não de um
--  usuário. A função muda só o que o pagamento pode mudar, e recusa
--  transição que não faz sentido — confirmar pedido já cancelado, por
--  exemplo, ressuscitaria ingresso que o portão já recusou.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_aplica_pagamento(
  p_cobranca text,
  p_status   text,       -- 'pago' | 'cancelado' | 'estornado'
  p_quando   timestamptz
) RETURNS uuid AS $$
DECLARE
  v_pedido uuid;
  v_atual  status_pedido;
BEGIN
  SELECT id, status INTO v_pedido, v_atual
    FROM pedidos WHERE asaas_cobranca_id = p_cobranca
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;   -- cobrança que não é nossa: o webhook responde 200
  END IF;

  IF p_status = 'pago' THEN
    IF v_atual <> 'aguardando' THEN
      RETURN v_pedido;   -- já resolvido; reenvio do gateway não refaz
    END IF;
    UPDATE pedidos
       SET status = 'pago', pago_em = COALESCE(p_quando, now()),
           expira_em = NULL, atualizado_em = now()
     WHERE id = v_pedido;

  ELSIF p_status IN ('cancelado', 'estornado') THEN
    IF v_atual IN ('cancelado', 'estornado') THEN
      RETURN v_pedido;
    END IF;
    UPDATE pedidos
       SET status = p_status::status_pedido, cancelado_em = COALESCE(p_quando, now()),
           atualizado_em = now()
     WHERE id = v_pedido;

  ELSE
    RAISE EXCEPTION 'Situação de pagamento desconhecida: %', p_status
      USING ERRCODE = 'AF035';
  END IF;

  RETURN v_pedido;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ---------------------------------------------------------------------
-- 13. Idempotência: registrar a notificação antes de agir
--
--  Devolve `true` quando é a primeira vez. O reenvio perde a corrida na
--  chave primária e recebe `false` — a API responde 200 sem refazer.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_registra_notificacao(
  p_id       text,
  p_tipo     text,
  p_cobranca text,
  p_payload  jsonb
) RETURNS boolean AS $$
BEGIN
  INSERT INTO gateway_notificacoes (id, tipo, cobranca_id, payload)
       VALUES (p_id, p_tipo, p_cobranca, p_payload);
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RETURN false;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ---------------------------------------------------------------------
-- 14. RLS
-- ---------------------------------------------------------------------

-- A configuração da plataforma é lida por qualquer contexto (o portal
-- precisa dela para mostrar o preço final antes da compra), mas não é
-- escrita por ninguém pela porta da frente: só por fn_admin_define_taxa.
ALTER TABLE configuracao_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracao_plataforma FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_configuracao_plataforma ON configuracao_plataforma;
CREATE POLICY p_configuracao_plataforma ON configuracao_plataforma
  FOR SELECT USING (true);

-- Notificação de gateway é registro interno: nenhum contexto a enxerga
-- pela porta da frente. Quem grava é a fresta do webhook.
ALTER TABLE gateway_notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateway_notificacoes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_gateway_notificacoes ON gateway_notificacoes;
CREATE POLICY p_gateway_notificacoes ON gateway_notificacoes
  USING (false) WITH CHECK (false);

GRANT SELECT ON configuracao_plataforma TO apitofut_app;
GRANT SELECT, INSERT ON gateway_notificacoes TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_precifica_pedido(uuid, int) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_admin_define_taxa(uuid, uuid, numeric, int) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_expira_pedidos() TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_criar_pedido_online(uuid, jsonb, text[], text, text, text, text) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_vincula_cobranca(uuid, text, text, text, text) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_aplica_pagamento(text, text, timestamptz) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_registra_notificacao(text, text, text, jsonb) TO apitofut_app;

COMMIT;
