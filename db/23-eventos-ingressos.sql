-- =====================================================================
--  APITOFUT — Migration 23: eventos e ingressos (RF035)
--
--  Primeiro módulo do sistema que movimenta DINHEIRO. Até aqui o pior
--  defeito possível era um número errado numa tabela; a partir daqui é
--  alguém pagar e não entrar, ou entrar duas vezes com o mesmo ingresso.
--  As regras que protegem isso moram aqui, no banco, e não no código.
--
--  ── O NÚCLEO É GENÉRICO DE PROPÓSITO ───────────────────────────────
--  Ingresso, inscrição de atleta e ficha de consumo são a MESMA coisa:
--  algo vendido, que vira um código no celular de alguém, que é
--  queimado num ponto de atendimento. Por isso `lotes.especie` existe
--  desde já, mesmo com um valor só em uso — quando a inscrição e a
--  ficha entrarem, elas são configuração, não um sistema novo.
--
--  ── DECISÕES DO CLIENTE QUE O MODELO CARREGA ───────────────────────
--  A plataforma RECEBE e REPASSA (não é o organizador que recebe). Por
--  isso o pedido guarda `taxa_centavos` — a parte da plataforma — e o
--  repasse ao organizador é coluna GERADA, para não existirem duas
--  verdades sobre quanto alguém tem a receber.
--
--  ── TRÊS COISAS QUE SÓ O BANCO CONSEGUE GARANTIR ───────────────────
--   1. Não vender mais que o lote (`fn_valida_estoque_do_lote`): dois
--      compradores simultâneos no último ingresso. A contagem na
--      aplicação não resolve — duas transações contam 9 de 10 ao mesmo
--      tempo e ambas gravam. O gatilho trava a linha do lote.
--   2. Não queimar o mesmo ingresso duas vezes no mesmo dia
--      (`uq_checkin_do_dia`): dois portões lendo o mesmo QR no mesmo
--      instante. Um grava, o outro recebe violação de unicidade e a API
--      traduz em "já utilizado", com a hora da primeira leitura.
--   3. Não deixar ingresso em pé sem pedido pago (ver as políticas e o
--      gatilho de cancelamento).
--
--  ── PRIVACIDADE ────────────────────────────────────────────────────
--  `pedidos` e `ingressos` guardam nome, e-mail e documento de quem
--  comprou. NENHUM deles é legível em contexto público: quem tem o
--  código do ingresso lê por `fn_ingresso_publico`, fresta SECURITY
--  DEFINER que devolve só o que a pessoa precisa ver do próprio
--  ingresso — e nunca o documento nem o e-mail.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_evento') THEN
    CREATE TYPE status_evento AS ENUM
      ('rascunho', 'publicado', 'encerrado', 'cancelado');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_pedido') THEN
    CREATE TYPE status_pedido AS ENUM
      ('aguardando', 'pago', 'cancelado', 'estornado');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_ingresso') THEN
    CREATE TYPE status_ingresso AS ENUM ('valido', 'cancelado');
  END IF;

  -- o que o lote vende. Só `ingresso` é usado hoje; os outros dois
  -- existem porque o núcleo foi desenhado para eles (ver cabeçalho)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'especie_de_lote') THEN
    CREATE TYPE especie_de_lote AS ENUM ('ingresso', 'inscricao', 'ficha');
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 2. Evento
--
--  Raiz da árvore, como `competicoes`: tem `organizacao_id` direto e a
--  própria regra de visibilidade pública. `competicao_id` é OPCIONAL —
--  há evento que não é campeonato (festival, clínica, amistoso), e
--  amarrar os dois obrigaria a inventar uma competição de mentira.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS eventos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id  uuid NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  competicao_id   uuid          REFERENCES competicoes(id)  ON DELETE SET NULL,
  criado_por      uuid          REFERENCES usuarios(id)     ON DELETE SET NULL,

  nome            text NOT NULL,
  slug            text NOT NULL,              -- endereço público do evento
  descricao       text,

  -- local: campo cadastrado quando houver, texto livre quando for fora
  campo_id        uuid REFERENCES campos(id) ON DELETE SET NULL,
  local_nome      text,
  estado          char(2),
  cidade          text,

  data_inicio     date NOT NULL,
  data_fim        date NOT NULL,              -- igual ao início em evento de um dia
  abertura_portoes time,

  imagem_url      text,
  status          status_evento NOT NULL DEFAULT 'rascunho',
  publicado_em    timestamptz,
  excluido_em     timestamptz,

  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_evento_periodo CHECK (data_fim >= data_inicio)
);

-- slug só precisa ser único entre os eventos VIVOS: um evento excluído
-- não deve segurar o endereço para sempre
CREATE UNIQUE INDEX IF NOT EXISTS uq_evento_slug
  ON eventos (lower(slug)) WHERE excluido_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_eventos_org
  ON eventos (organizacao_id) WHERE excluido_em IS NULL;

COMMENT ON COLUMN eventos.competicao_id IS
  'Opcional: evento pode não pertencer a competição nenhuma.';


-- ---------------------------------------------------------------------
-- 3. Lote — o que se vende
--
--  `dia` NULL vale para o evento inteiro (passe); com data, vale só
--  naquele dia. É o que sustenta o "matar o ingresso DO DIA": num
--  passe de três dias o mesmo ingresso é queimado três vezes, uma por
--  dia, e nunca duas no mesmo.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id       uuid NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,

  especie         especie_de_lote NOT NULL DEFAULT 'ingresso',
  nome            text NOT NULL,                    -- "Inteira", "Meia", "1º lote"
  descricao       text,

  -- dinheiro em CENTAVOS, inteiro. Nunca float: 0.1 + 0.2 não é 0.3, e
  -- num sistema que repassa dinheiro isso vira diferença de caixa
  preco_centavos  int NOT NULL CHECK (preco_centavos >= 0),

  quantidade      int CHECK (quantidade IS NULL OR quantidade > 0),  -- NULL = sem limite
  max_por_pedido  int NOT NULL DEFAULT 10 CHECK (max_por_pedido > 0),

  dia             date,                             -- NULL = vale o evento inteiro
  vendas_inicio   timestamptz,
  vendas_fim      timestamptz,

  ordem           int     NOT NULL DEFAULT 0,
  ativo           boolean NOT NULL DEFAULT true,

  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_lote_janela CHECK (
    vendas_inicio IS NULL OR vendas_fim IS NULL OR vendas_fim > vendas_inicio
  )
);

CREATE INDEX IF NOT EXISTS idx_lotes_evento ON lotes (evento_id, ordem);

COMMENT ON COLUMN lotes.dia IS
  'Dia específico do evento, ou NULL para passe que vale todos os dias.';


-- ---------------------------------------------------------------------
-- 4. Pedido
--
--  Compra como visitante: ninguém cria conta para comprar ingresso.
--  O e-mail é por onde o ingresso chega e por onde a pessoa o recupera.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pedidos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id          uuid NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,

  comprador_nome     text   NOT NULL,
  comprador_email    citext NOT NULL,
  comprador_telefone text,
  comprador_documento text,                   -- CPF; opcional, pedido por lote

  total_centavos     int NOT NULL CHECK (total_centavos >= 0),

  -- a plataforma recebe e repassa: `taxa` é a parte dela. O repasse é
  -- GERADO para não haver duas verdades sobre quanto o organizador tem
  -- a receber — a conta nunca sai de sincronia com o total
  taxa_centavos      int NOT NULL DEFAULT 0 CHECK (taxa_centavos >= 0),
  repasse_centavos   int GENERATED ALWAYS AS (total_centavos - taxa_centavos) STORED,

  status             status_pedido NOT NULL DEFAULT 'aguardando',
  -- 'balcao' é a venda que o organizador lança na mão (e a cortesia);
  -- 'online' é a que vem do portal e passa por gateway
  origem             text NOT NULL DEFAULT 'balcao',
  registrado_por     uuid REFERENCES usuarios(id) ON DELETE SET NULL,

  pago_em            timestamptz,
  cancelado_em       timestamptz,
  observacoes        text,

  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_pedido_taxa   CHECK (taxa_centavos <= total_centavos),
  CONSTRAINT ck_pedido_origem CHECK (origem IN ('balcao', 'online'))
);

CREATE INDEX IF NOT EXISTS idx_pedidos_evento ON pedidos (evento_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_email  ON pedidos (comprador_email);


-- ---------------------------------------------------------------------
-- 5. Ingresso
--
--  `codigo` é A CREDENCIAL do portão: quem o tem, entra. Por isso ele é
--  gerado com aleatoriedade criptográfica na API (nunca sequencial) e é
--  único na base inteira — o leitor não precisa saber de qual evento o
--  QR é para encontrá-lo.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingressos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id     uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  lote_id       uuid NOT NULL REFERENCES lotes(id),   -- sem CASCADE: lote vendido não some

  codigo        text NOT NULL,
  titular_nome  text,                                  -- nominal quando o lote exigir

  status        status_ingresso NOT NULL DEFAULT 'valido',
  cancelado_em  timestamptz,

  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ingresso_codigo ON ingressos (codigo);
CREATE INDEX IF NOT EXISTS idx_ingressos_pedido ON ingressos (pedido_id);
CREATE INDEX IF NOT EXISTS idx_ingressos_lote   ON ingressos (lote_id);

COMMENT ON COLUMN ingressos.codigo IS
  'Credencial do portão. Aleatório, nunca sequencial — quem adivinha, entra.';


-- ---------------------------------------------------------------------
-- 6. Check-in — a baixa no portão
--
--  `uq_checkin_do_dia` é a regra inteira: um ingresso, um check-in por
--  dia. Dois portões lendo o mesmo QR ao mesmo tempo não é hipótese, é
--  o normal numa entrada com duas filas. Um grava; o outro bate na
--  unicidade e a API responde "já utilizado", dizendo a hora.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingresso_checkins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingresso_id    uuid NOT NULL REFERENCES ingressos(id) ON DELETE CASCADE,
  dia            date NOT NULL,
  registrado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  registrado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin_do_dia
  ON ingresso_checkins (ingresso_id, dia);

COMMENT ON INDEX uq_checkin_do_dia IS
  'Um ingresso entra uma vez por dia. É esta linha que impede a entrada dupla.';


-- ---------------------------------------------------------------------
-- 7. Estoque do lote
--
--  Dois compradores no último ingresso é a falha clássica de bilheteria.
--  Contar na aplicação não resolve: duas transações leem "9 de 10" ao
--  mesmo tempo e as duas gravam. Aqui a linha do lote é TRAVADA antes
--  da contagem, o que serializa só quem disputa aquele lote.
--
--  Ingresso cancelado não ocupa vaga: devolver ao estoque é o
--  comportamento esperado de quem estorna uma compra.
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
    FROM ingressos
   WHERE lote_id = NEW.lote_id
     AND status = 'valido'
     AND id <> NEW.id;

  IF v_emitidos >= v_limite THEN
    RAISE EXCEPTION 'Lote esgotado: % de % já emitidos.', v_emitidos, v_limite
      USING ERRCODE = 'AF030';
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_estoque_do_lote ON ingressos;
CREATE TRIGGER trg_estoque_do_lote
  BEFORE INSERT ON ingressos
  FOR EACH ROW EXECUTE FUNCTION fn_valida_estoque_do_lote();


-- ---------------------------------------------------------------------
-- 8. O ingresso é do evento do seu pedido
--
--  Sem isto, um pedido do evento A poderia receber ingresso de um lote
--  do evento B — e o portão do A aceitaria. O RLS não barra: os dois
--  eventos podem ser da mesma organização.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_valida_lote_do_pedido() RETURNS trigger AS $$
DECLARE
  v_do_pedido uuid;
  v_do_lote   uuid;
BEGIN
  SELECT evento_id INTO v_do_pedido FROM pedidos WHERE id = NEW.pedido_id;
  SELECT evento_id INTO v_do_lote   FROM lotes   WHERE id = NEW.lote_id;

  IF v_do_pedido IS DISTINCT FROM v_do_lote THEN
    RAISE EXCEPTION 'O lote é de outro evento.' USING ERRCODE = 'AF031';
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lote_do_pedido ON ingressos;
CREATE TRIGGER trg_lote_do_pedido
  BEFORE INSERT OR UPDATE OF lote_id, pedido_id ON ingressos
  FOR EACH ROW EXECUTE FUNCTION fn_valida_lote_do_pedido();


-- ---------------------------------------------------------------------
-- 9. Cancelar o pedido cancela os ingressos dele
--
--  No código isso seria duas escritas que podem divergir; aqui é uma
--  consequência. Ingresso de pedido cancelado continuaria abrindo o
--  portão — é o pior defeito possível neste módulo.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_cancela_ingressos_do_pedido() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('cancelado', 'estornado')
     AND OLD.status NOT IN ('cancelado', 'estornado') THEN
    UPDATE ingressos
       SET status = 'cancelado', cancelado_em = now()
     WHERE pedido_id = NEW.id AND status = 'valido';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cancela_ingressos ON pedidos;
CREATE TRIGGER trg_cancela_ingressos
  AFTER UPDATE OF status ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_cancela_ingressos_do_pedido();


-- ---------------------------------------------------------------------
-- 10. Row Level Security
--
--  `eventos` é raiz e repete a regra de `competicoes`: com contexto,
--  tudo da própria organização; sem contexto, só o que é público.
--
--  `pedidos` e `ingressos` NÃO têm ramo público. Eles carregam nome,
--  e-mail e documento de quem comprou — o portal lê o ingresso por
--  fresta controlada (item 11), com o código em mãos e sem dado pessoal.
-- ---------------------------------------------------------------------

ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_eventos ON eventos;
CREATE POLICY p_eventos ON eventos
  USING (
    excluido_em IS NULL
    AND CASE
      WHEN app_current_org() IS NOT NULL THEN organizacao_id = app_current_org()
      ELSE status IN ('publicado', 'encerrado')
    END
  )
  WITH CHECK (organizacao_id = app_current_org());

ALTER TABLE lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lotes ON lotes;
CREATE POLICY p_lotes ON lotes
  USING (evento_id IN (SELECT id FROM eventos))
  WITH CHECK (evento_id IN (SELECT id FROM eventos));

-- pedidos e ingressos: SÓ com contexto de organização
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pedidos ON pedidos;
CREATE POLICY p_pedidos ON pedidos
  USING (
    app_current_org() IS NOT NULL
    AND evento_id IN (SELECT id FROM eventos)
  )
  WITH CHECK (evento_id IN (SELECT id FROM eventos));

ALTER TABLE ingressos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingressos FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ingressos ON ingressos;
CREATE POLICY p_ingressos ON ingressos
  USING (pedido_id IN (SELECT id FROM pedidos))
  WITH CHECK (pedido_id IN (SELECT id FROM pedidos));

ALTER TABLE ingresso_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingresso_checkins FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ingresso_checkins ON ingresso_checkins;
CREATE POLICY p_ingresso_checkins ON ingresso_checkins
  USING (ingresso_id IN (SELECT id FROM ingressos))
  WITH CHECK (ingresso_id IN (SELECT id FROM ingressos));


-- ---------------------------------------------------------------------
-- 11. Fresta: o comprador vê o próprio ingresso
--
--  Mesma figura de `fn_busca_usuario_login` — o portal não tem contexto
--  de organização, e aqui não deve mesmo ter. A credencial é o código.
--
--  O que ela NÃO devolve, de propósito: e-mail, telefone e documento do
--  comprador, e o valor pago. A página do ingresso serve para entrar no
--  evento; quem abre o link não precisa provar quem é para ver o QR, e
--  é justamente por isso que não pode haver dado pessoal ali.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_ingresso_publico(p_codigo text)
RETURNS TABLE (
  codigo         text,
  titular_nome   text,
  status         text,
  lote_nome      text,
  dia            date,
  evento_nome    text,
  evento_slug    text,
  evento_status  text,
  data_inicio    date,
  data_fim       date,
  local_nome     text,
  cidade         text,
  estado         char(2),
  abertura       time,
  usado_em       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.codigo,
         i.titular_nome,
         i.status::text,
         l.nome,
         l.dia,
         e.nome,
         e.slug,
         e.status::text,
         e.data_inicio,
         e.data_fim,
         coalesce(e.local_nome, c.nome),
         e.cidade,
         e.estado,
         e.abertura_portoes,
         (SELECT max(ck.registrado_em)
            FROM ingresso_checkins ck
           WHERE ck.ingresso_id = i.id)
    FROM ingressos i
    JOIN pedidos  p ON p.id = i.pedido_id
    JOIN lotes    l ON l.id = i.lote_id
    JOIN eventos  e ON e.id = p.evento_id
    LEFT JOIN campos c ON c.id = e.campo_id
   WHERE i.codigo = p_codigo
     AND e.excluido_em IS NULL
     -- pedido não pago não tem ingresso para mostrar
     AND p.status = 'pago';
$$;

REVOKE ALL ON FUNCTION fn_ingresso_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_ingresso_publico(text) TO apitofut_app;

COMMENT ON FUNCTION fn_ingresso_publico(text) IS
  'Ingresso visto por quem tem o código. Nunca devolve dado pessoal do comprador.';


-- ---------------------------------------------------------------------
-- 12. Evento com ingresso vendido não é apagado
--
--  O DELETE levaria pedidos e ingressos em cascata: alguém pagou e o
--  registro some. Mesma postura de organização e competição.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_protege_evento_vendido() RETURNS trigger AS $$
DECLARE
  v_vendidos int;
BEGIN
  SELECT count(*) INTO v_vendidos
    FROM ingressos i JOIN pedidos p ON p.id = i.pedido_id
   WHERE p.evento_id = OLD.id;

  IF v_vendidos > 0 THEN
    RAISE EXCEPTION
      'O evento % tem % ingresso(s) emitido(s). Use exclusão lógica (excluido_em) — DELETE apagaria a venda.',
      OLD.nome, v_vendidos
      USING ERRCODE = 'AF032';
  END IF;

  RETURN OLD;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protege_evento ON eventos;
CREATE TRIGGER trg_protege_evento
  BEFORE DELETE ON eventos
  FOR EACH ROW EXECUTE FUNCTION fn_protege_evento_vendido();


-- ---------------------------------------------------------------------
-- 13. atualizado_em
-- ---------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['eventos', 'lotes', 'pedidos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION fn_touch()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 14. Slug do evento
--
--  Mesma figura de `fn_competicao_slug` (migration 03), reusando
--  `fn_slugify`: quem gera o endereço público é o banco, não cada rota
--  que cria evento. A diferença é o desempate — aqui ele só olha os
--  eventos VIVOS, porque o índice único também ignora os excluídos.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_evento_slug() RETURNS trigger AS $$
DECLARE
  base text;
  cand text;
  n    int := 1;
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    base := fn_slugify(NEW.nome);
    IF base = '' THEN base := 'evento'; END IF;
    cand := base;
    WHILE EXISTS (
      SELECT 1 FROM eventos
       WHERE lower(slug) = cand AND id <> NEW.id AND excluido_em IS NULL
    ) LOOP
      n := n + 1;
      cand := base || '-' || n;
    END LOOP;
    NEW.slug := cand;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evento_slug ON eventos;
CREATE TRIGGER trg_evento_slug
  BEFORE INSERT ON eventos
  FOR EACH ROW EXECUTE FUNCTION fn_evento_slug();

COMMIT;
