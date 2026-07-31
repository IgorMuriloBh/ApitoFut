#!/bin/sh
# =====================================================================
#  APITOFUT — senha do papel da aplicação, vinda do ambiente
#
#  A migration 06 cria `apitofut_app` com uma senha de desenvolvimento
#  fixa no SQL — arquivo versionado não é lugar de segredo. Este script
#  roda depois dela no initdb e troca a senha por APITOFUT_APP_PASSWORD.
#
#  Arquivo .sh (e não .sql) porque só um script enxerga o ambiente do
#  contêiner; o psql do initdb não interpola variáveis de ambiente.
#
#  Em produção: defina APITOFUT_APP_PASSWORD (e POSTGRES_PASSWORD) no
#  ambiente antes de subir. Sem isso, seguem os padrões de dev e o script
#  avisa no log.
# =====================================================================
set -e

if [ -z "$APITOFUT_APP_PASSWORD" ] || [ "$APITOFUT_APP_PASSWORD" = "apitofut_app_dev" ]; then
  echo "AVISO: apitofut_app está com a senha padrão de desenvolvimento."
  echo "       Defina APITOFUT_APP_PASSWORD antes de expor este banco."
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  ALTER ROLE apitofut_app WITH PASSWORD '$APITOFUT_APP_PASSWORD';
EOSQL

echo "Senha de apitofut_app definida a partir do ambiente."
