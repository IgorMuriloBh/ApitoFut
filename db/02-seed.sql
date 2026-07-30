-- =====================================================================
--  APITOFUT — Carga inicial de desenvolvimento
--  Roda automaticamente após 01-schema.sql na primeira subida do container.
--  Reproduz a competição de demonstração do protótipo.
-- =====================================================================

BEGIN;

-- ---------- Organização e usuários ----------
INSERT INTO organizacoes (id, nome, documento, email_contato) VALUES
  ('11111111-1111-1111-1111-111111111111', '55 Global Sports', '12345678000199', 'contato@55globalsports.com'),
  ('22222222-2222-2222-2222-222222222222', 'Liga Mineira de Base', '98765432000188', 'contato@ligamineira.com');

-- senha_hash abaixo é apenas placeholder de desenvolvimento — trocar por bcrypt real
INSERT INTO usuarios (id, organizacao_id, nome, email, senha_hash, perfil, situacao) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'Igor Alcantara','demo@apitofut.com','$2b$12$DEV_PLACEHOLDER_TROCAR','superadmin','ativo'),
  ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',
   'Marina Duarte','marina@apitofut.com','$2b$12$DEV_PLACEHOLDER_TROCAR','organizador','ativo'),
  ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   'Rafael Torres','rafael@apitofut.com','$2b$12$DEV_PLACEHOLDER_TROCAR','organizador','pendente');

-- ---------- Competição ----------
INSERT INTO competicoes (id, organizacao_id, criado_por, nome, slug, temporada,
                         data_inicio, data_fim, estado, cidade, cor_primaria, status)
VALUES ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001','Copa Premium 2026','copa-premium-2026',2026,
        '2026-08-01','2026-09-20','MG','Belo Horizonte','#16A34A','em_andamento');

-- ---------- Categoria + configurações ----------
INSERT INTO categorias (id, competicao_id, nome, tipo, genero, modalidade, formato,
                        num_times, num_grupos, fase_mata_mata, ordem)
VALUES ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
        'Sub-11','infanto_juvenil','masculino','fut7','grupos_mata',8,2,'semi',1);

INSERT INTO categoria_regras (categoria_id) VALUES ('dddddddd-0000-0000-0000-000000000001');
INSERT INTO categoria_inscricao_config (categoria_id) VALUES ('dddddddd-0000-0000-0000-000000000001');

-- colunas visíveis na classificação (padrão do protótipo)
INSERT INTO categoria_coluna_classificacao (categoria_id, coluna, visivel)
SELECT 'dddddddd-0000-0000-0000-000000000001', c, c IN
  ('pontos','saldo_gols','gols_contra','empates','jogos','gols_pro','vitorias','derrotas')
FROM unnest(enum_range(NULL::coluna_classificacao)) c;

-- critérios de desempate na ordem padrão
INSERT INTO categoria_criterio_desempate (categoria_id, ordem, criterio, direcao) VALUES
  ('dddddddd-0000-0000-0000-000000000001',1,'pontos','DESC'),
  ('dddddddd-0000-0000-0000-000000000001',2,'coluna_extra','DESC'),
  ('dddddddd-0000-0000-0000-000000000001',3,'saldo_gols','DESC'),
  ('dddddddd-0000-0000-0000-000000000001',4,'vitorias','DESC'),
  ('dddddddd-0000-0000-0000-000000000001',5,'gols_pro','DESC'),
  ('dddddddd-0000-0000-0000-000000000001',6,'gols_contra','ASC'),
  ('dddddddd-0000-0000-0000-000000000001',7,'cartao_amarelo','ASC'),
  ('dddddddd-0000-0000-0000-000000000001',8,'cartao_vermelho','ASC'),
  ('dddddddd-0000-0000-0000-000000000001',9,'cartao_azul','ASC');

-- campos da súmula online habilitados por padrão
INSERT INTO categoria_campo_sumula (categoria_id, campo, habilitado)
SELECT 'dddddddd-0000-0000-0000-000000000001', t,
       t IN ('assistencia','cartao_amarelo','cartao_vermelho')
FROM unnest(enum_range(NULL::tipo_evento)) t;

-- ficha do atleta: nome sempre; data de nascimento apenas solicitada
INSERT INTO categoria_campo_atleta (categoria_id, campo, pedir, obrigatorio)
SELECT 'dddddddd-0000-0000-0000-000000000001', c, c = 'data_nascimento', false
FROM unnest(enum_range(NULL::campo_atleta)) c;

-- ---------- Fases e grupos ----------
INSERT INTO fases (id, categoria_id, chave, nome, tipo, num_jogos, ordem) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','grupos','Fase de Grupos','grupos',NULL,1),
  ('eeeeeeee-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001','semi','Semifinal','mata',2,2),
  ('eeeeeeee-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000001','final','Final','mata',1,3);

INSERT INTO grupos (id, categoria_id, nome, ordem) VALUES
  ('ffffffff-0000-0000-0000-00000000000a','dddddddd-0000-0000-0000-000000000001','A',1),
  ('ffffffff-0000-0000-0000-00000000000b','dddddddd-0000-0000-0000-000000000001','B',2);

-- ---------- Equipes ----------
INSERT INTO times (id, competicao_id, nome, uniforme_primario, cidade, estado, origem)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','União FC','#DC2626','Belo Horizonte','MG','organizador'),
  ('bbbbbbbb-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000001','Atlético Real','#2563EB','Belo Horizonte','MG','organizador'),
  ('bbbbbbbb-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000001','Estrela Azul','#0891B2','Belo Horizonte','MG','organizador'),
  ('bbbbbbbb-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000001','Guarani EC','#16A34A','Belo Horizonte','MG','organizador');

INSERT INTO categoria_times (categoria_id, time_id, grupo_id) VALUES
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-00000000000b'),
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','ffffffff-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000004','ffffffff-0000-0000-0000-00000000000b');

INSERT INTO comissao_tecnica (time_id, nome, cargo) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','Carlos Batista','Técnico'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Sérgio Lopes','Técnico');

-- ---------- Atletas (Sub-11 = nascidos em 2015) ----------
INSERT INTO atletas (id, nome, data_nascimento, posicao) VALUES
  ('9a000000-0000-0000-0000-000000000001','Lucas Silva','2015-03-10','Goleiro'),
  ('9a000000-0000-0000-0000-000000000002','João Santos','2015-07-22','Zagueiro'),
  ('9a000000-0000-0000-0000-000000000003','Pedro Oliveira','2015-01-15','Meia'),
  ('9a000000-0000-0000-0000-000000000004','Gabriel Souza','2015-11-02','Atacante'),
  ('9a000000-0000-0000-0000-000000000005','Rafael Costa','2015-05-30','Goleiro'),
  ('9a000000-0000-0000-0000-000000000006','Matheus Pereira','2016-02-18','Atacante');  -- fora da faixa: aparece em v_atletas_fora_faixa

INSERT INTO inscricoes (categoria_id, time_id, atleta_id, numero_camisa) VALUES
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001',1),
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000002',2),
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000003',10),
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000004',9),
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000005',1),
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000006',7);

-- ---------- Infraestrutura ----------
INSERT INTO campos (id, competicao_id, nome, endereco, tipo_piso, capacidade) VALUES
  ('c0000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Arena Pampulha','Av. Otacílio Negrão, BH','Grama sintética',500);

INSERT INTO arbitros (id, competicao_id, nome, federacao, funcao) VALUES
  ('a0000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Carlos Mendes','FMF','principal');

-- ---------- Jogo encerrado com lances ----------
INSERT INTO jogos (id, categoria_id, fase_id, grupo_id, rodada, mandante_id, visitante_id,
                   data, hora, campo_id, arbitro_id, status, periodo)
VALUES ('50000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
        'eeeeeeee-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-00000000000a',1,
        'bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003',
        '2026-08-01','09:00','c0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001','encerrado',3);

-- o gatilho fn_recalcula_placar atualiza o placar a partir destes lances
INSERT INTO jogo_eventos (jogo_id, tipo, time_id, atleta_id, assistencia_atleta_id, minuto, periodo) VALUES
  ('50000000-0000-0000-0000-000000000001','gol','bbbbbbbb-0000-0000-0000-000000000001',
   '9a000000-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000002',12,1),
  ('50000000-0000-0000-0000-000000000001','penalti','bbbbbbbb-0000-0000-0000-000000000001',
   '9a000000-0000-0000-0000-000000000003',NULL,38,1),
  ('50000000-0000-0000-0000-000000000001','gol','bbbbbbbb-0000-0000-0000-000000000003',
   '9a000000-0000-0000-0000-000000000004',NULL,22,1);

INSERT INTO jogo_eventos (jogo_id, tipo, time_id, atleta_id, minuto, periodo) VALUES
  ('50000000-0000-0000-0000-000000000001','cartao_amarelo','bbbbbbbb-0000-0000-0000-000000000003',
   '9a000000-0000-0000-0000-000000000004',30,2),
  ('50000000-0000-0000-0000-000000000001','escanteio','bbbbbbbb-0000-0000-0000-000000000001',
   NULL,15,1);

INSERT INTO jogo_escalacoes (jogo_id, atleta_id, time_id) VALUES
  ('50000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000003'),
  ('50000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000003');

COMMIT;

-- Conferência rápida (o placar deve sair 2 x 1)
-- SELECT placar_mandante, placar_visitante FROM jogos;
-- SELECT * FROM v_classificacao;
-- SELECT * FROM v_atletas_fora_faixa;
