-- =====================================================================
--  APITOFUT — Migration 04: v_classificacao fiel ao protótipo
--
--  A view original divergia da especificação executável
--  (prototipo/ApitoFut.html › calcClassificacao) em três pontos:
--
--   1. Times sem jogo disputado NÃO apareciam. A view partia dos
--      resultados, então uma equipe recém-inscrita sumia da tabela.
--      O protótipo lista todas as equipes da categoria, zeradas.
--
--   2. Cartões vinham de QUALQUER jogo — inclusive mata-mata e jogos
--      ainda não encerrados. Bastava um amarelo num jogo agendado para
--      poluir a classificação da fase de grupos.
--
--   3. Faltava `porcentagem` (aproveitamento), que existe no enum
--      coluna_classificacao e o protótipo calcula.
--
--  Idempotente. A ordenação final continua na aplicação: os critérios
--  de desempate são por categoria (categoria_criterio_desempate) e
--  dinâmicos demais para caber num ORDER BY fixo.
-- =====================================================================

BEGIN;

-- DROP + CREATE em vez de CREATE OR REPLACE: `porcentagem` entra no meio da
-- lista de colunas, e o REPLACE só aceita acrescentar no fim. Nada depende
-- desta view ainda.
DROP VIEW IF EXISTS v_classificacao;

CREATE VIEW v_classificacao AS
WITH jogos_validos AS (
  -- Só fase de grupos e só jogo encerrado — igual ao protótipo.
  SELECT j.id, j.categoria_id, j.mandante_id, j.visitante_id,
         j.placar_mandante, j.placar_visitante
    FROM jogos j
    JOIN fases f ON f.id = j.fase_id
   WHERE j.status = 'encerrado'
     AND f.tipo = 'grupos'
),
resultados AS (
  SELECT categoria_id, mandante_id AS time_id,
         placar_mandante AS gp, placar_visitante AS gc
    FROM jogos_validos
   WHERE mandante_id IS NOT NULL
  UNION ALL
  SELECT categoria_id, visitante_id,
         placar_visitante, placar_mandante
    FROM jogos_validos
   WHERE visitante_id IS NOT NULL
),
agregado AS (
  SELECT
    categoria_id,
    time_id,
    count(*)                              AS jogos,
    count(*) FILTER (WHERE gp > gc)       AS vitorias,
    count(*) FILTER (WHERE gp = gc)       AS empates,
    count(*) FILTER (WHERE gp < gc)       AS derrotas,
    sum(gp)                               AS gols_pro,
    sum(gc)                               AS gols_contra
  FROM resultados
  GROUP BY categoria_id, time_id
),
cartoes AS (
  -- Agora restrito aos mesmos jogos que contam para a classificação.
  SELECT
    jv.categoria_id,
    e.time_id,
    count(*) FILTER (WHERE e.tipo = 'cartao_amarelo')  AS ca,
    count(*) FILTER (WHERE e.tipo = 'cartao_vermelho') AS cv,
    count(*) FILTER (WHERE e.tipo = 'cartao_azul')     AS caz
  FROM jogo_eventos e
  JOIN jogos_validos jv ON jv.id = e.jogo_id
  GROUP BY jv.categoria_id, e.time_id
)
-- Parte de categoria_times: toda equipe inscrita aparece, tenha jogado ou não.
SELECT
  ct.categoria_id,
  ct.grupo_id,                      -- do vínculo; jogo pode nem existir ainda
  ct.time_id,
  t.nome                                    AS time_nome,
  COALESCE(a.jogos, 0)                      AS jogos,
  COALESCE(a.vitorias, 0)                   AS vitorias,
  COALESCE(a.empates, 0)                    AS empates,
  COALESCE(a.derrotas, 0)                   AS derrotas,
  COALESCE(a.gols_pro, 0)                   AS gols_pro,
  COALESCE(a.gols_contra, 0)                AS gols_contra,
  COALESCE(a.gols_pro, 0) - COALESCE(a.gols_contra, 0) AS saldo_gols,
  COALESCE(a.vitorias, 0) * COALESCE(reg.pontos_vitoria, 3)
    + COALESCE(a.empates, 0) * COALESCE(reg.pontos_empate, 1)
    + COALESCE(a.derrotas, 0) * COALESCE(reg.pontos_derrota, 0) AS pontos,
  -- Aproveitamento: pontos sobre o máximo possível, 1 casa decimal.
  -- NULLIF evita divisão por zero quando não há jogos ou vitória vale 0.
  COALESCE(
    round(
      ( COALESCE(a.vitorias, 0) * COALESCE(reg.pontos_vitoria, 3)
      + COALESCE(a.empates, 0) * COALESCE(reg.pontos_empate, 1)
      + COALESCE(a.derrotas, 0) * COALESCE(reg.pontos_derrota, 0) )::numeric
      * 100
      / NULLIF(COALESCE(a.jogos, 0) * COALESCE(reg.pontos_vitoria, 3), 0),
      1
    ),
    0
  )                                         AS porcentagem,
  COALESCE(c.ca, 0)                         AS cartao_amarelo,
  COALESCE(c.cv, 0)                         AS cartao_vermelho,
  COALESCE(c.caz, 0)                        AS cartao_azul
FROM categoria_times ct
JOIN times t              ON t.id = ct.time_id
LEFT JOIN agregado a      ON a.categoria_id = ct.categoria_id AND a.time_id = ct.time_id
LEFT JOIN cartoes  c      ON c.categoria_id = ct.categoria_id AND c.time_id = ct.time_id
LEFT JOIN categoria_regras reg ON reg.categoria_id = ct.categoria_id;

COMMIT;

-- =====================================================================
--  AINDA EM ABERTO
--
--  `coluna_extra` aparece no enum coluna_classificacao e é o 2º critério
--  de desempate no seed, mas não existe onde guardar o valor — no
--  protótipo ela é sempre 0. É uma coluna de ajuste manual (bônus ou
--  punição lançada pelo organizador). Quando for implementada, precisa
--  de tabela própria por (categoria, time) e entrar nesta view.
-- =====================================================================
