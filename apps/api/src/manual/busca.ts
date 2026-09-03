import { TOPICOS, type Publico, type TopicoDoManual } from './topicos';

/**
 * Busca do manual.
 *
 * O usuário digita a dúvida com as palavras dele — "não consigo entrar",
 * "como mando o link", "atleta com idade errada" — e não com as nossas.
 * Por isso cada tópico carrega um campo `palavras` de sinônimos, e é ele
 * que pesa mais depois do título.
 *
 * Sem acento e sem caixa: quem está com dúvida não vai acertar a grafia de
 * "suspensão" no meio da pressa.
 *
 * Pontuação por campo, com palavra inteira valendo mais que prefixo. Não é
 * busca semântica — é uma heurística simples, e vale mais que isso porque
 * o acervo é pequeno e escrito para ser encontrado.
 */

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function palavrasDe(s: string): string[] {
  return normalizar(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Palavras curtas e onipresentes só produzem ruído: "como faço para
 * cadastrar" casaria com tudo por causa de "como", "para". Elas são
 * descartadas — a menos que a busca inteira seja feita delas.
 */
const VAZIAS = new Set([
  'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na',
  'um', 'uma', 'para', 'por', 'com', 'que', 'e', 'ou', 'como', 'onde',
  'qual', 'quais', 'quando', 'se', 'meu', 'minha', 'eu', 'nao', 'sim',
  'faco', 'fazer', 'quero', 'preciso', 'consigo', 'posso', 'sistema',
]);

/**
 * Duas palavras da mesma família.
 *
 * Não basta prefixo: quem digita "inscrevo" não casa com "inscrever", que
 * é como o acervo escreve — elas divergem na última letra. Comparar o
 * trecho inicial comum resolve a conjugação sem precisar de stemmer.
 *
 * O piso de 5 caracteres é o que separa "inscrev" (legítimo) de "cart",
 * que aproximaria "cartão" de "carteirinha" — palavras diferentes.
 */
const RAIZ_MINIMA = 5;

function parecidas(a: string, b: string): boolean {
  if (a.length < 3) return false;
  if (b.startsWith(a) || a.startsWith(b)) return true;

  let comum = 0;
  while (comum < a.length && comum < b.length && a[comum] === b[comum]) comum++;
  return comum >= RAIZ_MINIMA;
}

/** Ninguém lê o décimo resultado de uma busca de ajuda. */
const LIMITE = 8;

export interface Achado {
  topico: TopicoDoManual;
  pontos: number;
}

export function buscar(consulta: string, onde?: Publico): Achado[] {
  const candidatos = onde
    ? TOPICOS.filter((t) => t.onde.includes(onde))
    : TOPICOS;

  const q = normalizar(consulta ?? '').trim();
  if (!q) return candidatos.map((topico) => ({ topico, pontos: 0 }));

  const todos = q.split(/\s+/).filter(Boolean);
  const uteis = todos.filter((t) => !VAZIAS.has(t));
  const termos = uteis.length ? uteis : todos;

  const achados: Achado[] = [];

  for (const topico of candidatos) {
    const campos = [
      { palavras: palavrasDe(topico.titulo), inteira: 10, prefixo: 5 },
      // `palavras` pesa quase como o título de propósito: são os termos
      // que o usuário realmente digita. Sem isso, uma palavra genérica no
      // título ("atleta", "cadastrar") vence o sinônimo específico e a
      // busca leva ao tópico errado.
      { palavras: palavrasDe(topico.palavras), inteira: 9, prefixo: 4 },
      { palavras: palavrasDe(topico.resumo), inteira: 3, prefixo: 2 },
      { palavras: palavrasDe(topico.corpo.join(' ')), inteira: 1, prefixo: 1 },
    ];

    let pontos = 0;
    let termosCasados = 0;

    for (const termo of termos) {
      let casouAlgum = false;
      for (const campo of campos) {
        if (campo.palavras.includes(termo)) {
          pontos += campo.inteira;
          casouAlgum = true;
        } else if (campo.palavras.some((p) => parecidas(termo, p))) {
          pontos += campo.prefixo;
          casouAlgum = true;
        }
      }
      if (casouAlgum) termosCasados += 1;
    }

    /**
     * Bônus por COBERTURA da pergunta.
     *
     * Sem ele, um tópico que casa fortíssimo com uma palavra vence outro
     * que responde à pergunta inteira: "cadastrar um jogador" ia parar em
     * "Cadastrar equipes", porque "cadastrar" está no título dela. Quem
     * cobre mais termos da dúvida está mais perto da dúvida.
     */
    pontos += termosCasados * 4;

    if (pontos > 0) achados.push({ topico, pontos });
  }

  // empate resolvido pela ordem do acervo, que é a ordem do fluxo de uso
  achados.sort((a, b) => b.pontos - a.pontos);

  /**
   * Corta o rabo da lista.
   *
   * Sem isto, "como inscrevo um atleta" devolvia os 28 tópicos: quase todo
   * texto do manual contém "atleta" em algum lugar, e um casamento
   * fraquíssimo virava "resultado". A ordenação estava certa — o primeiro
   * era o certo — mas uma lista de 28 respostas para uma pergunta
   * específica passa a impressão de que a busca não entendeu, e o usuário
   * desiste antes de ler a primeira.
   *
   * O corte é relativo ao melhor achado, não absoluto: pergunta bem
   * casada tem um teto alto e corta muito; pergunta vaga tem teto baixo e
   * deixa passar mais, que é o comportamento desejado nos dois casos.
   */
  const melhor = achados[0]?.pontos ?? 0;
  const corte = melhor * 0.4;
  return achados.filter((a) => a.pontos >= corte).slice(0, LIMITE);
}
