-- =====================================================================
--  APITOFUT — Migration 03: Hardening do modelo
--
--  Corrige fragilidades identificadas na revisão do schema (01-schema.sql).
--  Idempotente: pode rodar na primeira subida (após 01/02) e ser reaplicada
--  em um banco já existente sem efeitos colaterais.
--
--  Escopo:
--   1. Race condition (TOCTOU) nos triggers de inscrição  → advisory locks
--   2. Config 1:1 obrigatória por categoria               → trigger + backfill
--   3. Classificação some sem categoria_regras            → LEFT JOIN + COALESCE
--   4. Assistência com dupla contagem / joins cartesianos → v_estatisticas reescrita
--   5. Pênalti perdido não representado                   → coluna 'convertido'
--   6. Faixa etária ignora a temporada da competição      → view usa comp.temporada
--   7. Hex de uniforme sem validação / slug sem geração   → checks + trigger
--
--  Deixados de fora por exigirem decisão de produto/arquitetura (ver rodapé):
--   RLS multi-tenant, política de ON DELETE, dedup de atleta sem CPF.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. TOCTOU nos triggers de inscrição (RF010 e limite de elenco)
--    Dois INSERTs concorrentes passavam a checagem antes de qualquer
--    commit. Um advisory lock por (competição, atleta) / (categoria, time)
--    serializa apenas os concorrentes que disputam a MESMA regra.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_valida_equipe_unica() RETURNS trigger AS $$
DECLARE
  v_competicao uuid;
  v_outro_time uuid;
BEGIN
  SELECT c.competicao_id INTO v_competicao
    FROM categorias c WHERE c.id = NEW.categoria_id;

  -- serializa inscrições concorrentes do mesmo atleta na mesma competição
  PERFORM pg_advisory_xact_lock(hashtext(v_competicao::text || ':' || NEW.atleta_id::text));

  SELECT i.time_id INTO v_outro_time
    FROM inscricoes i
    JOIN categorias c2 ON c2.id = i.categoria_id
   WHERE i.atleta_id = NEW.atleta_id
     AND c2.competicao_id = v_competicao
     AND i.time_id <> NEW.time_id
   LIMIT 1;

  IF v_outro_time IS NOT NULL THEN
    RAISE EXCEPTION 'RF010: atleta já inscrito por outra equipe nesta competição (time %)', v_outro_time
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_valida_limite_elenco() RETURNS trigger AS $$
DECLARE
  v_max   int;
  v_atual int;
BEGIN
  -- serializa inscrições concorrentes na mesma (categoria, time)
  PERFORM pg_advisory_xact_lock(hashtext(NEW.categoria_id::text || ':' || NEW.time_id::text));

  SELECT cfg.max_atletas INTO v_max
    FROM categoria_inscricao_config cfg WHERE cfg.categoria_id = NEW.categoria_id;

  SELECT count(*) INTO v_atual
    FROM inscricoes
   WHERE categoria_id = NEW.categoria_id AND time_id = NEW.time_id;

  IF v_max IS NOT NULL AND v_atual >= v_max THEN
    RAISE EXCEPTION 'Limite de % atletas por equipe atingido nesta categoria', v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 2. Toda categoria precisa das linhas 1:1 de configuração.
--    Sem elas, a classificação some (item 3) e o limite de elenco é
--    silenciosamente desligado. Cria por trigger e faz backfill.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_categoria_defaults() RETURNS trigger AS $$
BEGIN
  INSERT INTO categoria_regras (categoria_id)           VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO categoria_inscricao_config (categoria_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_categoria_defaults ON categorias;
CREATE TRIGGER trg_categoria_defaults
  AFTER INSERT ON categorias
  FOR EACH ROW EXECUTE FUNCTION fn_categoria_defaults();

-- Backfill de categorias pré-existentes (o seed já cria a demo → NOT EXISTS pula)
INSERT INTO categoria_regras (categoria_id)
SELECT c.id FROM categorias c
 WHERE NOT EXISTS (SELECT 1 FROM categoria_regras r WHERE r.categoria_id = c.id);

INSERT INTO categoria_inscricao_config (categoria_id)
SELECT c.id FROM categorias c
 WHERE NOT EXISTS (SELECT 1 FROM categoria_inscricao_config x WHERE x.categoria_id = c.id);


-- ---------------------------------------------------------------------
-- 5. Pênalti perdido/defendido: até agora todo evento 'penalti' virava
--    gol. Coluna 'convertido' (default true) preserva o comportamento
--    existente e permite registrar cobrança perdida sem inflar o placar.
-- ---------------------------------------------------------------------

ALTER TABLE jogo_eventos ADD COLUMN IF NOT EXISTS convertido boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN jogo_eventos.convertido IS
  'Só relevante para tipo=penalti: true=convertido (conta no placar), false=perdido/defendido. Ignorado nos demais tipos.';

-- Placar derivado dos lances: gol sempre; penalti só quando convertido.
CREATE OR REPLACE FUNCTION fn_recalcula_placar() RETURNS trigger AS $$
DECLARE
  v_jogo uuid := COALESCE(NEW.jogo_id, OLD.jogo_id);
BEGIN
  UPDATE jogos j SET
    placar_mandante = (
      SELECT count(*) FROM jogo_eventos e WHERE e.jogo_id = j.id
        AND (e.tipo = 'gol' OR (e.tipo = 'penalti' AND e.convertido))
        AND ((NOT e.gol_contra AND e.time_id = j.mandante_id)
          OR (    e.gol_contra AND e.time_id = j.visitante_id))),
    placar_visitante = (
      SELECT count(*) FROM jogo_eventos e WHERE e.jogo_id = j.id
        AND (e.tipo = 'gol' OR (e.tipo = 'penalti' AND e.convertido))
        AND ((NOT e.gol_contra AND e.time_id = j.visitante_id)
          OR (    e.gol_contra AND e.time_id = j.mandante_id))),
    atualizado_em = now()
  WHERE j.id = v_jogo;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
-- 3. Classificação resiliente: LEFT JOIN em categoria_regras com defaults
--    (3/1/0), para nunca omitir um time por falta de configuração.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_classificacao AS
WITH resultados AS (
  SELECT j.categoria_id, j.grupo_id, j.mandante_id AS time_id,
         j.placar_mandante AS gp, j.placar_visitante AS gc
    FROM jogos j JOIN fases f ON f.id = j.fase_id
   WHERE j.status = 'encerrado' AND f.tipo = 'grupos'
  UNION ALL
  SELECT j.categoria_id, j.grupo_id, j.visitante_id,
         j.placar_visitante, j.placar_mandante
    FROM jogos j JOIN fases f ON f.id = j.fase_id
   WHERE j.status = 'encerrado' AND f.tipo = 'grupos'
),
cartoes AS (
  SELECT j.categoria_id, e.time_id,
         count(*) FILTER (WHERE e.tipo = 'cartao_amarelo')  AS ca,
         count(*) FILTER (WHERE e.tipo = 'cartao_vermelho') AS cv,
         count(*) FILTER (WHERE e.tipo = 'cartao_azul')     AS caz
    FROM jogo_eventos e JOIN jogos j ON j.id = e.jogo_id
   GROUP BY j.categoria_id, e.time_id
)
SELECT
  r.categoria_id,
  r.grupo_id,
  r.time_id,
  t.nome                                              AS time_nome,
  count(*)                                            AS jogos,
  count(*) FILTER (WHERE r.gp > r.gc)                 AS vitorias,
  count(*) FILTER (WHERE r.gp = r.gc)                 AS empates,
  count(*) FILTER (WHERE r.gp < r.gc)                 AS derrotas,
  sum(r.gp)                                           AS gols_pro,
  sum(r.gc)                                           AS gols_contra,
  sum(r.gp) - sum(r.gc)                               AS saldo_gols,
  count(*) FILTER (WHERE r.gp > r.gc) * COALESCE(reg.pontos_vitoria, 3)
    + count(*) FILTER (WHERE r.gp = r.gc) * COALESCE(reg.pontos_empate, 1)
    + count(*) FILTER (WHERE r.gp < r.gc) * COALESCE(reg.pontos_derrota, 0) AS pontos,
  COALESCE(c.ca,0)  AS cartao_amarelo,
  COALESCE(c.cv,0)  AS cartao_vermelho,
  COALESCE(c.caz,0) AS cartao_azul
FROM resultados r
JOIN times t ON t.id = r.time_id
LEFT JOIN categoria_regras reg ON reg.categoria_id = r.categoria_id
LEFT JOIN cartoes c ON c.categoria_id = r.categoria_id AND c.time_id = r.time_id
GROUP BY r.categoria_id, r.grupo_id, r.time_id, t.nome,
         reg.pontos_vitoria, reg.pontos_empate, reg.pontos_derrota,
         c.ca, c.cv, c.caz;


-- ---------------------------------------------------------------------
-- 4. Estatísticas individuais sem dupla contagem.
--    Antes: os LEFT JOINs de eventos (autor) e assistências (assistente)
--    se multiplicavam (produto cartesiano por jogo), inflando gols e
--    assistências. Reescrita com laterais agregando cada fonte 1x.
--    Assistência tem fonte única: assistencia_atleta_id do gol.
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS v_estatisticas_atleta;
CREATE VIEW v_estatisticas_atleta AS
SELECT
  i.categoria_id,
  i.atleta_id,
  i.time_id,
  COALESCE(jc.jogos, 0)             AS jogos,
  COALESCE(ev.gols, 0)             AS gols,
  COALESCE(asst.assistencias, 0)   AS assistencias,
  COALESCE(ev.cartoes_amarelos, 0) AS cartoes_amarelos,
  COALESCE(ev.cartoes_vermelhos,0) AS cartoes_vermelhos,
  COALESCE(ev.defesas, 0)          AS defesas
FROM inscricoes i
LEFT JOIN LATERAL (
  SELECT count(DISTINCT esc.jogo_id) AS jogos
    FROM jogo_escalacoes esc
    JOIN jogos j ON j.id = esc.jogo_id AND j.categoria_id = i.categoria_id
   WHERE esc.atleta_id = i.atleta_id
) jc ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE e.tipo = 'gol' OR (e.tipo = 'penalti' AND e.convertido)) AS gols,
    count(*) FILTER (WHERE e.tipo = 'cartao_amarelo')  AS cartoes_amarelos,
    count(*) FILTER (WHERE e.tipo = 'cartao_vermelho') AS cartoes_vermelhos,
    count(*) FILTER (WHERE e.tipo IN ('defesa_dificil','defesa_penalti')) AS defesas
    FROM jogo_eventos e
    JOIN jogos j ON j.id = e.jogo_id AND j.categoria_id = i.categoria_id
   WHERE e.atleta_id = i.atleta_id
) ev ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS assistencias
    FROM jogo_eventos a
    JOIN jogos j ON j.id = a.jogo_id AND j.categoria_id = i.categoria_id
   WHERE a.assistencia_atleta_id = i.atleta_id
) asst ON true;


-- ---------------------------------------------------------------------
-- 6. Faixa etária sensível à temporada da competição.
--    Antes: comparava com faixas_etarias (ano-base 2026 fixo) e ignorava
--    competicoes.temporada. Agora: ano esperado = temporada - N (Sub-N).
--    Ex.: Sub-11 em 2026 → 2015; a mesma Sub-11 em 2027 → 2016.
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS v_atletas_fora_faixa;
CREATE VIEW v_atletas_fora_faixa AS
SELECT
  i.categoria_id,
  cat.nome                                   AS categoria,
  i.atleta_id,
  a.nome                                     AS atleta,
  extract(year FROM a.data_nascimento)::int  AS ano_atleta,
  (comp.temporada - sub.n)                   AS ano_esperado
FROM inscricoes i
JOIN categorias  cat  ON cat.id  = i.categoria_id
JOIN competicoes comp ON comp.id = cat.competicao_id
JOIN atletas     a    ON a.id    = i.atleta_id
JOIN LATERAL (
  SELECT NULLIF(
    regexp_replace(cat.nome, '^.*[Ss][Uu][Bb][^0-9]*([0-9]{1,2}).*$', '\1'),
    cat.nome
  )::int AS n
) sub ON sub.n IS NOT NULL          -- só categorias Sub-N entram na validação
WHERE a.data_nascimento IS NOT NULL
  AND comp.temporada IS NOT NULL
  AND extract(year FROM a.data_nascimento)::int <> (comp.temporada - sub.n);


-- ---------------------------------------------------------------------
-- 7. Correções menores: validação de hex dos uniformes e geração de slug.
-- ---------------------------------------------------------------------

-- Uniformes agora seguem o mesmo padrão hex de cor_primaria (aceitam NULL).
ALTER TABLE times DROP CONSTRAINT IF EXISTS ck_time_uniforme_primario;
ALTER TABLE times ADD  CONSTRAINT ck_time_uniforme_primario
  CHECK (uniforme_primario IS NULL OR uniforme_primario ~* '^#[0-9a-f]{6}$');
ALTER TABLE times DROP CONSTRAINT IF EXISTS ck_time_uniforme_secundario;
ALTER TABLE times ADD  CONSTRAINT ck_time_uniforme_secundario
  CHECK (uniforme_secundario IS NULL OR uniforme_secundario ~* '^#[0-9a-f]{6}$');

-- Slug gerado a partir do nome quando não informado (usa unaccent já carregado).
CREATE OR REPLACE FUNCTION fn_slugify(txt text) RETURNS text AS $$
  SELECT btrim(
    regexp_replace(lower(unaccent(coalesce(txt, ''))), '[^a-z0-9]+', '-', 'g'),
    '-'
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_competicao_slug() RETURNS trigger AS $$
DECLARE
  base text;
  cand text;
  n    int := 1;
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    base := fn_slugify(NEW.nome);
    IF base = '' THEN base := 'competicao'; END IF;
    cand := base;
    WHILE EXISTS (SELECT 1 FROM competicoes WHERE slug = cand AND id <> NEW.id) LOOP
      n := n + 1;
      cand := base || '-' || n;
    END LOOP;
    NEW.slug := cand;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_competicao_slug ON competicoes;
CREATE TRIGGER trg_competicao_slug
  BEFORE INSERT ON competicoes
  FOR EACH ROW EXECUTE FUNCTION fn_competicao_slug();

COMMIT;

-- =====================================================================
--  PENDÊNCIAS QUE EXIGEM DECISÃO (não aplicadas aqui de propósito):
--
--  • Isolamento multi-tenant (RLS): políticas prontas em
--    db/optional/rls.sql — ativar quando a stack/role de conexão da
--    aplicação estiver definida (não usar o superusuário 'apitofut').
--
--  • Política de ON DELETE: hoje apagar uma organização faz CASCADE e
--    destrói todas as competições; apagar um time deixa o jogo com time
--    nulo mas apaga os eventos. Recomenda-se soft-delete (coluna
--    excluido_em) em vez de DELETE físico — decidir antes de expor a API.
--
--  • Dedup de atleta sem CPF: a base é global e a única chave é cpf
--    (nulo em menores). Definir chave de deduplicação (ex.: nome +
--    data_nascimento + responsável) ou fluxo de merge.
-- =====================================================================
