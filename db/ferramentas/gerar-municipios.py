"""Gera db/18-municipios.sql a partir dos JSONs baixados do IBGE.

Chamado por gerar-municipios.sh. Separado do shell porque montar 5.500
linhas de VALUES com escape correto em bash seria pior de ler e de manter.
"""

import json

CABECALHO = """-- =====================================================================
--  APITOFUT — Migration 18: estados e municípios do Brasil
--
--  O wizard pedia a cidade em campo livre. "Belo Horizonte", "belo
--  horizonte" e "BH" viravam três cidades diferentes, e nenhum filtro por
--  praça funcionava depois.
--
--  Fonte: IBGE, API de localidades, {n_uf} UFs e {n_mun} municípios.
--  Os ids são os códigos oficiais do IBGE — não são gerados aqui, e é isso
--  que permite cruzar com qualquer outra base pública depois.
--
--  Estes dados são da PLATAFORMA, não de uma organização: nenhum RLS, e
--  leitura liberada ao papel da aplicação. Uma cidade não pertence a
--  ninguém.
--
--  Regenerar: `db/ferramentas/gerar-municipios.sh`.
--  Idempotente.
-- =====================================================================

BEGIN;

/**
 * Remove acento sem depender da extensão `unaccent`.
 *
 * A `unaccent()` da extensão não é IMMUTABLE (o dicionário é carregado do
 * disco), então não entra em índice sem um wrapper de qualquer jeito — e o
 * wrapper mentiria sobre a imutabilidade. Um `translate` cobre o
 * português, é IMMUTABLE de verdade e não adiciona extensão ao banco.
 */
CREATE OR REPLACE FUNCTION unaccent_simples(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT translate(
    t,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
  );
$$;

CREATE TABLE IF NOT EXISTS estados (
  sigla   char(2) PRIMARY KEY,
  codigo  int     NOT NULL UNIQUE,   -- código IBGE da UF
  nome    text    NOT NULL,
  regiao  char(2) NOT NULL
);

CREATE TABLE IF NOT EXISTS municipios (
  codigo  int     PRIMARY KEY,        -- código IBGE de 7 dígitos
  uf      char(2) NOT NULL REFERENCES estados(sigla),
  nome    text    NOT NULL
);

-- a busca do wizard é sempre "municípios daquela UF, começando por…"
CREATE INDEX IF NOT EXISTS idx_municipios_uf ON municipios(uf, nome);

-- acento não pode atrapalhar quem digita: 'sao goncalo' acha 'São Gonçalo'
CREATE INDEX IF NOT EXISTS idx_municipios_busca
  ON municipios(uf, (lower(unaccent_simples(nome))));

INSERT INTO estados (codigo, sigla, nome, regiao) VALUES
{linhas_uf}
ON CONFLICT (sigla) DO NOTHING;

INSERT INTO municipios (codigo, uf, nome) VALUES
{linhas_mun}
ON CONFLICT (codigo) DO NOTHING;

GRANT SELECT ON estados, municipios TO apitofut_app;

COMMIT;
"""


def escapar(texto: str) -> str:
    return texto.replace("'", "''")


def uf_do_municipio(m: dict) -> str:
    """O IBGE expõe a UF por dois caminhos, e nem todo município tem os dois."""
    micro = m.get("microrregiao")
    if micro:
        return micro["mesorregiao"]["UF"]["sigla"]
    return m["regiao-imediata"]["regiao-intermediaria"]["UF"]["sigla"]


def main() -> None:
    ufs = json.load(open("/tmp/apitofut-uf.json"))
    municipios = json.load(open("/tmp/apitofut-mun.json"))

    linhas_uf = ",\n".join(
        f"  ({u['id']}, '{u['sigla']}', '{escapar(u['nome'])}', '{u['regiao']['sigla']}')"
        for u in sorted(ufs, key=lambda x: x["sigla"])
    )

    vistos: set[int] = set()
    linhas = []
    for m in municipios:
        if m["id"] in vistos:
            continue
        vistos.add(m["id"])
        linhas.append(f"  ({m['id']}, '{uf_do_municipio(m)}', '{escapar(m['nome'])}')")

    with open("db/18-municipios.sql", "w") as saida:
        saida.write(
            CABECALHO.format(
                n_uf=len(ufs),
                n_mun=len(linhas),
                linhas_uf=linhas_uf,
                linhas_mun=",\n".join(linhas),
            )
        )
    print(f"{len(linhas)} municípios, {len(ufs)} UFs")


if __name__ == "__main__":
    main()
