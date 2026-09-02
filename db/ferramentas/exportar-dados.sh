#!/usr/bin/env bash
# =====================================================================
#  Exporta os DADOS do banco local para levar a outro ambiente.
#
#  Só dados, nunca schema: o destino recebe a estrutura pelo runner
#  (db/migrar.mjs), e misturar as duas coisas faria a ordem importar.
#
#  POR QUE --disable-triggers. O schema é cheio de trigger que deriva
#  dado: placar recalculado a partir dos lances, vencedor que sobe no
#  mata-mata, suspensão que nasce do cartão. Restaurar com eles ativos
#  faria cada linha inserida disparar a regra de novo — placar dobrado,
#  vaga preenchida duas vezes. Os dados já vêm com o resultado computado.
#
#  O que NÃO vai junto:
#    _migracoes   é o registro do destino, não do origem
#    estados / municipios   catálogo do IBGE, vem da migration 18
#    faixas_etarias         catálogo fixo, vem da migration 03
#  As três já existem no destino assim que o runner roda; copiá-las de
#  novo só produz violação de chave primária.
#
#  Uso:
#    db/ferramentas/exportar-dados.sh              > dados.sql
#    db/ferramentas/exportar-dados.sh --sem-demo   > dados.sql
#
#  --sem-demo tira as contas de demonstração (senha "demo") e a Copa
#  Premium do seed. Use isto se o destino for público.
# =====================================================================
set -euo pipefail

SEM_DEMO=0
[ "${1:-}" = "--sem-demo" ] && SEM_DEMO=1

EXCLUIR=(
  --exclude-table-data=_migracoes
  --exclude-table-data=estados
  --exclude-table-data=municipios
  --exclude-table-data=faixas_etarias
)

# pg_dump vive no contêiner; a máquina não tem cliente Postgres instalado
docker compose exec -T db pg_dump \
  -U apitofut -d apitofut \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  "${EXCLUIR[@]}"

if [ "$SEM_DEMO" = "1" ]; then
  echo
  echo "-- ── remoção do dado de demonstração ──────────────────────────"
  echo "-- As contas do seed usam a senha 'demo' e não podem existir num"
  echo "-- ambiente exposto. A competição de demonstração vai junto."
  echo "DELETE FROM competicoes WHERE slug = 'copa-premium-2026';"
  echo "DELETE FROM usuarios WHERE email IN ('demo@apitofut.com','marina@apitofut.com','rafael@apitofut.com');"
  echo "-- organização órfã, se sobrar"
  echo "DELETE FROM organizacoes o WHERE NOT EXISTS ("
  echo "  SELECT 1 FROM usuarios u WHERE u.organizacao_id = o.id);"
fi
