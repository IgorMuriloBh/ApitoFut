-- =====================================================================
--  APITOFUT — Migration 13: avanço automático no mata-mata (RF017)
--
--  A geração da tabela cria o chaveamento com rótulos ("Vencedor
--  Semifinal 1"), mas ninguém preenchia a equipe ao encerrar o jogo. Na
--  prática a competição não terminava: jogava-se a semifinal e a final
--  ficava "A definir" para sempre.
--
--  Espelha `avancarVencedor` do protótipo:
--    vencedor = maior placar; empatou, decide nos pênaltis
--    o i-ésimo jogo da fase alimenta o (i/2)-ésimo da fase seguinte
--    índice par entra como mandante; ímpar, como visitante
--
--  POR QUE TRIGGER E NÃO CÓDIGO DA API: encerrar um jogo é o gatilho, e
--  ele pode vir do endpoint da súmula, de um W.O. lançado direto, ou de
--  correção por SQL. No banco, o chaveamento avança em todos os casos.
--
--  Também DESFAZ: reabrir um jogo encerrado limpa a vaga que ele havia
--  preenchido. Sem isso, corrigir um resultado deixaria o vencedor antigo
--  na fase seguinte — o protótipo não trata esse caso porque lá não havia
--  reabertura.
--
--  Idempotente.
-- =====================================================================

BEGIN;

/**
 * Qual jogo da fase seguinte recebe o vencedor deste, e de que lado.
 * Devolve NULL quando não há fase seguinte (a final) ou quando o jogo
 * não é de mata-mata.
 */
CREATE OR REPLACE FUNCTION fn_destino_do_vencedor(p_jogo uuid)
RETURNS TABLE (jogo_destino uuid, como_mandante boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH atual AS (
    SELECT j.id, j.categoria_id, j.fase_id, f.ordem AS fase_ordem
      FROM jogos j
      JOIN fases f ON f.id = j.fase_id
     WHERE j.id = p_jogo
       AND f.tipo = 'mata'
  ),
  -- posição do jogo dentro da própria fase (0-based)
  posicao AS (
    SELECT (
      SELECT count(*)
        FROM jogos irmao
       WHERE irmao.fase_id = a.fase_id
         AND (irmao.ordem, irmao.id) < (j.ordem, j.id)
    ) AS i
      FROM atual a
      JOIN jogos j ON j.id = a.id
  ),
  proxima AS (
    SELECT f.id
      FROM fases f, atual a
     WHERE f.categoria_id = a.categoria_id
       AND f.tipo = 'mata'
       AND f.ordem > a.fase_ordem
     ORDER BY f.ordem
     LIMIT 1
  )
  SELECT alvo.id, (p.i % 2 = 0)
    FROM posicao p, proxima pr
    JOIN LATERAL (
      SELECT j.id
        FROM jogos j
       WHERE j.fase_id = pr.id
       ORDER BY j.ordem, j.id
       OFFSET (SELECT i / 2 FROM posicao)
       LIMIT 1
    ) alvo ON true;
$$;

CREATE OR REPLACE FUNCTION fn_avanca_mata_mata() RETURNS trigger AS $$
DECLARE
  v_vencedor uuid;
  v_destino  uuid;
  v_mandante boolean;
  v_era_encerrado boolean := (OLD.status = 'encerrado');
  v_esta_encerrado boolean := (NEW.status = 'encerrado');
BEGIN
  -- nada a fazer se o encerramento não mudou
  IF v_era_encerrado = v_esta_encerrado
     AND NEW.placar_mandante IS NOT DISTINCT FROM OLD.placar_mandante
     AND NEW.placar_visitante IS NOT DISTINCT FROM OLD.placar_visitante
     AND NEW.penaltis_mandante IS NOT DISTINCT FROM OLD.penaltis_mandante
     AND NEW.penaltis_visitante IS NOT DISTINCT FROM OLD.penaltis_visitante
  THEN
    RETURN NULL;
  END IF;

  SELECT d.jogo_destino, d.como_mandante
    INTO v_destino, v_mandante
    FROM fn_destino_do_vencedor(NEW.id) d;

  IF v_destino IS NULL THEN
    RETURN NULL;  -- fase de grupos, ou já é a final
  END IF;

  IF v_esta_encerrado THEN
    v_vencedor := CASE
      WHEN NEW.placar_mandante  > NEW.placar_visitante  THEN NEW.mandante_id
      WHEN NEW.placar_visitante > NEW.placar_mandante   THEN NEW.visitante_id
      WHEN NEW.penaltis_mandante  > NEW.penaltis_visitante THEN NEW.mandante_id
      WHEN NEW.penaltis_visitante > NEW.penaltis_mandante  THEN NEW.visitante_id
      ELSE NULL  -- empate sem pênaltis: não há vencedor a promover
    END;
  ELSE
    v_vencedor := NULL;  -- reaberto: esvazia a vaga que este jogo ocupava
  END IF;

  IF v_mandante THEN
    UPDATE jogos SET mandante_id = v_vencedor WHERE id = v_destino;
  ELSE
    UPDATE jogos SET visitante_id = v_vencedor WHERE id = v_destino;
  END IF;

  RETURN NULL;
END; $$ LANGUAGE plpgsql;

-- AFTER UPDATE: o placar já foi recalculado por fn_recalcula_placar antes
-- de chegarmos aqui, então a decisão do vencedor usa o valor definitivo.
DROP TRIGGER IF EXISTS trg_avanca_mata_mata ON jogos;
CREATE TRIGGER trg_avanca_mata_mata
  AFTER UPDATE ON jogos
  FOR EACH ROW EXECUTE FUNCTION fn_avanca_mata_mata();

COMMIT;

-- =====================================================================
--  NOTA — ck_adversarios
--  O schema impede mandante = visitante. Como as duas vagas são
--  preenchidas por jogos diferentes da fase anterior, elas nunca recebem
--  a mesma equipe: cada jogo alimenta exatamente um lado de um destino.
-- =====================================================================
