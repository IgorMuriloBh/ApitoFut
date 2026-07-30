-- =====================================================================
--  APITOFUT — Modelo de Dados Relacional
--  Plataforma de Gestão de Competições de Futebol
--  PostgreSQL 14+
--
--  Derivado do protótipo funcional ApitoFut.html (localStorage → SGBD).
--  Cada bloco indica o requisito funcional correspondente (RF001–RF034).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- e-mail case-insensitive
CREATE EXTENSION IF NOT EXISTS "unaccent";   -- geração de slug

-- =====================================================================
--  1. DOMÍNIOS / TIPOS ENUMERADOS
--     Espelham exatamente as listas de valores do protótipo.
-- =====================================================================

CREATE TYPE perfil_usuario     AS ENUM ('superadmin','organizador','operador','tecnico','arbitro','atleta');
CREATE TYPE situacao_usuario   AS ENUM ('pendente','ativo','bloqueado');
CREATE TYPE status_competicao  AS ENUM ('em_criacao','publicada','em_andamento','encerrada');
CREATE TYPE tipo_categoria     AS ENUM ('infanto_juvenil','adulto');
CREATE TYPE genero_categoria   AS ENUM ('masculino','feminino');
CREATE TYPE modalidade         AS ENUM ('fut7','fut9','futsal','fut11');
CREATE TYPE formato_categoria  AS ENUM ('grupos_mata','pontos_mata');
CREATE TYPE tipo_fase          AS ENUM ('grupos','mata');
CREATE TYPE status_jogo        AS ENUM ('agendado','ao_vivo','encerrado','adiado','cancelado','wo');
CREATE TYPE funcao_arbitro     AS ENUM ('principal','assistente','mesario');
CREATE TYPE origem_time        AS ENUM ('organizador','link_convite');
CREATE TYPE direcao_criterio   AS ENUM ('ASC','DESC');
CREATE TYPE motivo_suspensao   AS ENUM ('acumulo_amarelos','cartao_vermelho','manual');

-- Tipos de lance da súmula online (RF005 · 1.4 e RF019)
CREATE TYPE tipo_evento AS ENUM (
  'gol','penalti','assistencia',
  'cartao_amarelo','cartao_vermelho','cartao_azul',
  'substituicao','falta','falta_recebida','escanteio',
  'defesa_dificil','defesa_penalti','desarme',
  'passe_correto','passe_errado',
  'finalizacao_certa','finalizacao_errada','finalizacao_trave',
  'jogador_destaque'
);

-- Colunas possíveis na tabela de classificação (RF005 · 1.3)
CREATE TYPE coluna_classificacao AS ENUM (
  'pontos','jogos','vitorias','empates','derrotas',
  'gols_pro','gols_contra','saldo_gols','porcentagem',
  'cartao_amarelo','cartao_vermelho','cartao_azul','coluna_extra'
);

-- Campos configuráveis da ficha de inscrição do atleta (RF005 · 2.4 e RF009)
CREATE TYPE campo_atleta AS ENUM (
  'apelido','foto','cpf','rg','certidao_nascimento','data_nascimento',
  'posicao','numero_camisa','celular','email','passaporte',
  'titulo_eleitor','genero','responsavel','nacionalidade','documentos_anexo'
);


-- =====================================================================
--  2. ORGANIZAÇÕES E USUÁRIOS  (RF002, RF031)
-- =====================================================================

-- Tenant da plataforma. No protótipo era um campo texto no usuário;
-- promovido a entidade para suportar white-label e vários usuários por conta.
CREATE TABLE organizacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text        NOT NULL,
  documento       text,                       -- CNPJ/CPF do organizador
  telefone        text,
  email_contato   citext,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id  uuid REFERENCES organizacoes(id) ON DELETE SET NULL,
  nome            text            NOT NULL,
  email           citext          NOT NULL UNIQUE,
  senha_hash      text            NOT NULL,   -- bcrypt/argon2 — nunca em texto puro
  perfil          perfil_usuario  NOT NULL DEFAULT 'organizador',
  situacao        situacao_usuario NOT NULL DEFAULT 'pendente',  -- aguarda liberação do ADM
  ultimo_acesso   timestamptz,
  liberado_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  liberado_em     timestamptz,
  criado_em       timestamptz     NOT NULL DEFAULT now(),
  atualizado_em   timestamptz     NOT NULL DEFAULT now()
);
CREATE INDEX idx_usuarios_organizacao ON usuarios(organizacao_id);
CREATE INDEX idx_usuarios_situacao    ON usuarios(situacao) WHERE situacao = 'pendente';


-- =====================================================================
--  3. COMPETIÇÕES  (RF002, RF003, RF025, RF026)
-- =====================================================================

CREATE TABLE competicoes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacao_id        uuid NOT NULL REFERENCES organizacoes(id) ON DELETE CASCADE,
  criado_por            uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  nome                  text              NOT NULL,
  slug                  text              NOT NULL,   -- endereço público: apitofut.com/{slug}
  temporada             int,                          -- ano base da faixa etária (Sub-N)
  data_inicio           date              NOT NULL,
  data_fim              date,
  regulamento           text,
  logo_url              text,
  banner_url            text,
  pais                  text              NOT NULL DEFAULT 'Brasil',
  estado                char(2)           NOT NULL,
  cidade                text              NOT NULL,
  cor_primaria          char(7)           NOT NULL DEFAULT '#16A34A',  -- hex, white-label
  dominio_personalizado text,                         -- CNAME próprio (RF002)
  status                status_competicao NOT NULL DEFAULT 'em_criacao',
  possui_categorias     boolean           NOT NULL DEFAULT true,
  publicada_em          timestamptz,
  encerrada_em          timestamptz,
  criado_em             timestamptz       NOT NULL DEFAULT now(),
  atualizado_em         timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT ck_comp_periodo   CHECK (data_fim IS NULL OR data_fim >= data_inicio),
  CONSTRAINT ck_comp_cor       CHECK (cor_primaria ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT uq_comp_slug      UNIQUE (slug),
  CONSTRAINT uq_comp_dominio   UNIQUE (dominio_personalizado)
);
CREATE INDEX idx_comp_organizacao ON competicoes(organizacao_id);
CREATE INDEX idx_comp_status      ON competicoes(status);

CREATE TABLE patrocinadores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id  uuid NOT NULL REFERENCES competicoes(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  logo_url       text,
  site_url       text,
  ordem          int  NOT NULL DEFAULT 0
);
CREATE INDEX idx_patroc_competicao ON patrocinadores(competicao_id);


-- =====================================================================
--  4. CATEGORIAS E CONFIGURAÇÕES  (RF004, RF005)
-- =====================================================================

CREATE TABLE categorias (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id    uuid NOT NULL REFERENCES competicoes(id) ON DELETE CASCADE,
  nome             text              NOT NULL,          -- "Sub-11", "Adulto"
  tipo             tipo_categoria    NOT NULL DEFAULT 'adulto',
  genero           genero_categoria  NOT NULL DEFAULT 'masculino',
  modalidade       modalidade        NOT NULL DEFAULT 'fut7',
  formato          formato_categoria NOT NULL DEFAULT 'grupos_mata',
  num_times        int               NOT NULL DEFAULT 8  CHECK (num_times  BETWEEN 2 AND 128),
  num_grupos       int               NOT NULL DEFAULT 2  CHECK (num_grupos BETWEEN 1 AND 16),
  fase_mata_mata   text              NOT NULL DEFAULT 'semi',  -- oitavas|quartas|semi|final
  turno_returno    boolean           NOT NULL DEFAULT false,
  ordem            int               NOT NULL DEFAULT 0,
  criado_em        timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT uq_categoria_nome  UNIQUE (competicao_id, nome),
  CONSTRAINT ck_grupo_unico     CHECK (formato <> 'pontos_mata' OR num_grupos = 1)
);
CREATE INDEX idx_categorias_competicao ON categorias(competicao_id);

-- 1:1 — Regras (RF005 · 1.1, 1.2, 1.5)
CREATE TABLE categoria_regras (
  categoria_id            uuid PRIMARY KEY REFERENCES categorias(id) ON DELETE CASCADE,
  suspensao_ativa         boolean NOT NULL DEFAULT false,
  num_amarelos            int     NOT NULL DEFAULT 3 CHECK (num_amarelos > 0),
  jogos_por_amarelo       int     NOT NULL DEFAULT 1 CHECK (jogos_por_amarelo >= 0),
  jogos_por_vermelho      int     NOT NULL DEFAULT 1 CHECK (jogos_por_vermelho >= 0),
  acumular_dois_amarelos  boolean NOT NULL DEFAULT false,
  pontos_vitoria          int     NOT NULL DEFAULT 3,
  pontos_empate           int     NOT NULL DEFAULT 1,
  pontos_derrota          int     NOT NULL DEFAULT 0,
  modelo_sumula           text    NOT NULL DEFAULT 'modelo1'
);

-- 1:1 — Inscrições (RF005 · 2.1, 2.2, 2.3)
CREATE TABLE categoria_inscricao_config (
  categoria_id        uuid PRIMARY KEY REFERENCES categorias(id) ON DELETE CASCADE,
  max_atletas         int     NOT NULL DEFAULT 20 CHECK (max_atletas  > 0),
  max_comissao        int     NOT NULL DEFAULT 3  CHECK (max_comissao >= 0),
  permite_inscrever   boolean NOT NULL DEFAULT true,
  permite_editar      boolean NOT NULL DEFAULT true,
  permite_remover     boolean NOT NULL DEFAULT false,
  inscricoes_abertas  boolean NOT NULL DEFAULT true
);

-- N — Colunas visíveis na classificação (RF005 · 1.3)
CREATE TABLE categoria_coluna_classificacao (
  categoria_id  uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  coluna        coluna_classificacao NOT NULL,
  visivel       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (categoria_id, coluna)
);

-- N — Critérios de desempate, ordenados (RF005 · 1.6)
CREATE TABLE categoria_criterio_desempate (
  categoria_id  uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  ordem         int  NOT NULL,
  criterio      coluna_classificacao NOT NULL,
  direcao       direcao_criterio NOT NULL DEFAULT 'DESC',
  PRIMARY KEY (categoria_id, ordem),
  CONSTRAINT uq_criterio_unico UNIQUE (categoria_id, criterio)
);

-- N — Campos habilitados na súmula online (RF005 · 1.4)
CREATE TABLE categoria_campo_sumula (
  categoria_id  uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  campo         tipo_evento NOT NULL,
  habilitado    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (categoria_id, campo)
);

-- N — Ficha de inscrição do atleta: pedir / obrigatório (RF005 · 2.4, RF009)
CREATE TABLE categoria_campo_atleta (
  categoria_id  uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  campo         campo_atleta NOT NULL,
  pedir         boolean NOT NULL DEFAULT false,
  obrigatorio   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (categoria_id, campo),
  CONSTRAINT ck_obrig_exige_pedir CHECK (NOT obrigatorio OR pedir)
);


-- =====================================================================
--  5. FASES E GRUPOS  (RF017)
-- =====================================================================

CREATE TABLE fases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id  uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  chave         text      NOT NULL,          -- 'grupos','oitavas','quartas','semi','final' ou custom
  nome          text      NOT NULL,          -- rótulo editável pelo organizador
  tipo          tipo_fase NOT NULL,
  num_jogos     int,                         -- somente para tipo 'mata'
  ordem         int       NOT NULL,
  CONSTRAINT uq_fase_chave UNIQUE (categoria_id, chave),
  CONSTRAINT uq_fase_ordem UNIQUE (categoria_id, ordem),
  CONSTRAINT ck_fase_jogos CHECK (tipo <> 'mata' OR num_jogos >= 1)
);
CREATE INDEX idx_fases_categoria ON fases(categoria_id);

CREATE TABLE grupos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id  uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  nome          char(2) NOT NULL,            -- 'A','B','C'...
  ordem         int     NOT NULL DEFAULT 0,
  CONSTRAINT uq_grupo_nome UNIQUE (categoria_id, nome)
);


-- =====================================================================
--  6. EQUIPES  (RF006, RF007)
-- =====================================================================

CREATE TABLE times (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id       uuid NOT NULL REFERENCES competicoes(id) ON DELETE CASCADE,
  nome                text        NOT NULL,
  escudo_url          text,
  uniforme_primario   char(7),
  uniforme_secundario char(7),
  cidade              text,
  estado              char(2),
  contato             text,
  email               citext,
  responsavel         text,                              -- responsável pela inscrição
  origem              origem_time NOT NULL DEFAULT 'organizador',
  codigo_acesso       char(6),                           -- auto-cadastro por link
  inscrito_em         timestamptz,
  criado_em           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_time_nome   UNIQUE (competicao_id, nome),
  CONSTRAINT uq_time_codigo UNIQUE (competicao_id, codigo_acesso)
);
CREATE INDEX idx_times_competicao ON times(competicao_id);

-- Vínculo N:N — uma equipe participa de várias categorias (RF007)
CREATE TABLE categoria_times (
  categoria_id  uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  time_id       uuid NOT NULL REFERENCES times(id)      ON DELETE CASCADE,
  grupo_id      uuid REFERENCES grupos(id) ON DELETE SET NULL,
  vinculado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (categoria_id, time_id)
);
CREATE INDEX idx_cat_times_time  ON categoria_times(time_id);
CREATE INDEX idx_cat_times_grupo ON categoria_times(grupo_id);

CREATE TABLE comissao_tecnica (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_id   uuid NOT NULL REFERENCES times(id) ON DELETE CASCADE,
  nome      text NOT NULL,
  cargo     text NOT NULL DEFAULT 'Técnico',
  documento text,
  contato   text
);
CREATE INDEX idx_comissao_time ON comissao_tecnica(time_id);


-- =====================================================================
--  7. ATLETAS  (RF008, RF009, RF010, RF011, RF012)
--  Base ÚNICA e global: o atleta é reaproveitado entre competições.
-- =====================================================================

CREATE TABLE atletas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  text NOT NULL,
  apelido               text,
  foto_url              text,
  cpf                   char(11) UNIQUE,
  rg                    text,
  certidao_nascimento   text,
  passaporte            text,
  titulo_eleitor        text,
  data_nascimento       date,
  genero                text,
  posicao               text,
  nacionalidade         text DEFAULT 'Brasileira',
  celular               text,
  email                 citext,
  responsavel_nome      text,
  responsavel_contato   text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_atletas_nome ON atletas USING gin (to_tsvector('portuguese', nome));
CREATE INDEX idx_atletas_nasc ON atletas(data_nascimento);

CREATE TABLE atleta_documentos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atleta_id   uuid NOT NULL REFERENCES atletas(id) ON DELETE CASCADE,
  tipo        text NOT NULL,
  arquivo_url text NOT NULL,
  enviado_em  timestamptz NOT NULL DEFAULT now()
);

-- Inscrição = vínculo atleta × equipe × categoria (RF010)
CREATE TABLE inscricoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id   uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  time_id        uuid NOT NULL REFERENCES times(id)      ON DELETE CASCADE,
  atleta_id      uuid NOT NULL REFERENCES atletas(id)    ON DELETE CASCADE,
  numero_camisa  int CHECK (numero_camisa BETWEEN 1 AND 99),
  criado_em      timestamptz NOT NULL DEFAULT now(),

  -- RF010: um atleta não pode estar em duas equipes da mesma categoria
  CONSTRAINT uq_inscricao_categoria UNIQUE (categoria_id, atleta_id),
  -- número de camisa único dentro da equipe naquela categoria
  CONSTRAINT uq_numero_camisa       UNIQUE (categoria_id, time_id, numero_camisa)
);
CREATE INDEX idx_inscricoes_time   ON inscricoes(time_id);
CREATE INDEX idx_inscricoes_atleta ON inscricoes(atleta_id);

-- Tabela de referência da faixa etária Sub-N (validação de aviso)
CREATE TABLE faixas_etarias (
  sub             int  PRIMARY KEY,
  ano_nascimento  int  NOT NULL,
  temporada       int  NOT NULL DEFAULT 2026
);
INSERT INTO faixas_etarias (sub, ano_nascimento) VALUES
  (5,2021),(6,2020),(7,2019),(8,2018),(9,2017),(10,2016),(11,2015),
  (12,2014),(13,2013),(14,2012),(15,2011),(16,2010),(17,2009);


-- =====================================================================
--  8. INFRAESTRUTURA  (RF013, RF014)
-- =====================================================================

CREATE TABLE campos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id  uuid NOT NULL REFERENCES competicoes(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  endereco       text,
  latitude       numeric(10,7),
  longitude      numeric(10,7),
  tipo_piso      text,
  capacidade     int CHECK (capacidade IS NULL OR capacidade >= 0),
  observacoes    text
);
CREATE INDEX idx_campos_competicao ON campos(competicao_id);

CREATE TABLE campo_fotos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campo_id    uuid NOT NULL REFERENCES campos(id) ON DELETE CASCADE,
  arquivo_url text NOT NULL,
  ordem       int  NOT NULL DEFAULT 0
);

CREATE TABLE arbitros (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competicao_id  uuid NOT NULL REFERENCES competicoes(id) ON DELETE CASCADE,
  nome           text           NOT NULL,
  cpf            char(11),
  foto_url       text,
  federacao      text,
  funcao         funcao_arbitro NOT NULL DEFAULT 'principal',
  contato        text
);
CREATE INDEX idx_arbitros_competicao ON arbitros(competicao_id);


-- =====================================================================
--  9. JOGOS  (RF015, RF016, RF017, RF019, RF020)
-- =====================================================================

CREATE TABLE jogos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id        uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  fase_id             uuid REFERENCES fases(id)  ON DELETE CASCADE,
  grupo_id            uuid REFERENCES grupos(id) ON DELETE SET NULL,
  rodada              int,
  ordem               int NOT NULL DEFAULT 0,      -- posição no chaveamento

  mandante_id         uuid REFERENCES times(id) ON DELETE SET NULL,
  visitante_id        uuid REFERENCES times(id) ON DELETE SET NULL,
  mandante_rotulo     text,                        -- "1º Grupo A" / "Vencedor Semifinal 1"
  visitante_rotulo    text,

  data                date,                        -- nulo na geração simples
  hora                time,
  campo_id            uuid REFERENCES campos(id)   ON DELETE SET NULL,
  arbitro_id          uuid REFERENCES arbitros(id) ON DELETE SET NULL,

  status              status_jogo NOT NULL DEFAULT 'agendado',
  placar_mandante     int NOT NULL DEFAULT 0 CHECK (placar_mandante  >= 0),
  placar_visitante    int NOT NULL DEFAULT 0 CHECK (placar_visitante >= 0),
  penaltis_mandante   int CHECK (penaltis_mandante  >= 0),
  penaltis_visitante  int CHECK (penaltis_visitante >= 0),

  -- Cronômetro da partida (zera no intervalo, reinicia no 2º tempo)
  periodo             smallint NOT NULL DEFAULT 0 CHECK (periodo BETWEEN 0 AND 3),
  crono_base_seg      int      NOT NULL DEFAULT 0,
  crono_rodando       boolean  NOT NULL DEFAULT false,
  crono_desde         timestamptz,

  observacoes         text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_adversarios CHECK (mandante_id IS NULL OR visitante_id IS NULL
                                   OR mandante_id <> visitante_id)
);
CREATE INDEX idx_jogos_categoria ON jogos(categoria_id);
CREATE INDEX idx_jogos_data      ON jogos(data);
CREATE INDEX idx_jogos_status    ON jogos(status) WHERE status = 'ao_vivo';
CREATE INDEX idx_jogos_times     ON jogos(mandante_id, visitante_id);

-- Escalação da partida
CREATE TABLE jogo_escalacoes (
  jogo_id      uuid NOT NULL REFERENCES jogos(id)      ON DELETE CASCADE,
  atleta_id    uuid NOT NULL REFERENCES atletas(id)    ON DELETE CASCADE,
  time_id      uuid NOT NULL REFERENCES times(id)      ON DELETE CASCADE,
  titular      boolean NOT NULL DEFAULT true,
  minutos      int,
  PRIMARY KEY (jogo_id, atleta_id)
);
CREATE INDEX idx_escalacoes_atleta ON jogo_escalacoes(atleta_id);

-- Lances da súmula online (RF019, RF021)
CREATE TABLE jogo_eventos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jogo_id                  uuid NOT NULL REFERENCES jogos(id)   ON DELETE CASCADE,
  tipo                     tipo_evento NOT NULL,
  time_id                  uuid NOT NULL REFERENCES times(id)   ON DELETE CASCADE,
  atleta_id                uuid REFERENCES atletas(id) ON DELETE SET NULL,  -- nulo em escanteio
  assistencia_atleta_id    uuid REFERENCES atletas(id) ON DELETE SET NULL,
  substituido_atleta_id    uuid REFERENCES atletas(id) ON DELETE SET NULL,
  minuto                   int      NOT NULL CHECK (minuto >= 0),
  periodo                  smallint NOT NULL DEFAULT 1 CHECK (periodo IN (1,2,3)),
  gol_contra               boolean  NOT NULL DEFAULT false,
  registrado_por           uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em                timestamptz NOT NULL DEFAULT now(),
  atualizado_em            timestamptz NOT NULL DEFAULT now(),

  -- escanteio é o único lance sem atleta; os demais exigem atleta
  CONSTRAINT ck_evento_atleta    CHECK (tipo = 'escanteio' OR atleta_id IS NOT NULL),
  -- a assistência nunca é do próprio autor do gol
  CONSTRAINT ck_assist_diferente CHECK (assistencia_atleta_id IS NULL
                                        OR assistencia_atleta_id <> atleta_id)
);
CREATE INDEX idx_eventos_jogo   ON jogo_eventos(jogo_id);
CREATE INDEX idx_eventos_atleta ON jogo_eventos(atleta_id);
CREATE INDEX idx_eventos_tipo   ON jogo_eventos(tipo);


-- =====================================================================
-- 10. SUSPENSÕES  (RF005 · 1.1, RF032)
-- =====================================================================

CREATE TABLE suspensoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id      uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  atleta_id         uuid NOT NULL REFERENCES atletas(id)    ON DELETE CASCADE,
  motivo            motivo_suspensao NOT NULL,
  evento_origem_id  uuid REFERENCES jogo_eventos(id) ON DELETE SET NULL,
  jogos_suspensao   int NOT NULL CHECK (jogos_suspensao > 0),
  jogos_cumpridos   int NOT NULL DEFAULT 0 CHECK (jogos_cumpridos >= 0),
  ativa             boolean NOT NULL DEFAULT true,
  observacao        text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_cumpridos CHECK (jogos_cumpridos <= jogos_suspensao)
);
CREATE INDEX idx_suspensoes_atleta ON suspensoes(atleta_id) WHERE ativa;


-- =====================================================================
-- 11. REGRAS DE NEGÓCIO EM BANCO
-- =====================================================================

-- RF010 — o atleta pode disputar várias categorias da mesma competição,
-- desde que SEMPRE pela mesma equipe.
CREATE OR REPLACE FUNCTION fn_valida_equipe_unica() RETURNS trigger AS $$
DECLARE
  v_competicao uuid;
  v_outro_time uuid;
BEGIN
  SELECT c.competicao_id INTO v_competicao
    FROM categorias c WHERE c.id = NEW.categoria_id;

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

CREATE TRIGGER trg_inscricao_equipe_unica
  BEFORE INSERT OR UPDATE ON inscricoes
  FOR EACH ROW EXECUTE FUNCTION fn_valida_equipe_unica();


-- RF005 · 2.1 — respeita o limite de atletas por equipe na categoria
CREATE OR REPLACE FUNCTION fn_valida_limite_elenco() RETURNS trigger AS $$
DECLARE
  v_max   int;
  v_atual int;
BEGIN
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

CREATE TRIGGER trg_inscricao_limite
  BEFORE INSERT ON inscricoes
  FOR EACH ROW EXECUTE FUNCTION fn_valida_limite_elenco();


-- Placar sempre derivado dos lances (gol e gol de pênalti; gol contra inverte)
CREATE OR REPLACE FUNCTION fn_recalcula_placar() RETURNS trigger AS $$
DECLARE
  v_jogo uuid := COALESCE(NEW.jogo_id, OLD.jogo_id);
BEGIN
  UPDATE jogos j SET
    placar_mandante = (
      SELECT count(*) FROM jogo_eventos e WHERE e.jogo_id = j.id
        AND e.tipo IN ('gol','penalti')
        AND ((NOT e.gol_contra AND e.time_id = j.mandante_id)
          OR (    e.gol_contra AND e.time_id = j.visitante_id))),
    placar_visitante = (
      SELECT count(*) FROM jogo_eventos e WHERE e.jogo_id = j.id
        AND e.tipo IN ('gol','penalti')
        AND ((NOT e.gol_contra AND e.time_id = j.visitante_id)
          OR (    e.gol_contra AND e.time_id = j.mandante_id))),
    atualizado_em = now()
  WHERE j.id = v_jogo;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_placar
  AFTER INSERT OR UPDATE OR DELETE ON jogo_eventos
  FOR EACH ROW EXECUTE FUNCTION fn_recalcula_placar();


-- Atualização automática de atualizado_em
CREATE OR REPLACE FUNCTION fn_touch() RETURNS trigger AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_touch_competicoes BEFORE UPDATE ON competicoes
  FOR EACH ROW EXECUTE FUNCTION fn_touch();
CREATE TRIGGER trg_touch_usuarios BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_touch();
CREATE TRIGGER trg_touch_atletas BEFORE UPDATE ON atletas
  FOR EACH ROW EXECUTE FUNCTION fn_touch();


-- =====================================================================
-- 12. VISÕES DE APOIO
-- =====================================================================

-- Estatísticas individuais consolidadas (RF022)
CREATE OR REPLACE VIEW v_estatisticas_atleta AS
SELECT
  i.categoria_id,
  i.atleta_id,
  i.time_id,
  count(DISTINCT esc.jogo_id)                                   AS jogos,
  count(*) FILTER (WHERE e.tipo IN ('gol','penalti'))            AS gols,
  count(*) FILTER (WHERE e.tipo = 'assistencia')                 AS assistencias_evento,
  count(ea.id)                                                   AS assistencias,
  count(*) FILTER (WHERE e.tipo = 'cartao_amarelo')              AS cartoes_amarelos,
  count(*) FILTER (WHERE e.tipo = 'cartao_vermelho')             AS cartoes_vermelhos,
  count(*) FILTER (WHERE e.tipo IN ('defesa_dificil','defesa_penalti')) AS defesas
FROM inscricoes i
LEFT JOIN jogo_escalacoes esc ON esc.atleta_id = i.atleta_id
LEFT JOIN jogos      j  ON j.id = esc.jogo_id AND j.categoria_id = i.categoria_id
LEFT JOIN jogo_eventos e  ON e.atleta_id = i.atleta_id AND e.jogo_id = j.id
LEFT JOIN jogo_eventos ea ON ea.assistencia_atleta_id = i.atleta_id AND ea.jogo_id = j.id
GROUP BY i.categoria_id, i.atleta_id, i.time_id;


-- Classificação da fase de grupos (RF005 · 1.3)
-- A ordenação final aplica categoria_criterio_desempate na camada de aplicação
-- ou via ORDER BY dinâmico montado a partir da tabela de critérios.
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
  count(*) FILTER (WHERE r.gp > r.gc) * reg.pontos_vitoria
    + count(*) FILTER (WHERE r.gp = r.gc) * reg.pontos_empate
    + count(*) FILTER (WHERE r.gp < r.gc) * reg.pontos_derrota  AS pontos,
  COALESCE(c.ca,0)  AS cartao_amarelo,
  COALESCE(c.cv,0)  AS cartao_vermelho,
  COALESCE(c.caz,0) AS cartao_azul
FROM resultados r
JOIN times t ON t.id = r.time_id
JOIN categoria_regras reg ON reg.categoria_id = r.categoria_id
LEFT JOIN cartoes c ON c.categoria_id = r.categoria_id AND c.time_id = r.time_id
GROUP BY r.categoria_id, r.grupo_id, r.time_id, t.nome,
         reg.pontos_vitoria, reg.pontos_empate, reg.pontos_derrota,
         c.ca, c.cv, c.caz;


-- Atletas fora da faixa etária da categoria (validação de aviso)
CREATE OR REPLACE VIEW v_atletas_fora_faixa AS
SELECT
  i.categoria_id, cat.nome AS categoria, i.atleta_id, a.nome AS atleta,
  extract(year FROM a.data_nascimento)::int AS ano_atleta,
  fx.ano_nascimento                         AS ano_esperado
FROM inscricoes i
JOIN categorias cat ON cat.id = i.categoria_id
JOIN atletas    a   ON a.id  = i.atleta_id
JOIN faixas_etarias fx
  ON fx.sub = NULLIF(regexp_replace(cat.nome, '^.*[Ss][Uu][Bb][^0-9]*([0-9]{1,2}).*$', '\1'), cat.nome)::int
WHERE a.data_nascimento IS NOT NULL
  AND extract(year FROM a.data_nascimento)::int <> fx.ano_nascimento;

COMMIT;

-- =====================================================================
--  NOTAS DE IMPLANTAÇÃO
--
--  • Imagens (escudos, fotos, logos) devem ir para storage de objetos
--    (S3/GCS) — as colunas *_url guardam apenas o endereço.
--  • Isolamento multi-tenant: aplicar Row Level Security em competicoes
--    e descendentes, com a organizacao_id do usuário autenticado.
--  • Tempo real (RF020): publicar jogo_eventos via LISTEN/NOTIFY,
--    WebSocket ou Supabase Realtime.
--  • Classificação: para competições grandes, materializar v_classificacao
--    e refrescar ao encerrar cada jogo.
-- =====================================================================
