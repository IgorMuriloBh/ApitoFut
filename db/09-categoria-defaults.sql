-- =====================================================================
--  APITOFUT — Migration 09: defaults COMPLETOS de categoria
--
--  O trigger da migration 03 criava só categoria_regras e
--  categoria_inscricao_config. Uma categoria criada pela API nasceria sem
--  colunas de classificação e sem critérios de desempate — a tabela do
--  portal sairia vazia de colunas e sem ordenação.
--
--  Este trigger completa o espelho do defaultConfig() do protótipo
--  (mesmos valores que o seed usa na categoria demo):
--
--   • colunas visíveis: pontos, saldo, GC, E, J, GP, V, D
--   • desempate: pontos > coluna_extra > saldo > V > GP > GC(asc) >
--     CA(asc) > CV(asc) > CAz(asc)
--   • súmula habilitada: assistência, cartão amarelo, cartão vermelho
--   • ficha do atleta: pede só data de nascimento, nada obrigatório
--
--  ON CONFLICT DO NOTHING em tudo: o seed insere os mesmos valores
--  explicitamente e categorias antigas podem já ter configuração própria.
--  Idempotente, com backfill.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_categoria_defaults() RETURNS trigger AS $$
BEGIN
  INSERT INTO categoria_regras (categoria_id)           VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO categoria_inscricao_config (categoria_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;

  INSERT INTO categoria_coluna_classificacao (categoria_id, coluna, visivel)
  SELECT NEW.id, c, c IN ('pontos','saldo_gols','gols_contra','empates',
                          'jogos','gols_pro','vitorias','derrotas')
    FROM unnest(enum_range(NULL::coluna_classificacao)) c
  ON CONFLICT DO NOTHING;

  INSERT INTO categoria_criterio_desempate (categoria_id, ordem, criterio, direcao) VALUES
    (NEW.id, 1, 'pontos',          'DESC'),
    (NEW.id, 2, 'coluna_extra',    'DESC'),
    (NEW.id, 3, 'saldo_gols',      'DESC'),
    (NEW.id, 4, 'vitorias',        'DESC'),
    (NEW.id, 5, 'gols_pro',        'DESC'),
    (NEW.id, 6, 'gols_contra',     'ASC'),
    (NEW.id, 7, 'cartao_amarelo',  'ASC'),
    (NEW.id, 8, 'cartao_vermelho', 'ASC'),
    (NEW.id, 9, 'cartao_azul',     'ASC')
  ON CONFLICT DO NOTHING;

  INSERT INTO categoria_campo_sumula (categoria_id, campo, habilitado)
  SELECT NEW.id, t, t IN ('assistencia','cartao_amarelo','cartao_vermelho')
    FROM unnest(enum_range(NULL::tipo_evento)) t
  ON CONFLICT DO NOTHING;

  INSERT INTO categoria_campo_atleta (categoria_id, campo, pedir, obrigatorio)
  SELECT NEW.id, c, c = 'data_nascimento', false
    FROM unnest(enum_range(NULL::campo_atleta)) c
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Backfill de categorias que existiam antes desta migration e não têm as
-- linhas (a demo do seed já tem tudo; entra só o que faltar).
INSERT INTO categoria_coluna_classificacao (categoria_id, coluna, visivel)
SELECT cat.id, c, c IN ('pontos','saldo_gols','gols_contra','empates',
                        'jogos','gols_pro','vitorias','derrotas')
  FROM categorias cat CROSS JOIN unnest(enum_range(NULL::coluna_classificacao)) c
ON CONFLICT DO NOTHING;

INSERT INTO categoria_campo_sumula (categoria_id, campo, habilitado)
SELECT cat.id, t, t IN ('assistencia','cartao_amarelo','cartao_vermelho')
  FROM categorias cat CROSS JOIN unnest(enum_range(NULL::tipo_evento)) t
ON CONFLICT DO NOTHING;

INSERT INTO categoria_campo_atleta (categoria_id, campo, pedir, obrigatorio)
SELECT cat.id, c, c = 'data_nascimento', false
  FROM categorias cat CROSS JOIN unnest(enum_range(NULL::campo_atleta)) c
ON CONFLICT DO NOTHING;

-- Critérios: só para categoria que não tem NENHUM critério (não misturar
-- com ordenação que o organizador já customizou).
INSERT INTO categoria_criterio_desempate (categoria_id, ordem, criterio, direcao)
SELECT cat.id, d.ordem, d.criterio::coluna_classificacao, d.direcao::direcao_criterio
  FROM categorias cat
 CROSS JOIN (VALUES
    (1,'pontos','DESC'),(2,'coluna_extra','DESC'),(3,'saldo_gols','DESC'),
    (4,'vitorias','DESC'),(5,'gols_pro','DESC'),(6,'gols_contra','ASC'),
    (7,'cartao_amarelo','ASC'),(8,'cartao_vermelho','ASC'),(9,'cartao_azul','ASC')
  ) AS d(ordem, criterio, direcao)
 WHERE NOT EXISTS (SELECT 1 FROM categoria_criterio_desempate x WHERE x.categoria_id = cat.id);

COMMIT;
