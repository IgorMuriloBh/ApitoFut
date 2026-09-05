-- =====================================================================
--  APITOFUT — Migration 20: a suspensão não vale no jogo que a gerou
--
--  DEFEITO CORRIGIDO (500 em produção, achado percorrendo o roteiro de
--  teste). Lançar pela API o cartão que gera a suspensão derrubava a
--  requisição inteira:
--
--    1. `POST /painel/jogos/:id/lances` grava o cartão;
--    2. `trg_zz_cartao_suspensao` cria a suspensão na hora;
--    3. o mesmo endpoint escala quem participou do lance;
--    4. `fn_bloqueia_escalacao_suspensa` recusa escalar o atleta — que
--       acabou de ser advertido NAQUELE jogo — e derruba a transação.
--
--  Ou seja: o sistema recusava registrar que o jogador estava em campo no
--  exato momento em que registrava o cartão dele. Valia para o terceiro
--  amarelo e, pior, para QUALQUER cartão vermelho: expulsão pela súmula
--  respondia "Internal server error" e nada era gravado.
--
--  A regra sempre foi "a suspensão vale a partir da partida seguinte" —
--  `fn_cumpre_suspensoes` já a aplicava para descontar jogos. O bloqueio
--  nunca soube dela. Esta migration alinha os dois.
--
--  Idempotente.
-- =====================================================================

BEGIN;

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
     AND s.atleta_id = NEW.atleta_id
     -- Suspensão nascida NESTE jogo não vale para ele: o atleta estava em
     -- campo, foi por isso que levou o cartão. Mesma condição que
     -- `fn_cumpre_suspensoes` usa para não descontar no próprio jogo —
     -- as duas leem a mesma regra, cada uma do seu lado.
     AND NOT EXISTS (
       SELECT 1 FROM jogo_eventos e
        WHERE e.id = s.evento_origem_id
          AND e.jogo_id = NEW.jogo_id
     );

  IF coalesce(v_jogos, 0) > 0 THEN
    RAISE EXCEPTION
      'Atleta com suspensão em vigor: % jogo(s) a cumprir nesta categoria.', v_jogos
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

COMMIT;
