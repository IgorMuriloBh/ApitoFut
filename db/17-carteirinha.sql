-- =====================================================================
--  APITOFUT — Migration 17: carteirinha digital e validação por QR (RF029)
--
--  O QR impresso na carteirinha aponta para /c/{competicao}/{atleta}. Quem
--  escaneia é a arbitragem, na beira do campo, para conferir se aquele
--  atleta pode entrar: inscrição válida, faixa etária e suspensão.
--
--  FRESTA, PELO MESMO MOTIVO DE SEMPRE: quem escaneia não tem conta nem
--  organização, e a conferência precisa funcionar mesmo com a competição
--  ainda `em_criacao` — o atleta é credenciado antes do campeonato abrir.
--  A função é só leitura e exige os DOIS uuids: sem o par competição+atleta
--  não devolve nada, e não existe rota que enumere atletas.
--
--  O QUE ELA NÃO DEVOLVE: CPF, RG, telefone, e-mail e endereço do
--  responsável. O protótipo mostra o CPF na tela de validação; aqui não.
--  A página é pública e a maioria dos atletas é menor de idade — a
--  arbitragem precisa saber QUEM é e SE pode jogar, não o documento.
--
--  Idempotente.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_carteirinha(
  p_competicao uuid,
  p_atleta     uuid
)
RETURNS TABLE (
  competicao_id     uuid,
  competicao_nome   text,
  competicao_slug   text,
  competicao_status status_competicao,
  cidade            text,
  estado            char(2),
  cor_primaria      char(7),
  logo_url          text,
  atleta_id         uuid,
  atleta_nome       text,
  apelido           text,
  foto_url          text,
  data_nascimento   date,
  posicao           text,
  time_id           uuid,
  time_nome         text,
  escudo_url        text,
  categorias        jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.nome, c.slug, c.status, c.cidade, c.estado,
         c.cor_primaria, c.logo_url,
         a.id, a.nome, a.apelido, a.foto_url, a.data_nascimento, a.posicao,
         t.id, t.nome, t.escudo_url,
         -- uma linha por categoria em que o atleta está inscrito, com o
         -- que a arbitragem precisa decidir na hora
         (SELECT jsonb_agg(
                   jsonb_build_object(
                     'id',            k.id,
                     'nome',          k.nome,
                     'numero',        i2.numero_camisa,
                     'temporada',     c.temporada,
                     'tipo',          k.tipo,
                     -- faixa etária: o ano esperado é temporada - N, e o
                     -- Sub-N está no nome da categoria (RF011)
                     'anoNascimento', extract(year FROM a.data_nascimento)::int,
                     -- suspensão viva naquela categoria: é o que impede o
                     -- atleta de entrar em campo hoje
                     'suspensoPor',   (
                        SELECT coalesce(sum(s.jogos_suspensao - s.jogos_cumpridos), 0)
                          FROM suspensoes s
                         WHERE s.categoria_id = k.id
                           AND s.atleta_id = a.id
                           AND s.ativa
                           AND s.jogos_cumpridos < s.jogos_suspensao
                     )
                   ) ORDER BY k.ordem, k.nome)
            FROM inscricoes i2
            JOIN categorias k ON k.id = i2.categoria_id
           WHERE i2.atleta_id = a.id
             AND k.competicao_id = c.id)
    FROM inscricoes i
    JOIN categorias  k0 ON k0.id = i.categoria_id
    JOIN competicoes c  ON c.id  = k0.competicao_id
    JOIN atletas     a  ON a.id  = i.atleta_id
    JOIN times       t  ON t.id  = i.time_id
   WHERE c.id = p_competicao
     AND a.id = p_atleta
     AND c.excluida_em IS NULL
   -- o atleta pertence a UMA equipe por competição (RF010), então
   -- qualquer inscrição serve para descobrir qual é
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION fn_carteirinha(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_carteirinha(uuid, uuid) TO apitofut_app;

COMMENT ON FUNCTION fn_carteirinha(uuid, uuid) IS
  'Credencial do atleta para conferência da arbitragem (RF029). Só leitura, exige o par competição+atleta, e não devolve documento.';

COMMIT;
