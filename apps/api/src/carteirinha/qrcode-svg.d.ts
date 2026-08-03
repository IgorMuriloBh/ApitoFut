/**
 * Tipos do `qrcode-svg`, escritos à mão em vez de puxar `@types/qrcode-svg`.
 * Usamos duas coisas da biblioteca — o construtor e `.svg()` —, e declarar
 * só isso evita mais um pacote na árvore por causa de dez linhas.
 */
declare module 'qrcode-svg' {
  interface OpcoesDoQR {
    content: string;
    padding?: number;
    width?: number;
    height?: number;
    color?: string;
    background?: string;
    /** Correção de erro: L (7%) a H (30%). */
    ecl?: 'L' | 'M' | 'Q' | 'H';
    join?: boolean;
    container?: 'svg' | 'svg-viewbox' | 'g' | 'none';
  }

  export default class QRCode {
    constructor(opcoes: OpcoesDoQR | string);
    svg(): string;
  }
}
