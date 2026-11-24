/**
 * CPF e CNPJ de quem compra pela internet (RF035, fase 2).
 *
 * ── POR QUE ISTO EXISTE, E POR QUE VALIDA DÍGITO ─────────────────────
 * Descoberto testando contra o gateway de verdade: o Asaas **recusa**
 * criar a cobrança sem CPF ou CNPJ do pagador. Tratar o documento como
 * opcional produzia a pior sequência possível — a reserva era gravada,
 * o ingresso saía do estoque, e só então o gateway recusava. O comprador
 * via um erro que não era culpa dele e a vaga ficava presa 30 minutos.
 *
 * Então o documento passou a ser conferido ANTES de reservar. E
 * conferido de verdade, com dígito verificador: um "11111111111" tem
 * onze dígitos e passaria por qualquer checagem de formato, mas o
 * gateway o recusa do mesmo jeito — e aí estaríamos de volta ao
 * problema que esta validação existe para evitar.
 *
 * Módulo puro: nada de Nest, nada de banco.
 */

/** Só os dígitos. É assim que o documento viaja para o gateway. */
export function normalizarDocumento(bruto: string | null | undefined): string {
  return (bruto ?? '').replace(/\D/g, '');
}

function digitosIguais(d: string): boolean {
  return /^(\d)\1*$/.test(d);
}

function validarCpf(cpf: string): boolean {
  if (cpf.length !== 11 || digitosIguais(cpf)) return false;

  for (const [tamanho, posicao] of [
    [9, 9],
    [10, 10],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) {
      soma += Number(cpf[i]) * (tamanho + 1 - i);
    }
    const resto = (soma * 10) % 11;
    // resto 10 e 11 valem zero — é a regra da Receita, não um atalho
    const esperado = resto === 10 || resto === 11 ? 0 : resto;
    if (esperado !== Number(cpf[posicao])) return false;
  }
  return true;
}

function validarCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14 || digitosIguais(cnpj)) return false;

  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const tamanho of [12, 13]) {
    const usados = pesos.slice(pesos.length - tamanho);
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cnpj[i]) * usados[i];
    const resto = soma % 11;
    const esperado = resto < 2 ? 0 : 11 - resto;
    if (esperado !== Number(cnpj[tamanho])) return false;
  }
  return true;
}

/** Aceita CPF ou CNPJ, com ou sem pontuação. */
export function documentoValido(bruto: string | null | undefined): boolean {
  const d = normalizarDocumento(bruto);
  if (d.length === 11) return validarCpf(d);
  if (d.length === 14) return validarCnpj(d);
  return false;
}

/** `123.456.789-09` — só para exibir de volta ao comprador. */
export function formatarDocumento(bruto: string | null | undefined): string {
  const d = normalizarDocumento(bruto);
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return d;
}
