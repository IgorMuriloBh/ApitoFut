-- =====================================================================
--  APITOFUT — Migration 14: suspensão automática por cartões (RF032)
--
--  A tabela `suspensoes` existia desde o schema original e nada a
--  alimentava: cartões eram contados na classificação, mas ninguém
--  gerava a suspensão nem impedia o atleta suspenso de jogar.
--
--  DUAS DIFERENÇAS DELIBERADAS EM RELAÇÃO AO PROTÓTIPO
--
--  1. A suspensão CUMPRE-SE e termina. O protótipo calcula
--     `floor(amarelos / num_amarelos)` a cada consulta — então quem levou
--     3 amarelos fica suspenso para sempre, porque nada marca o
--     cumprimento. Aqui a suspensão é persistida e `jogos_cumpridos`
--     avança a cada jogo que a equipe disputa sem o atleta. É para isso
--     que a coluna existe.
--
--  2. `acumular_dois_amarelos` passa a ter efeito. O protótipo declara a
--     opção, mostra no rótulo e nunca a usa em cálculo nenhum. Leitura
--     adotada, que é a do rótulo ("acumular quando dois amarelos no mesmo
--     jogo?"): com FALSE (padrão), o 2º amarelo do MESMO jogo não conta
--     para o ciclo de acúmulo — ele já resultou em expulsão. Com TRUE,
--     conta.
--
--  MODELO
--   • cada cartão vermelho gera uma suspensão de `jogos_por_vermelho`
--   • a cada `num_amarelos` amarelos válidos, o amarelo que FECHA o ciclo
--     gera uma suspensão de `jogos_por_amarelo`
--   • `evento_origem_id` amarra a suspensão ao cartão que a causou —
--     apagar ou corrigir o cartão desfaz a suspensão
--   • suspensão manual (motivo='manual') nunca é tocada pela automação
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- Uma suspensão automática por cartão de origem. É o que torna a
-- sincronização idempotente e permite desfazer ao apagar o cartão.
CREATE UNIQUE INDEX IF NOT EXISTS uq_suspensao_por_evento
  ON suspensoes (evento_origem_id)
  WHERE evento_origem_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suspensoes_categoria_atleta
  ON suspensoes (categoria_id, atleta_id) WHERE ativa;


-- ---------------------------------------------------------------------
-- Recalcula as suspensões automáticas de um atleta numa categoria.
-- Chamada pelos triggers de cartão; recomputa do zero e converge.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_sincroniza_suspensoes(
  p_categoria uuid,
  p_atleta    uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r categoria_regras%ROWTYPE;
BEGIN
  SELECT * INTO r FROM categoria_regras WHERE categoria_id = p_categoria;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Quais cartões DEVEM gerar suspensão, calculado em uma passada.
  -- `ordinal_no_jogo` distingue o 1º do 2º amarelo da mesma partida.
  WITH cartoes AS (
    SELECT e.id AS evento_id, e.tipo,
           row_number() OVER (
             PARTITION BY e.jogo_id, e.tipo
             ORDER BY e.periodo, e.minuto, e.criado_em, e.id
           ) AS ordinal_no_jogo,
           row_number() OVER (
             ORDER BY j.data NULLS LAST, j.rodada NULLS LAST, j.ordem,
                      e.periodo, e.minuto, e.criado_em, e.id
           ) AS ordem_geral
      FROM jogo_eventos e
      JOIN jogos j ON j.id = e.jogo_id
     WHERE j.categoria_id = p_categoria
       AND e.atleta_id = p_atleta
       AND e.tipo IN ('cartao_amarelo', 'cartao_vermelho')
  ),
  vermelhos AS (
    SELECT evento_id, 'cartao_vermelho'::motivo_suspensao AS motivo,
           r.jogos_por_vermelho AS jogos
      FROM cartoes
     WHERE r.suspensao_ativa
       AND r.jogos_por_vermelho > 0
       AND tipo = 'cartao_vermelho'
  ),
  amarelos_validos AS (
    -- 2º amarelo do mesmo jogo só entra no ciclo se a regra mandar:
    -- sem isso ele contaria duas vezes, já tendo gerado a expulsão
    SELECT evento_id,
           row_number() OVER (ORDER BY ordem_geral) AS n
      FROM cartoes
     WHERE tipo = 'cartao_amarelo'
       AND (r.acumular_dois_amarelos OR ordinal_no_jogo = 1)
  ),
  acumulos AS (
    SELECT evento_id, 'acumulo_amarelos'::motivo_suspensao AS motivo,
           r.jogos_por_amarelo AS jogos
      FROM amarelos_validos
     WHERE r.suspensao_ativa
       AND r.jogos_por_amarelo > 0
       AND r.num_amarelos > 0
       AND n % r.num_amarelos = 0
  ),
  geradores AS (
    SELECT * FROM vermelhos UNION ALL SELECT * FROM acumulos
  ),
  -- some o que falta
  inseridas AS (
    INSERT INTO suspensoes (categoria_id, atleta_id, motivo, evento_origem_id, jogos_suspensao)
    SELECT p_categoria, p_atleta, g.motivo, g.evento_id, g.jogos FROM geradores g
    ON CONFLICT (evento_origem_id) WHERE evento_origem_id IS NOT NULL
    DO UPDATE SET jogos_suspensao = EXCLUDED.jogos_suspensao
    WHERE suspensoes.jogos_cumpridos <= EXCLUDED.jogos_suspensao
    RETURNING 1
  )
  -- e tire o que sobra; suspensão manual fica intocada
  DELETE FROM suspensoes s
   WHERE s.categoria_id = p_categoria
     AND s.atleta_id = p_atleta
     AND s.motivo <> 'manual'
     AND (
       s.evento_origem_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM geradores g WHERE g.evento_id = s.evento_origem_id)
     );
END; $$;


-- ---------------------------------------------------------------------
-- Gatilho: qualquer mexida em cartão ressincroniza o atleta afetado.
-- Nome com `zz_` para rodar depois de trg_placar, mantendo a ordem
-- alfabética que o PostgreSQL usa entre triggers do mesmo evento.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_cartao_sincroniza() RETURNS trigger AS $$
DECLARE
  v_categoria uuid;
BEGIN
  -- linha nova (ou atual)
  IF TG_OP <> 'DELETE' AND NEW.atleta_id IS NOT NULL
     AND NEW.tipo IN ('cartao_amarelo', 'cartao_vermelho') THEN
    SELECT j.categoria_id INTO v_categoria FROM jogos j WHERE j.id = NEW.jogo_id;
    IF v_categoria IS NOT NULL THEN
      PERFORM fn_sincroniza_suspensoes(v_categoria, NEW.atleta_id);
    END IF;
  END IF;

  -- linha anterior: cobre remoção e troca de atleta na edição
  IF TG_OP <> 'INSERT' AND OLD.atleta_id IS NOT NULL
     AND OLD.tipo IN ('cartao_amarelo', 'cartao_vermelho')
     AND (TG_OP = 'DELETE' OR OLD.atleta_id IS DISTINCT FROM NEW.atleta_id) THEN
    SELECT j.categoria_id INTO v_categoria FROM jogos j WHERE j.id = OLD.jogo_id;
    IF v_categoria IS NOT NULL THEN
      PERFORM fn_sincroniza_suspensoes(v_categoria, OLD.atleta_id);
    END IF;
  END IF;

  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zz_cartao_suspensao ON jogo_eventos;
CREATE TRIGGER trg_zz_cartao_suspensao
  AFTER INSERT OR UPDATE OR DELETE ON jogo_eventos
  FOR EACH ROW EXECUTE FUNCTION fn_cartao_sincroniza();


-- ---------------------------------------------------------------------
-- Cumprimento: encerrar um jogo desconta uma partida de quem estava
-- suspenso e NÃO jogou. Quem entrou em campo não cumpriu nada.
--
-- O jogo em que o cartão foi tirado não conta: a suspensão vale a partir
-- da partida seguinte.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_cumpre_suspensoes() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'encerrado' OR OLD.status = 'encerrado' THEN
    RETURN NULL;
  END IF;

  UPDATE suspensoes s
     SET jogos_cumpridos = s.jogos_cumpridos + 1,
         ativa = (s.jogos_cumpridos + 1) < s.jogos_suspensao
   WHERE s.ativa
     AND s.categoria_id = NEW.categoria_id
     -- o atleta pertence a uma das equipes deste jogo
     AND EXISTS (
       SELECT 1 FROM inscricoes i
        WHERE i.atleta_id = s.atleta_id
          AND i.categoria_id = s.categoria_id
          AND i.time_id IN (NEW.mandante_id, NEW.visitante_id)
     )
     -- e não entrou em campo
     AND NOT EXISTS (
       SELECT 1 FROM jogo_escalacoes esc
        WHERE esc.jogo_id = NEW.id AND esc.atleta_id = s.atleta_id
     )
     -- não cumpre no próprio jogo em que levou o cartão
     AND NOT EXISTS (
       SELECT 1 FROM jogo_eventos e
        WHERE e.id = s.evento_origem_id AND e.jogo_id = NEW.id
     );

  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cumpre_suspensoes ON jogos;
CREATE TRIGGER trg_cumpre_suspensoes
  AFTER UPDATE ON jogos
  FOR EACH ROW EXECUTE FUNCTION fn_cumpre_suspensoes();


-- ---------------------------------------------------------------------
-- Bloqueio: atleta com suspensão ativa não entra em campo. É a última
-- linha — a API recusa antes, com mensagem melhor, mas quem grava direto
-- no banco também precisa esbarrar.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_bloqueia_escalacao_suspensa() RETURNS trigger AS $$
DECLARE
  v_categoria uuid;
  v_jogos int;
BEGIN
  SELECT j.categoria_id INTO v_categoria FROM jogos j WHERE j.id = NEW.jogo_id;

  SELECT sum(s.jogos_suspensao - s.jogos_cumpridos) INTO v_jogos
    FROM suspensoes s
   WHERE s.ativa
     AND s.categoria_id = v_categoria
     AND s.atleta_id = NEW.atleta_id;

  IF coalesce(v_jogos, 0) > 0 THEN
    RAISE EXCEPTION
      'Atleta com suspensão em vigor: % jogo(s) a cumprir nesta categoria.', v_jogos
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bloqueia_escalacao_suspensa ON jogo_escalacoes;
CREATE TRIGGER trg_bloqueia_escalacao_suspensa
  BEFORE INSERT ON jogo_escalacoes
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_escalacao_suspensa();


-- ---------------------------------------------------------------------
-- Visão de acompanhamento: o que a tela de suspensões mostra, incluindo
-- quem está "pendurado" (a um amarelo de fechar o ciclo).
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS v_situacao_disciplinar;
CREATE VIEW v_situacao_disciplinar
WITH (security_invoker = true) AS
WITH cartoes AS (
  SELECT j.categoria_id, e.atleta_id,
         count(*) FILTER (WHERE e.tipo = 'cartao_amarelo')  AS amarelos,
         count(*) FILTER (WHERE e.tipo = 'cartao_vermelho') AS vermelhos
    FROM jogo_eventos e
    JOIN jogos j ON j.id = e.jogo_id
   WHERE e.tipo IN ('cartao_amarelo', 'cartao_vermelho')
     AND e.atleta_id IS NOT NULL
   GROUP BY j.categoria_id, e.atleta_id
),
pendentes AS (
  SELECT categoria_id, atleta_id,
         sum(jogos_suspensao - jogos_cumpridos) AS jogos_a_cumprir
    FROM suspensoes WHERE ativa
   GROUP BY categoria_id, atleta_id
)
SELECT
  i.categoria_id,
  i.atleta_id,
  i.time_id,
  a.nome                                   AS atleta,
  t.nome                                   AS time_nome,
  coalesce(c.amarelos, 0)                  AS amarelos,
  coalesce(c.vermelhos, 0)                 AS vermelhos,
  -- posição no ciclo de acúmulo (0 = acabou de zerar)
  coalesce(c.amarelos, 0) % nullif(r.num_amarelos, 0) AS ciclo,
  r.num_amarelos,
  r.suspensao_ativa,
  coalesce(p.jogos_a_cumprir, 0)           AS jogos_a_cumprir,
  -- pendurado: falta um amarelo para fechar o ciclo
  (r.suspensao_ativa
   AND coalesce(c.amarelos, 0) > 0
   AND coalesce(c.amarelos, 0) % nullif(r.num_amarelos, 0) = r.num_amarelos - 1
  )                                        AS pendurado
FROM inscricoes i
JOIN atletas a ON a.id = i.atleta_id
JOIN times   t ON t.id = i.time_id
LEFT JOIN categoria_regras r ON r.categoria_id = i.categoria_id
LEFT JOIN cartoes   c ON c.categoria_id = i.categoria_id AND c.atleta_id = i.atleta_id
LEFT JOIN pendentes p ON p.categoria_id = i.categoria_id AND p.atleta_id = i.atleta_id;

COMMIT;
