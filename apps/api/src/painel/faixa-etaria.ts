/**
 * Faixa etária Sub-N — validação de AVISO, nunca bloqueio (CLAUDE.md).
 *
 * O protótipo (`validaIdade`/`checarIdade`) mostra o aviso dentro do modal
 * e troca o rótulo do botão para "Inscrever mesmo assim": o organizador
 * confirma uma segunda vez e o cadastro segue. A API reproduz isso
 * devolvendo 409 com os avisos; o cliente reenvia com
 * `confirmarFaixaEtaria: true`.
 *
 * O ano esperado sai de `temporada - N`, como na migration 03 — a tabela
 * `faixas_etarias` tinha ano-base fixo e errava fora de 2026.
 */

export interface AvisoDeFaixa {
  categoria: string;
  anoEsperado: number;
  anoDoAtleta: number;
}

/** "Sub-11" → 11; "Adulto" → null (regex de subDaCategoria). */
export function subDaCategoria(nome: string): number | null {
  const m = String(nome ?? '').match(/sub\s*-?\s*(\d{1,2})/i);
  return m ? Number(m[1]) : null;
}

/**
 * Devolve um aviso por categoria em que o ano não bate. Lista vazia
 * significa "nada a avisar" — inclusive quando não se aplica (categoria
 * adulta, sem temporada ou atleta sem data de nascimento).
 */
export function avisosDeFaixaEtaria(
  categorias: { nome: string }[],
  temporada: number | null,
  dataNascimento: Date | string | null,
): AvisoDeFaixa[] {
  if (!temporada || !dataNascimento) return [];

  const ano =
    dataNascimento instanceof Date
      ? dataNascimento.getUTCFullYear()
      : Number(String(dataNascimento).slice(0, 4));
  if (!ano) return [];

  const avisos: AvisoDeFaixa[] = [];
  for (const k of categorias) {
    const n = subDaCategoria(k.nome);
    if (!n) continue; // categoria sem padrão Sub-N: não se aplica
    const esperado = temporada - n;
    if (ano !== esperado) {
      avisos.push({ categoria: k.nome, anoEsperado: esperado, anoDoAtleta: ano });
    }
  }
  return avisos;
}

export function mensagemDeFaixa(avisos: AvisoDeFaixa[]): string {
  const detalhe = avisos
    .map(
      (a) =>
        `${a.categoria} — esperado nascidos em ${a.anoEsperado}; o atleta é de ${a.anoDoAtleta}`,
    )
    .join('; ');
  return `Ano de nascimento fora da faixa da categoria (${detalhe}). Confira a data; se estiver correta, confirme novamente para prosseguir.`;
}

/**
 * Ano de nascimento esperado da categoria: `temporada - N` do "Sub-N".
 * `null` quando não se aplica — categoria adulta ou competição sem
 * temporada definida. Usado pela carteirinha (RF029), que precisa do ano
 * isolado, sem montar a lista de avisos.
 */
export function anoEsperadoDaCategoria(
  nome: string,
  temporada: number | null,
): number | null {
  const n = subDaCategoria(nome);
  return n && temporada ? temporada - n : null;
}
