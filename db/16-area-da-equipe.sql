-- =====================================================================
--  APITOFUT — Migration 16: área da equipe (auto-cadastro por link)
--
--  O organizador manda um link à equipe; ela se cadastra sozinha, recebe um
--  código de 6 caracteres e volta com ele para inscrever atletas e comissão
--  técnica. `times.origem` e `times.codigo_acesso` existem desde o schema
--  original e esperavam por isto.
--
--  POR QUE PRECISA DE FRESTA. O protótipo (`inscricoesLiberadas`, linha
--  4052) libera inscrição desde que a competição não esteja `encerrada` —
--  inclusive em `em_criacao`. É o fluxo real: o organizador monta a
--  competição, abre inscrições, junta as equipes, e só então publica. Mas
--  `em_criacao` é invisível ao público por RLS, e quem chega pelo link não
--  tem sessão nem organização. Daí as funções abaixo.
--
--  O QUE ELAS NÃO FAZEM. Nenhuma delas escreve. Elas resolvem a competição
--  e a equipe; a escrita acontece pelo caminho normal, com a API entrando
--  em `comOrganizacao` da organização que a fresta devolveu — as políticas
--  seguem valendo, e o WITH CHECK continua recusando gravação cruzada.
--
--  O QUE ELAS DEVOLVEM É PÚBLICO POR DESENHO: nome da competição, cores,
--  categorias abertas e quantas vagas restam. Nada de atleta, nada de
--  outra equipe. A equipe só enxerga a si mesma, e só com o código.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  1. Código de acesso
-- ---------------------------------------------------------------------

-- Alfabeto sem 0/O e 1/I/L: o código é ditado por telefone e digitado à
-- mão pelo responsável da equipe, e esses pares se confundem.
CREATE OR REPLACE FUNCTION fn_gera_codigo_acesso(p_competicao uuid)
RETURNS char(6)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_codigo   char(6);
  v_tentativa int := 0;
BEGIN
  LOOP
    v_codigo := (
      SELECT string_agg(
               substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1),
               '')
        FROM generate_series(1, 6)
    );

    -- uq_time_codigo é por competição: o mesmo código pode existir em
    -- competições diferentes sem ambiguidade, porque a busca sempre passa
    -- pela competição
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM times t
       WHERE t.competicao_id = p_competicao AND t.codigo_acesso = v_codigo
    );

    v_tentativa := v_tentativa + 1;
    IF v_tentativa > 50 THEN
      RAISE EXCEPTION 'Não foi possível gerar um código de acesso.'
        USING ERRCODE = 'AF500';
    END IF;
  END LOOP;

  RETURN v_codigo;
END;
$$;

REVOKE ALL ON FUNCTION fn_gera_codigo_acesso(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_gera_codigo_acesso(uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
--  2. A competição vista pelo convite
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_convite_competicao(p_slug text)
RETURNS TABLE (
  id             uuid,
  organizacao_id uuid,
  nome           text,
  slug           text,
  cidade         text,
  estado         char(2),
  cor_primaria   char(7),
  logo_url       text,
  status         status_competicao,
  liberada       boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.organizacao_id, c.nome, c.slug, c.cidade, c.estado,
         c.cor_primaria, c.logo_url, c.status,
         -- regra do protótipo: encerrada nunca; fora isso, basta uma
         -- categoria com inscrições abertas
         (c.status <> 'encerrada' AND EXISTS (
            SELECT 1
              FROM categorias k
              JOIN categoria_inscricao_config g ON g.categoria_id = k.id
             WHERE k.competicao_id = c.id AND g.inscricoes_abertas
          ))
    FROM competicoes c
   WHERE c.slug = p_slug AND c.excluida_em IS NULL;
$$;

REVOKE ALL ON FUNCTION fn_convite_competicao(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_convite_competicao(text) TO apitofut_app;


-- Categorias que aceitam equipe agora, com as vagas restantes. É o que
-- alimenta o seletor da inscrição — e é por isto que a equipe descobre que
-- uma categoria lotou antes de preencher o formulário inteiro.
CREATE OR REPLACE FUNCTION fn_convite_categorias(p_competicao uuid)
RETURNS TABLE (
  id           uuid,
  nome         text,
  tipo         tipo_categoria,
  genero       genero_categoria,
  modalidade   modalidade,
  num_times    int,
  inscritos    bigint,
  max_atletas  int,
  max_comissao int,
  ordem        int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.nome, k.tipo, k.genero, k.modalidade, k.num_times,
         (SELECT count(*) FROM categoria_times ct WHERE ct.categoria_id = k.id),
         g.max_atletas, g.max_comissao, k.ordem
    FROM categorias k
    JOIN categoria_inscricao_config g ON g.categoria_id = k.id
   WHERE k.competicao_id = p_competicao
     AND g.inscricoes_abertas
   ORDER BY k.ordem, k.nome;
$$;

REVOKE ALL ON FUNCTION fn_convite_categorias(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_convite_categorias(uuid) TO apitofut_app;


-- ---------------------------------------------------------------------
--  3. A equipe se identifica pelo código
-- ---------------------------------------------------------------------

-- Devolve UMA equipe, da competição informada, e só com o código exato.
-- Sem varredura, sem filtro arbitrário, sem listar equipes — mesmo recorte
-- de `fn_busca_usuario_login` (migration 08).
CREATE OR REPLACE FUNCTION fn_convite_equipe(
  p_competicao uuid,
  p_codigo     text
)
RETURNS TABLE (id uuid, nome text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.nome
    FROM times t
   WHERE t.competicao_id = p_competicao
     AND t.codigo_acesso = upper(btrim(p_codigo))
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION fn_convite_equipe(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_convite_equipe(uuid, text) TO apitofut_app;

COMMENT ON FUNCTION fn_convite_equipe(uuid, text) IS
  'Resolve a equipe pelo código de acesso. Só leitura; a escrita passa pelo RLS normal.';

COMMIT;
