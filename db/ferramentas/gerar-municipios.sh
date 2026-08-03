#!/usr/bin/env bash
# Regenera db/18-municipios.sql a partir da API de localidades do IBGE.
#
# Só é preciso rodar quando o IBGE mudar a divisão municipal — o que
# acontece a cada poucos anos. O arquivo gerado é versionado de propósito:
# migration não pode depender de rede na hora de subir o banco.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "Baixando do IBGE…"
curl -sf --max-time 60 \
  "https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome" \
  -o /tmp/apitofut-uf.json
curl -sf --max-time 120 \
  "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome" \
  -o /tmp/apitofut-mun.json

python3 db/ferramentas/gerar-municipios.py
echo "db/18-municipios.sql regenerado."
