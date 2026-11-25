-- =====================================================================
--  32 · Inscrição paga: a equipe só entra depois de acertar (RF035)
--
--  Terceira espécie do módulo de dinheiro, e a primeira que encosta no
--  que já funcionava antes dele: competição, categoria e equipe.
--
--  ── POR QUE O PAGAMENTO VAI NO MESMO `pedidos` DOS INGRESSOS ────────
--  A tentação é criar uma tabela de cobrança só para inscrição. Seria
--  mais barato hoje e mais caro para sempre: dinheiro recebido em dois
--  lugares significa duas contas de taxa, dois relatórios de repasse,
--  dois caminhos de webhook e duas bases de cliente — e um dos dois
--  sempre fica para trás quando a regra muda.
--
--  `pedidos` passa a ser o que já era na prática: um PAGAMENTO feito à
--  organização. Ele aponta para um evento (ingresso, ficha) OU para uma
--  inscrição (categoria + equipe), e o banco exige exatamente um dos
--  dois — `ck_pedido_ancora`. Pedido sem âncora não apareceria em
--  relatório nenhum; com as duas, apareceria em dois.
--
--  ── O QUE "TRAVA" SIGNIFICA ─────────────────────────────────────────
--  `categoria_times.situacao`. A equipe entra na categoria como
--  `pendente` quando aquela categoria cobra inscrição, e vira
--  `confirmada` quando o pedido é pago — ou quando o organizador
--  libera na mão (dinheiro, permuta, patrocínio), que é a realidade da
--  várzea e foi decisão do cliente.
--
--  Competição que já existe não muda de comportamento: o padrão do
--  preço é ZERO, e equipe de categoria sem cobrança nasce confirmada.
--  As linhas que já estão na base também nascem `confirmada` — virar
--  tudo pendente esvaziaria tabela de jogos de campeonato em andamento.
--
--  ── POR EQUIPE OU POR ATLETA ────────────────────────────────────────
--  `inscricao_por = 'atleta'` multiplica o preço pelo número de atletas
--  inscritos NO MOMENTO EM QUE A COBRANÇA É GERADA, e isso é decisão,
--  não esquecimento: o elenco continua mexendo depois do pagamento, e
--  cobrar retroativamente por um atleta que entrou na semana seguinte
--  exigiria uma segunda cobrança que ninguém pediu. O organizador vê a
--  conta na tela ("12 atletas × R$ 30,00") e decide quando emitir.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Quanto custa inscrever, e por cabeça ou por equipe
--
--  Vive na configuração da categoria, ao lado de `max_atletas` e
--  `inscricoes_abertas`: é ali que o organizador decide como aquela
--  categoria recebe gente. Zero é inscrição gratuita, que é o
--  comportamento de hoje e segue sendo o padrão.
-- ---------------------------------------------------------------------

ALTER TABLE categoria_inscricao_config
  ADD COLUMN IF NOT EXISTS inscricao_preco_centavos int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inscricao_por text NOT NULL DEFAULT 'equipe';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inscricao_preco') THEN
    ALTER TABLE categoria_inscricao_config ADD CONSTRAINT ck_inscricao_preco
      CHECK (inscricao_preco_centavos >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_inscricao_por') THEN
    ALTER TABLE categoria_inscricao_config ADD CONSTRAINT ck_inscricao_por
      CHECK (inscricao_por IN ('equipe', 'atleta'));
  END IF;
END $$;

COMMENT ON COLUMN categoria_inscricao_config.inscricao_preco_centavos IS
  'Quanto custa inscrever nesta categoria. ZERO = gratuita, que é o padrão e o comportamento de toda competição anterior a esta migration.';

COMMENT ON COLUMN categoria_inscricao_config.inscricao_por IS
  'equipe = valor único por equipe; atleta = valor multiplicado pelo número de atletas inscritos quando a cobrança é gerada.';


-- ---------------------------------------------------------------------
-- 2. A equipe na categoria passa a ter situação
-- ---------------------------------------------------------------------

ALTER TABLE categoria_times
  ADD COLUMN IF NOT EXISTS situacao text NOT NULL DEFAULT 'confirmada',
  ADD COLUMN IF NOT EXISTS liberado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS liberado_em timestamptz,
  ADD COLUMN IF NOT EXISTS liberacao_motivo text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_categoria_time_situacao'
  ) THEN
    ALTER TABLE categoria_times ADD CONSTRAINT ck_categoria_time_situacao
      CHECK (situacao IN ('pendente', 'confirmada'));
  END IF;
END $$;

COMMENT ON COLUMN categoria_times.situacao IS
  'pendente = inscrição cobrada e não acertada. A equipe existe e aparece na lista do organizador, mas não entra na geração da tabela.';

COMMENT ON COLUMN categoria_times.liberado_em IS
  'Preenchido só na liberação MANUAL. É o que distingue quem pagou de quem o organizador liberou — e o que impede um estorno de derrubar a liberação.';


-- ---------------------------------------------------------------------
-- 3. Equipe nova nasce pendente onde há cobrança
--
--  No banco e não na aplicação porque há TRÊS portas por onde uma
--  equipe entra numa categoria: o painel do organizador, a área da
--  equipe (código de acesso) e a replicação de categoria. Esquecer a
--  regra numa delas seria inscrição de graça sem ninguém notar.
--
--  O gatilho ignora o que o cliente mandou em `situacao`: numa
--  categoria que cobra, equipe nova é pendente, e a liberação é um ato
--  explícito com autor e data. Dinheiro falha fechado.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_situacao_inicial_da_equipe() RETURNS trigger AS $$
DECLARE
  v_preco int;
BEGIN
  SELECT inscricao_preco_centavos INTO v_preco
    FROM categoria_inscricao_config WHERE categoria_id = NEW.categoria_id;

  -- categoria sem configuração ou sem cobrança: entra confirmada, como
  -- sempre foi
  IF COALESCE(v_preco, 0) > 0 THEN
    NEW.situacao := 'pendente';
    NEW.liberado_por := NULL;
    NEW.liberado_em := NULL;
    NEW.liberacao_motivo := NULL;
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_situacao_inicial_da_equipe ON categoria_times;
CREATE TRIGGER trg_situacao_inicial_da_equipe
  BEFORE INSERT ON categoria_times
  FOR EACH ROW EXECUTE FUNCTION fn_situacao_inicial_da_equipe();


-- ---------------------------------------------------------------------
-- 4. O pedido passa a poder ser de uma inscrição
-- ---------------------------------------------------------------------

ALTER TABLE pedidos ALTER COLUMN evento_id DROP NOT NULL;

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES categorias(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS time_id      uuid REFERENCES times(id)      ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pedido_ancora') THEN
    ALTER TABLE pedidos ADD CONSTRAINT ck_pedido_ancora
      CHECK (
        (evento_id IS NOT NULL AND categoria_id IS NULL AND time_id IS NULL)
        OR
        (evento_id IS NULL AND categoria_id IS NOT NULL AND time_id IS NOT NULL)
      );
  END IF;
END $$;

-- Uma inscrição tem no máximo UM pedido vivo por vez. Dois Pix abertos
-- para a mesma equipe terminariam com a equipe pagando duas vezes e o
-- organizador devendo um estorno. Pedido cancelado fica para trás e não
-- atrapalha a tentativa seguinte.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_da_inscricao
  ON pedidos (categoria_id, time_id)
  WHERE categoria_id IS NOT NULL AND status IN ('aguardando', 'pago');

CREATE INDEX IF NOT EXISTS idx_pedidos_inscricao
  ON pedidos (categoria_id, time_id) WHERE categoria_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 5. RLS: o pedido de inscrição é da organização dona da categoria
--
--  `pedidos` continua sem ramo público: guarda nome, e-mail e documento
--  de quem pagou. O que muda é que agora há duas maneiras de a linha
--  pertencer à organização da sessão.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS p_pedidos ON pedidos;
CREATE POLICY p_pedidos ON pedidos
  USING (
    app_current_org() IS NOT NULL
    AND (
      evento_id IN (SELECT id FROM eventos)
      OR categoria_id IN (SELECT id FROM categorias)
    )
  )
  WITH CHECK (
    evento_id IN (SELECT id FROM eventos)
    OR categoria_id IN (SELECT id FROM categorias)
  );


-- ---------------------------------------------------------------------
-- 6. Pedido pago confirma a inscrição
--
--  Gatilho e não código: o pagamento chega por três caminhos — webhook
--  do gateway, confirmação de pedido gratuito e lançamento do
--  organizador — e a confirmação não pode depender de cada um lembrar
--  de fazê-la.
--
--  O caminho inverso também vale: estorno devolve a equipe para
--  `pendente`. Quem pediu o dinheiro de volta não está inscrito. Mas
--  só volta quem foi confirmado POR PAGAMENTO: liberação manual tem
--  autor e data, e foi uma decisão do organizador que um estorno de
--  cobrança não revoga.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_inscricao_segue_o_pedido() RETURNS trigger AS $$
BEGIN
  IF NEW.categoria_id IS NULL THEN
    RETURN NEW;   -- pedido de evento: não é assunto desta função
  END IF;

  IF NEW.status = 'pago' AND OLD.status <> 'pago' THEN
    UPDATE categoria_times
       SET situacao = 'confirmada'
     WHERE categoria_id = NEW.categoria_id AND time_id = NEW.time_id;

  ELSIF NEW.status IN ('cancelado', 'estornado') AND OLD.status = 'pago' THEN
    UPDATE categoria_times
       SET situacao = 'pendente'
     WHERE categoria_id = NEW.categoria_id
       AND time_id = NEW.time_id
       AND liberado_em IS NULL;
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inscricao_segue_o_pedido ON pedidos;
CREATE TRIGGER trg_inscricao_segue_o_pedido
  AFTER UPDATE OF status ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_inscricao_segue_o_pedido();

-- O lançamento do organizador nasce `pago`: o gatilho de UPDATE não o
-- pegaria, e a equipe ficaria pendente com o dinheiro na mão dele.
CREATE OR REPLACE FUNCTION fn_inscricao_nasce_paga() RETURNS trigger AS $$
BEGIN
  IF NEW.categoria_id IS NOT NULL AND NEW.status = 'pago' THEN
    UPDATE categoria_times
       SET situacao = 'confirmada'
     WHERE categoria_id = NEW.categoria_id AND time_id = NEW.time_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inscricao_nasce_paga ON pedidos;
CREATE TRIGGER trg_inscricao_nasce_paga
  AFTER INSERT ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_inscricao_nasce_paga();


-- ---------------------------------------------------------------------
-- 7. A conta da taxa, agora sem depender de evento
--
--  `fn_precifica_pedido` continua existindo com a mesma assinatura e o
--  mesmo resultado; o miolo sai para uma função pura que a inscrição
--  também usa. Duas cópias de uma fórmula de dinheiro é como se chega
--  a dois valores diferentes para a mesma venda.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_aplica_taxa(
  p_modelo     text,
  p_percentual numeric,
  p_fixa       int,
  p_subtotal   int
) RETURNS TABLE (total_centavos int, taxa_centavos int) AS $$
DECLARE
  v_taxa int;
BEGIN
  -- entrada franca não paga taxa, nem a parte fixa
  IF p_subtotal <= 0 OR p_modelo = 'isento' THEN
    RETURN QUERY SELECT p_subtotal, 0;
    RETURN;
  END IF;

  -- arredonda para o centavo mais próximo: 10% de R$ 9,99 são 99,9
  -- centavos, e meio centavo não existe em boleto nem em Pix
  v_taxa := round(p_subtotal * p_percentual / 100.0)::int + p_fixa;

  IF p_modelo = 'comprador' THEN
    -- a taxa entra POR CIMA: o organizador recebe o preço cheio
    RETURN QUERY SELECT p_subtotal + v_taxa, v_taxa;
  ELSE
    -- o organizador absorve: o comprador paga o preço, o repasse encolhe.
    -- O teto é o subtotal porque repasse negativo não é representável e
    -- `ck_pedido_taxa` recusaria a linha
    RETURN QUERY SELECT p_subtotal, least(v_taxa, p_subtotal);
  END IF;
END; $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_precifica_pedido(
  p_evento_id uuid,
  p_subtotal_centavos int
) RETURNS TABLE (total_centavos int, taxa_centavos int) AS $$
DECLARE
  v_modelo     text;
  v_percentual numeric(5,2);
  v_fixa       int;
BEGIN
  SELECT e.taxa_modelo::text,
         COALESCE(e.taxa_percentual,    c.taxa_percentual),
         COALESCE(e.taxa_fixa_centavos, c.taxa_fixa_centavos)
    INTO v_modelo, v_percentual, v_fixa
    FROM eventos e
    CROSS JOIN configuracao_plataforma c
   WHERE e.id = p_evento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento não encontrado.' USING ERRCODE = 'AF033';
  END IF;

  RETURN QUERY
    SELECT t.total_centavos, t.taxa_centavos
      FROM fn_aplica_taxa(v_modelo, v_percentual, v_fixa, p_subtotal_centavos) t;
END; $$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------
-- 8. Quanto a equipe deve, e com quanto de taxa
--
--  O subtotal é lido do banco, nunca do corpo da requisição — mesma
--  regra do ingresso. Quem pede a cobrança diz QUEM está inscrevendo;
--  quanto custa é daqui.
--
--  A inscrição cobra a taxa do COMPRADOR, sempre, e isso não é
--  configurável como no evento. Quem paga a inscrição é a equipe, e a
--  liga que organiza não tem por que absorver taxa de quem está
--  entrando no campeonato dela. O dia em que alguém pedir o contrário,
--  é uma coluna em `categoria_inscricao_config` e uma linha aqui.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_valor_da_inscricao(
  p_categoria_id uuid,
  p_time_id      uuid
) RETURNS TABLE (
  subtotal_centavos int,
  unitario_centavos int,
  quantidade        int,
  por               text,
  total_centavos    int,
  taxa_centavos     int
) AS $$
DECLARE
  v_preco int;
  v_por   text;
  v_qtd   int;
BEGIN
  SELECT cfg.inscricao_preco_centavos, cfg.inscricao_por
    INTO v_preco, v_por
    FROM categoria_inscricao_config cfg
   WHERE cfg.categoria_id = p_categoria_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria sem configuração de inscrição.'
      USING ERRCODE = 'AF040';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM categoria_times ct
     WHERE ct.categoria_id = p_categoria_id AND ct.time_id = p_time_id
  ) THEN
    RAISE EXCEPTION 'Equipe não está inscrita nesta categoria.'
      USING ERRCODE = 'AF041';
  END IF;

  IF v_por = 'atleta' THEN
    SELECT count(*) INTO v_qtd
      FROM inscricoes i
     WHERE i.categoria_id = p_categoria_id AND i.time_id = p_time_id;
  ELSE
    v_qtd := 1;
  END IF;

  RETURN QUERY
    SELECT (v_preco * v_qtd)::int,
           v_preco,
           v_qtd,
           v_por,
           t.total_centavos,
           t.taxa_centavos
      FROM configuracao_plataforma c
      CROSS JOIN fn_aplica_taxa('comprador', c.taxa_percentual,
                                c.taxa_fixa_centavos, (v_preco * v_qtd)::int) t;
END; $$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION fn_aplica_taxa(text, numeric, int, int) TO apitofut_app;
GRANT EXECUTE ON FUNCTION fn_valor_da_inscricao(uuid, uuid) TO apitofut_app;

COMMIT;
