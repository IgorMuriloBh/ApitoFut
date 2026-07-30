-- =====================================================================
--  APITOFUT — Migration 07: tempo real da súmula (RF020)
--
--  O banco avisa quem estiver ouvindo sempre que um lance é registrado ou
--  o estado do jogo muda. A aplicação escuta em conexão dedicada e repassa
--  aos torcedores por SSE.
--
--  O QUE VIAJA NO AVISO — e o que NÃO viaja:
--
--  Nenhum dado de atleta entra no payload. Nem nome, nem id. O aviso diz
--  "houve um gol aos 12' do 1º tempo, placar 2x1" e nada mais; quem quiser
--  saber quem fez busca o detalhe do jogo, que já aplica a regra de
--  visibilidade. Assim o canal de tempo real não tem como vazar nome de
--  menor de idade, mesmo se o filtro do SSE falhar um dia.
--
--  Também mantém o payload pequeno: pg_notify tem teto de 8000 bytes.
--
--  Idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Aviso de lance. O nome começa com `trg_zz_` de propósito: o PostgreSQL
-- dispara triggers do mesmo evento em ordem alfabética, e este precisa
-- rodar DEPOIS de `trg_placar` para que o placar já esteja recalculado
-- quando montarmos o payload.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_notifica_lance() RETURNS trigger AS $$
DECLARE
  v_evento jogo_eventos%ROWTYPE := COALESCE(NEW, OLD);
  v_jogo   jogos%ROWTYPE;
BEGIN
  SELECT * INTO v_jogo FROM jogos WHERE id = v_evento.jogo_id;
  IF NOT FOUND THEN
    RETURN NULL;  -- jogo removido em cascata: não há a quem avisar
  END IF;

  PERFORM pg_notify('apitofut_jogo', json_build_object(
    'jogoId',      v_jogo.id,
    'categoriaId', v_jogo.categoria_id,
    'tipo',        'lance',
    'acao',        lower(TG_OP),            -- insert | update | delete
    'lance',       v_evento.tipo,
    'minuto',      v_evento.minuto,
    'periodo',     v_evento.periodo,
    'timeId',      v_evento.time_id,
    'placar',      json_build_object(
                     'mandante',  v_jogo.placar_mandante,
                     'visitante', v_jogo.placar_visitante),
    'status',      v_jogo.status
  )::text);

  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_zz_notifica_lance ON jogo_eventos;
CREATE TRIGGER trg_zz_notifica_lance
  AFTER INSERT OR UPDATE OR DELETE ON jogo_eventos
  FOR EACH ROW EXECUTE FUNCTION fn_notifica_lance();


-- ---------------------------------------------------------------------
-- Aviso de mudança no próprio jogo: início e fim de tempo, cronômetro,
-- W.O., adiamento. Coisas que acontecem sem nenhum lance associado.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_notifica_jogo() RETURNS trigger AS $$
BEGIN
  -- só avisa quando muda algo que o torcedor vê
  IF NEW.status           IS NOT DISTINCT FROM OLD.status
     AND NEW.periodo      IS NOT DISTINCT FROM OLD.periodo
     AND NEW.crono_rodando IS NOT DISTINCT FROM OLD.crono_rodando
     AND NEW.placar_mandante  IS NOT DISTINCT FROM OLD.placar_mandante
     AND NEW.placar_visitante IS NOT DISTINCT FROM OLD.placar_visitante
  THEN
    RETURN NULL;
  END IF;

  PERFORM pg_notify('apitofut_jogo', json_build_object(
    'jogoId',      NEW.id,
    'categoriaId', NEW.categoria_id,
    'tipo',        'jogo',
    'status',      NEW.status,
    'periodo',     NEW.periodo,
    'cronoRodando', NEW.crono_rodando,
    'cronoBaseSeg', NEW.crono_base_seg,
    'placar',      json_build_object(
                     'mandante',  NEW.placar_mandante,
                     'visitante', NEW.placar_visitante)
  )::text);

  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notifica_jogo ON jogos;
CREATE TRIGGER trg_notifica_jogo
  AFTER UPDATE ON jogos
  FOR EACH ROW EXECUTE FUNCTION fn_notifica_jogo();

COMMIT;

-- =====================================================================
--  DO LADO DA APLICAÇÃO
--
--  O LISTEN precisa de conexão DEDICADA — a inscrição vive no socket, e
--  uma conexão de pool é reciclada entre requisições, o que derrubaria a
--  escuta em silêncio. Ver src/realtime/realtime.service.ts.
--
--  Testar pelo psql:
--     LISTEN apitofut_jogo;
--     -- em outra sessão, registre um lance e observe o aviso chegar
-- =====================================================================
