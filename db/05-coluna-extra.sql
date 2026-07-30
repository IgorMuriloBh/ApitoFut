-- =====================================================================
--  APITOFUT — Migration 05: coluna_extra ganha onde ser armazenada
--
--  `coluna_extra` já existia no enum coluna_classificacao e vinha como 2º
--  critério de desempate no seed, mas não havia onde guardar o valor — no
--  protótipo era sempre 0, então nunca desempatava nada.
--
--  É um ajuste manual lançado pelo organizador quando ele quer uma regra
--  de desempate própria (bônus de fair play, punição por W.O., pontuação
--  de uma fase anterior). Aceita valor negativo.
--
--  Idempotente.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS categoria_coluna_extra (
  categoria_id  uuid        NOT NULL,
  time_id       uuid        NOT NULL,
  valor         int         NOT NULL DEFAULT 0,   -- negativo = punição
  motivo        text,                             -- por que o ajuste existe
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (categoria_id, time_id),

  -- Aponta para o VÍNCULO, não para as tabelas soltas: garante que a equipe
  -- realmente disputa esta categoria. Um FK para times permitiria lançar
  -- ajuste para equipe de outra categoria.
  CONSTRAINT fk_coluna_extra_vinculo
    FOREIGN KEY (categoria_id, time_id)
    REFERENCES categoria_times (categoria_id, time_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE categoria_coluna_extra IS
  'Ajuste manual do organizador por equipe, exposto como coluna_extra na classificação e utilizável como critério de desempate.';

DROP TRIGGER IF EXISTS trg_touch_coluna_extra ON categoria_coluna_extra;
CREATE TRIGGER trg_touch_coluna_extra
  BEFORE UPDATE ON categoria_coluna_extra
  FOR EACH ROW EXECUTE FUNCTION fn_touch();

-- Rótulo da coluna, por categoria: o portal precisa de um cabeçalho, e
-- "Coluna Extra" não diz nada ao torcedor.
ALTER TABLE categoria_regras
  ADD COLUMN IF NOT EXISTS coluna_extra_rotulo text NOT NULL DEFAULT 'Coluna Extra';


-- ---------------------------------------------------------------------
-- v_classificacao passa a expor coluna_extra.
-- DROP + CREATE porque a coluna entra no meio da lista (CREATE OR REPLACE
-- só aceita acrescentar no fim).
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS v_classificacao;

CREATE VIEW v_classificacao AS
WITH jogos_validos AS (
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
SELECT
  ct.categoria_id,
  ct.grupo_id,
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
  COALESCE(ce.valor, 0)                     AS coluna_extra,
  COALESCE(c.ca, 0)                         AS cartao_amarelo,
  COALESCE(c.cv, 0)                         AS cartao_vermelho,
  COALESCE(c.caz, 0)                        AS cartao_azul
FROM categoria_times ct
JOIN times t              ON t.id = ct.time_id
LEFT JOIN agregado a      ON a.categoria_id = ct.categoria_id AND a.time_id = ct.time_id
LEFT JOIN cartoes  c      ON c.categoria_id = ct.categoria_id AND c.time_id = ct.time_id
LEFT JOIN categoria_coluna_extra ce
                          ON ce.categoria_id = ct.categoria_id AND ce.time_id = ct.time_id
LEFT JOIN categoria_regras reg ON reg.categoria_id = ct.categoria_id;

COMMIT;

-- =====================================================================
--  NOTA
--  Vale a regra do protótipo: só desempata por coluna VISÍVEL. Para a
--  coluna_extra realmente valer como critério, o organizador precisa
--  deixá-la visível em categoria_coluna_classificacao — caso contrário
--  ela é ignorada na ordenação, como qualquer outra coluna escondida.
-- =====================================================================
