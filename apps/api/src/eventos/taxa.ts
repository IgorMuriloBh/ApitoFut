/**
 * A taxa da plataforma, do lado do TypeScript (RF035, fase 2).
 *
 * ── ESTE MÓDULO NÃO É A FONTE DA VERDADE ─────────────────────────────
 * Quem decide quanto o comprador paga é `fn_precifica_pedido`, no banco
 * (migration 24). Aqui a conta existe para UM fim: mostrar o valor antes
 * de o pedido existir — a tela precisa dizer "você vai pagar R$ 110,00"
 * enquanto a pessoa ainda escolhe quantos ingressos quer.
 *
 * Duas contas para o mesmo número é exatamente o tipo de duplicação que
 * produz divergência em dinheiro. O que segura isso é um teste que roda
 * os dois lados sobre os mesmos casos e falha se discordarem — está em
 * `eventos.e2e.spec.ts`. Mexeu aqui, mexa lá; e vice-versa.
 *
 * ── QUEM DECIDE O QUÊ ────────────────────────────────────────────────
 * O ORGANIZADOR escolhe o modelo por evento: repassar ao comprador,
 * absorver, ou isentar. A PLATAFORMA define o percentual e o fixo —
 * é contrato comercial, e só o `superadmin` altera.
 */

export type ModeloDeTaxa = 'comprador' | 'organizador' | 'isento';

export interface RegraDeTaxa {
  modelo: ModeloDeTaxa;
  /** Percentual sobre o subtotal, com até duas casas (ex.: 10, 7.5). */
  percentual: number;
  /** Parte fixa, somada depois do percentual. */
  fixaCentavos: number;
}

export interface Precificacao {
  /** O que o comprador paga. */
  totalCentavos: number;
  /** A parte da plataforma. */
  taxaCentavos: number;
  /** O que sobra para o organizador — `total - taxa`, como no banco. */
  repasseCentavos: number;
}

export const ROTULO_DO_MODELO: Record<ModeloDeTaxa, string> = {
  comprador: 'O comprador paga a taxa (preço + taxa)',
  organizador: 'Eu absorvo a taxa (recebo o preço menos a taxa)',
  isento: 'Sem taxa neste evento',
};

export function precificar(
  subtotalCentavos: number,
  regra: RegraDeTaxa,
): Precificacao {
  // Entrada franca não paga taxa, nem a parte fixa: cobrar R$ 1,00 de
  // taxa sobre um ingresso gratuito seria cobrar pelo nada. Mesma regra
  // do banco, e é por isso que ela aparece antes de qualquer conta.
  if (subtotalCentavos <= 0 || regra.modelo === 'isento') {
    return {
      totalCentavos: Math.max(0, subtotalCentavos),
      taxaCentavos: 0,
      repasseCentavos: Math.max(0, subtotalCentavos),
    };
  }

  // Aritmética inteira até a última divisão. `subtotal * percentual /
  // 100` em ponto flutuante produz 209.49999999999997 onde o banco, que
  // calcula em `numeric`, produz 209.5 — e os dois arredondam para
  // lados diferentes. O percentual tem no máximo duas casas
  // (`numeric(5,2)`), então multiplicá-lo por 100 o torna inteiro.
  const centesimos = Math.round(regra.percentual * 100);
  const taxaBruta =
    Math.round((subtotalCentavos * centesimos) / 10_000) + regra.fixaCentavos;

  if (regra.modelo === 'comprador') {
    // por cima: o organizador recebe o preço cheio
    return {
      totalCentavos: subtotalCentavos + taxaBruta,
      taxaCentavos: taxaBruta,
      repasseCentavos: subtotalCentavos,
    };
  }

  // absorvida: o comprador paga o preço e o repasse encolhe. O teto
  // existe porque repasse negativo não é representável — o banco tem
  // `ck_pedido_taxa` justamente para isso
  const taxa = Math.min(taxaBruta, subtotalCentavos);
  return {
    totalCentavos: subtotalCentavos,
    taxaCentavos: taxa,
    repasseCentavos: subtotalCentavos - taxa,
  };
}

/** Em reais, para a tela. Centavos é sempre o que trafega e o que grava. */
export function emReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
