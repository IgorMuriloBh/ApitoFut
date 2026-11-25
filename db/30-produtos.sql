-- =====================================================================
--  30 · Catálogo de produtos (RF035 — ficha de consumo)
--
--  A ficha de consumo vende um PRODUTO, e produto se cadastra uma vez e
--  se reaproveita: a mesma cerveja aparece no festival de julho e na
--  final de novembro. Por isso o catálogo é da ORGANIZAÇÃO, não do
--  evento — amarrá-lo ao evento obrigaria a redigitar o cardápio
--  inteiro a cada edição.
--
--  ── O GRUPO É TEXTO, E ISSO É UMA ESCOLHA ───────────────────────────
--  Este projeto já recusou campo livre uma vez, no cargo da comissão
--  técnica: lá a lista era fechada e conhecida (quatro cargos), e texto
--  livre produzia quatro grafias do mesmo cargo na mesma súmula.
--
--  Aqui é o contrário: "bebida", "comida", "brinde", "camisa" — a
--  taxonomia é de cada organizador e não dá para prever. Lista fechada
--  seria uma camisa de força. O risco de grafia dupla ("Bebidas" e
--  "bebida") existe, e a tela o reduz sugerindo os grupos que a conta
--  já usa. Se um dia virar problema de verdade, promove-se a tabela
--  própria — hoje seria estrutura para uma pergunta que ninguém fez.
--
--  ── A IMAGEM GUARDA CAMINHO, NUNCA URL ──────────────────────────────
--  Mesma convenção do escudo e da foto do atleta: o banco guarda
--  `/uploads/…`, e quem monta a URL absoluta é a API. Trocar o domínio
--  não pode invalidar foto já enviada.
--
--  Idempotente.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS produtos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id uuid NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,

  grupo          text NOT NULL,          -- "Bebida", "Comida", "Brinde"
  nome           text NOT NULL,          -- a descrição que aparece no balcão

  -- dinheiro em CENTAVOS, inteiro, como em todo o resto do sistema
  preco_centavos int NOT NULL CHECK (preco_centavos >= 0),

  ativo          boolean NOT NULL DEFAULT true,
  imagem_url     text,                   -- caminho, não URL

  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_produto_grupo CHECK (length(btrim(grupo)) > 0),
  CONSTRAINT ck_produto_nome  CHECK (length(btrim(nome))  > 0)
);

-- `unaccent_simples` (migration 18) e não a `unaccent()` da extensão: a
-- da extensão não é IMMUTABLE — carrega o dicionário do disco — e o
-- Postgres recusa usá-la em índice.
--
-- o mesmo produto duas vezes no mesmo grupo é sempre engano de digitação;
-- "Água" em "Bebida" e em "Brinde" é legítimo, e por isso o grupo entra
-- na chave. Sem acento e sem caixa: "Água" e "agua" são o mesmo produto
CREATE UNIQUE INDEX IF NOT EXISTS uq_produto_da_organizacao
  ON produtos (organizacao_id, lower(unaccent_simples(grupo)), lower(unaccent_simples(nome)));

CREATE INDEX IF NOT EXISTS idx_produtos_catalogo
  ON produtos (organizacao_id, grupo, nome);

DROP TRIGGER IF EXISTS trg_produtos_touch ON produtos;
CREATE TRIGGER trg_produtos_touch
  BEFORE UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION fn_touch();


-- ---------------------------------------------------------------------
-- RLS — catálogo é da organização, e de mais ninguém
--
--  Sem ramo público: o cardápio e os preços de custo de uma promotora
--  não são assunto de quem visita o portal. O que o comprador vê é o
--  lote à venda no evento, que é outra coisa.
-- ---------------------------------------------------------------------

ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_produtos ON produtos;
CREATE POLICY p_produtos ON produtos
  USING (app_current_org() IS NOT NULL AND organizacao_id = app_current_org())
  WITH CHECK (organizacao_id = app_current_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON produtos TO apitofut_app;

COMMIT;
