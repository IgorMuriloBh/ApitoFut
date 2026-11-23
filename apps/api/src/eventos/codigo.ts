import { randomInt } from 'node:crypto';

/**
 * O código do ingresso (RF035) — a credencial do portão.
 *
 * ── TRÊS EXIGÊNCIAS, NESTA ORDEM ─────────────────────────────────────
 *
 * 1. **Não se adivinha.** Quem tem o código entra. `randomInt` do
 *    `node:crypto` é gerador criptográfico; `Math.random` não é, e a
 *    sequência dele se reconstrói a partir de algumas saídas — num
 *    evento com mil ingressos vendidos isso é material de sobra.
 *
 * 2. **Não se confunde na leitura humana.** Quando o QR não lê (tela
 *    rachada, sol a pino, print borrado), alguém digita o código. O
 *    alfabeto não tem O/0, I/1/L, U/V nem S/5 — os pares que geram fila
 *    no portão e discussão sobre quem errou.
 *
 * 3. **Cabe num QR pequeno.** 12 caracteres de um alfabeto de 26 dão
 *    ~56 bits: um QR de versão baixa, que lê rápido mesmo numa câmera
 *    ruim, e espaço de busca grande demais para tentativa e erro.
 *
 * ── O CÓDIGO GUARDADO NÃO TEM HÍFEN ──────────────────────────────────
 * O banco guarda os 12 caracteres corridos, e `formatar` põe os hífens
 * só na hora de mostrar. Guardar o enfeite junto obrigaria toda busca a
 * normalizar antes — e bastaria um lugar esquecer para o portão dizer
 * "ingresso não encontrado" com o ingresso certo na mão.
 */

/** Sem O, I, L, U, V, S, 0, 1 e 5 — os que se confundem ao digitar. */
export const ALFABETO = 'ABCDEFGHJKMNPQRTWXYZ234678';

const TAMANHO = 12;
const POR_BLOCO = 4;

export function gerarCodigo(): string {
  let codigo = '';
  for (let i = 0; i < TAMANHO; i++) {
    codigo += ALFABETO[randomInt(ALFABETO.length)];
  }
  return codigo;
}

/**
 * Normaliza o que veio do leitor ou da digitação.
 *
 * O QR pode trazer a URL inteira (`.../i/ABCDEFGHJKMN`) quando a câmera
 * nativa do celular é usada no lugar do leitor do sistema — é o caso
 * mais comum de "o código não funciona" no portão. Aqui a última parte
 * do caminho é aceita como código.
 */
export function normalizarCodigo(bruto: string): string {
  let texto = (bruto ?? '').trim();

  if (/^https?:\/\//i.test(texto)) {
    try {
      const caminho = new URL(texto).pathname.replace(/\/+$/, '');
      texto = caminho.slice(caminho.lastIndexOf('/') + 1);
    } catch {
      /* não era URL válida: segue com o texto cru */
    }
  }

  return texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** `ABCDEFGHJKMN` → `ABCD-EFGH-JKMN`, só para mostrar e ditar. */
export function formatar(codigo: string): string {
  return (codigo.match(new RegExp(`.{1,${POR_BLOCO}}`, 'g')) ?? []).join('-');
}

export const TAMANHO_DO_CODIGO = TAMANHO;
