# ApitoFut

Plataforma de gestão de competições de futebol. Atende ligas, federações, escolas de
futebol e promotoras de eventos: cadastro de competições, categorias, equipes, atletas,
geração de tabela, súmula ao vivo, classificação, estatísticas e portal público.

## Estado do projeto

Existe um **protótipo funcional validado** em `prototipo/ApitoFut.html` — arquivo único,
sem servidor, dados em `localStorage`. Todas as telas e regras de negócio foram testadas
ali com o cliente. O backend ainda não existe.

O trabalho agora é reimplementar o protótipo como aplicação real, preservando as regras
já validadas. **Antes de decidir o comportamento de qualquer tela, consulte o protótipo** —
ele é a especificação executável.

## Documentação

- `docs/especificacao-completa.docx` — requisitos funcionais RF001 a RF034
- `docs/modelo-dados-apitofut.docx` — dicionário de dados e decisões de modelagem
- `db/01-schema.sql` — DDL PostgreSQL, fonte da verdade do banco
- `db/03-hardening.sql` — migration de correções (locks, defaults de categoria,
  pênalti perdido, faixa etária por temporada, slug, checks de hex)
- `db/optional/rls.sql` — políticas de Row Level Security, **não** aplicadas
  automaticamente; ativar quando a role de conexão da aplicação existir

## Banco de dados

```bash
docker compose up -d          # sobe Postgres 16 + Adminer
docker compose down -v        # zera tudo e reaplica schema + seed na próxima subida
psql postgresql://apitofut:apitofut_dev@localhost:5432/apitofut
```

Adminer em http://localhost:8080 · servidor `db` · usuário `apitofut` · senha `apitofut_dev`

Os arquivos de `db/` rodam em ordem alfabética **apenas na primeira subida** do volume.
Ao alterar o schema, use `docker compose down -v` ou crie uma migration.

## Regras de negócio que não podem quebrar

Estas foram validadas no protótipo e várias estão garantidas por constraint/trigger:

- **Atleta pertence a uma equipe só** dentro de uma competição, mesmo disputando várias
  categorias (RF010) — trigger `fn_valida_equipe_unica`
- **Placar é derivado dos lances**, nunca editado direto — trigger `fn_recalcula_placar`.
  Gol e gol de pênalti contam; `gol_contra` inverte o lado
- **Escanteio é o único lance sem atleta**; todos os outros exigem atleta
- **Assistência nunca é do próprio autor do gol** e só é lançada junto com o gol
- **Minuto e período do lance são imutáveis** após o registro — a edição permite trocar
  atleta, equipe e assistência, mas não o tempo
- **Limite de atletas por equipe** vem de `categoria_inscricao_config.max_atletas`
- **Configurações são por categoria**, replicáveis mas editáveis individualmente
- **Faixa etária Sub-N é aviso, não bloqueio** — tabela `faixas_etarias`

## Visibilidade do portal público

O `status` da competição governa o que aparece:

| status | portal |
|---|---|
| `em_criacao` | invisível ao público |
| `publicada` | tabela de jogos e classificação; **nenhum nome de atleta** |
| `em_andamento` / `encerrada` | tudo, inclusive escalações e tempo real |

Essa regra é sensível — nomes de menores de idade não podem vazar antes da hora.
Ao mexer no portal, verifique as três camadas de proteção que existem no protótipo.

## Convenções

- Nomes de tabelas e colunas em **português, snake_case, plural nas tabelas**
- PKs `uuid` com `gen_random_uuid()`
- Timestamps `timestamptz`, colunas `criado_em` / `atualizado_em`
- Imagens vão para storage de objetos; o banco guarda só `*_url`
- Senhas com bcrypt/argon2 — o seed usa placeholder, trocar antes de qualquer deploy

## Stack sugerida (a confirmar)

Nada foi implementado ainda. A decisão de stack está em aberto; o schema é agnóstico.
Requisitos que influenciam a escolha:

- Tempo real na súmula (RF020) — WebSocket ou LISTEN/NOTIFY
- Multi-tenant com isolamento por organização — avaliar Row Level Security
- Portal público com bom SEO por competição (white-label, domínio próprio)

## Ao trabalhar neste projeto

- Rode o protótipo no navegador antes de reimplementar uma tela
- Mudança de schema = nova migration, nunca editar `01-schema.sql` retroativamente
- Regra nova de negócio: avalie se cabe no banco (constraint/trigger) antes de pôr só no código
