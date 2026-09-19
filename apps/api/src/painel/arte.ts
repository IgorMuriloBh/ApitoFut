/**
 * Artes de divulgação do jogo e da rodada (RF033).
 *
 * O organizador divulga a rodada no grupo de WhatsApp e no Instagram, e até
 * aqui fazia isso no Canva, à mão, jogo a jogo — redigitando nome de equipe,
 * horário e campo que o sistema já tem. Erro de digitação em arte publicada
 * é o tipo de coisa que ninguém corrige depois.
 *
 * TRÊS ARTES, UM PADRÃO SÓ. Jogo, rodada e resultado compartilham cabeçalho,
 * paleta e a linha de confronto. Na prática são **duas** funções: o placar
 * decide o resto. Jogo encerrado sai com o resultado no lugar do horário,
 * sem rota nem template separado — foi o que evitou três layouts para
 * manter em sincronia.
 *
 * POR QUE SVG, E NÃO PNG AQUI. Gerar PNG no servidor pediria uma biblioteca
 * de imagem (canvas nativo ou resvg), e o projeto evita dependência nova por
 * princípio (CLAUDE.md). O SVG é string: sai daqui testável sem banco e sem
 * navegador, como `sumula-impressa.ts`, e quem rasteriza para PNG é o painel,
 * com o canvas que o navegador já tem.
 *
 * DUAS CONSEQUÊNCIAS DISSO, que explicam escolhas abaixo:
 *
 *  1. **Nenhuma referência externa.** Um SVG rasterizado por `<img>` não
 *     busca imagem nem fonte de fora — o desenho sairia com buracos. Por
 *     isso escudo e logo chegam aqui já como `data:` e a tipografia é uma
 *     pilha de fontes de sistema.
 *  2. **Nada de texto que transborda.** Sem layout engine, largura é
 *     estimada; `ajustar()` encolhe e corta antes de o nome invadir o
 *     vizinho.
 *
 * Módulo puro: sem Prisma, sem I/O.
 */

export const LARGURA = 1080;
export const ALTURA = 1350; // 4:5 — o retrato que melhor rende no feed

/** Pilha de fontes pesadas presentes em macOS, Windows e Android. */
const DISPLAY = "'Arial Black','Arial Bold','Helvetica Neue',Helvetica,sans-serif";
const TEXTO = "'Helvetica Neue',Arial,sans-serif";

/**
 * Realce fixo, e não uma cor derivada da competição.
 *
 * Calcular a complementar do hex do organizador produz combinação ruim com
 * facilidade (verde → magenta). Este âmbar tem contraste alto sobre qualquer
 * fundo escuro, e é o que duas das três referências do cliente usam.
 */
const REALCE = '#FFC93C';
const REALCE_TEXTO = '#1A1200';

export interface EquipeNaArte {
  nome: string;
  /** Já em `data:` — ver o cabeçalho do módulo. */
  escudo: string | null;
}

export interface JogoNaArte {
  mandante: EquipeNaArte;
  visitante: EquipeNaArte;
  /** ISO `AAAA-MM-DD`. */
  data: string | null;
  /** `HH:MM`. */
  hora: string | null;
  /** Campo · Cidade/UF, já composto. */
  local: string | null;
  /** Presente = jogo encerrado: a arte vira de resultado. */
  placar: { mandante: number; visitante: number } | null;
  penaltis?: { mandante: number; visitante: number } | null;
}

export interface Cabecalho {
  competicao: string;
  /** Já em `data:`; nulo é o caso comum, e o nome assume o papel. */
  logo: string | null;
  /** `cor_primaria` da competição — é dela que sai a paleta inteira. */
  cor: string;
  /** `SUB 09 · FASE DE GRUPOS · 1ª RODADA` */
  contexto: string;
  /** Cidade/UF da competição, no rodapé. */
  local: string;
  /** Endereço público, para a arte levar alguém ao portal. */
  portal: string | null;
}

// ── utilidades puras ──────────────────────────────────────────────────

export function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function canal(hex: string, i: number): number {
  const limpo = hex.replace('#', '');
  const cheio =
    limpo.length === 3
      ? limpo
          .split('')
          .map((c) => c + c)
          .join('')
      : limpo;
  return parseInt(cheio.slice(i * 2, i * 2 + 2), 16) || 0;
}

/** Mistura a cor com preto (`peso` 0..1). */
export function escurecer(hex: string, peso: number): string {
  const v = [0, 1, 2]
    .map((i) => Math.round(canal(hex, i) * (1 - peso)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  return `#${v}`;
}

/** Iniciais da equipe — mesma regra do `Escudo.tsx`, para a arte bater com a tela. */
export function iniciais(nome: string): string {
  const partes = nome
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-Z]/.test(p))
    .slice(0, 2)
    .map((p) => p[0]);
  return (partes.join('') || nome.trim()[0] || '?').toUpperCase();
}

/**
 * Cor estável a partir do nome, idêntica à do painel: a mesma equipe tem
 * sempre a mesma cor, na lista e na arte, sem nada guardado no banco.
 */
export function matiz(nome: string): string {
  let soma = 0;
  for (let i = 0; i < nome.length; i++) {
    soma = (soma * 31 + nome.charCodeAt(i)) % 360;
  }
  return `hsl(${soma} 45% 42%)`;
}

/**
 * Largura média de um caractere, como fração do corpo da fonte.
 *
 * MEDIDO, não estimado: `ctx.measureText` no navegador, com nomes de equipe
 * reais em maiúsculas. Os valores são o PIOR caso das amostras, não a média
 * — subestimar faz o nome invadir o escudo do vizinho, e foi exatamente o
 * que aconteceu com um chute único de 0,62 para as duas fontes.
 */
export const FATOR_DISPLAY = 0.74;
export const FATOR_TEXTO = 0.67;

/**
 * Encolhe e, em último caso, corta o texto para caber na largura.
 *
 * Sem layout engine no SVG, a largura vem da contagem de caracteres vezes
 * o fator da fonte. Encolher até 70% resolve quase todo nome de equipe;
 * abaixo disso o corte com reticência é mais legível que letra pequena
 * demais.
 */
export function ajustar(
  texto: string,
  larguraMax: number,
  corpo: number,
  opcoes: { minimo?: number; fator?: number } = {},
): { texto: string; corpo: number } {
  const { minimo = 0.7, fator = FATOR_DISPLAY } = opcoes;
  const largura = (t: string, c: number) => t.length * c * fator;

  if (largura(texto, corpo) <= larguraMax) return { texto, corpo };

  const necessario = larguraMax / (texto.length * fator);
  if (necessario >= corpo * minimo) {
    return { texto, corpo: Math.floor(necessario) };
  }

  const menor = Math.floor(corpo * minimo);
  const cabem = Math.max(1, Math.floor(larguraMax / (menor * fator)) - 1);
  return { texto: `${texto.slice(0, cabem).trimEnd()}…`, corpo: menor };
}

/**
 * Quebra o nome em até `maxLinhas`, sem cortar palavra.
 *
 * Nomes de equipe aqui são longos ("Academia Atlético nacional"): forçar
 * uma linha só derruba o corpo da fonte a ponto de o nome virar legenda.
 * Duas linhas mantêm o peso que o confronto pede.
 */
export function quebrar(
  texto: string,
  larguraMax: number,
  corpo: number,
  opcoes: { maxLinhas?: number; minimo?: number } = {},
): { linhas: string[]; corpo: number } {
  const { maxLinhas = 2, minimo = 0.6 } = opcoes;
  const cabe = (t: string, c: number) =>
    t.length * c * FATOR_DISPLAY <= larguraMax;

  if (cabe(texto, corpo)) return { linhas: [texto], corpo };

  const palavras = texto.split(/\s+/);

  if (maxLinhas >= 2 && palavras.length > 1) {
    // Encolhe em passos ATÉ a quebra caber, em vez de desistir no primeiro
    // "não coube". "Academia Atlético nacional" não parte em duas linhas no
    // corpo cheio; parte a 90% dele — e uma linha 10% menor é muito melhor
    // que "ACADEMIA ATLÉTICO N…".
    const piso = Math.floor(corpo * minimo);
    for (let c = corpo; c >= piso; c -= 1) {
      let melhor: [string, string] | null = null;
      for (let i = 1; i < palavras.length; i++) {
        const a = palavras.slice(0, i).join(' ');
        const b = palavras.slice(i).join(' ');
        if (!cabe(a, c) || !cabe(b, c)) continue;
        const desequilibrio = Math.abs(a.length - b.length);
        if (!melhor || desequilibrio < Math.abs(melhor[0].length - melhor[1].length)) {
          melhor = [a, b];
        }
      }
      if (melhor) return { linhas: melhor, corpo: c };
    }
  }

  // nome de uma palavra só, ou largura pequena demais para qualquer quebra
  const ajustado = ajustar(texto, larguraMax, corpo, { minimo });
  return { linhas: [ajustado.texto], corpo: ajustado.corpo };
}

const DIAS = [
  'DOMINGO',
  'SEGUNDA-FEIRA',
  'TERÇA-FEIRA',
  'QUARTA-FEIRA',
  'QUINTA-FEIRA',
  'SEXTA-FEIRA',
  'SÁBADO',
];
const MESES = [
  'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ',
];

/** `2026-12-05` → `SEXTA-FEIRA · 5 DE DEZ`. */
export function dataPorExtenso(iso: string | null): string | null {
  if (!iso) return null;
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return null;
  // UTC: a data é um dia civil, e o fuso local jogaria para o dia anterior
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS[dia]} · ${d} DE ${MESES[m - 1]}`;
}

/** `2026-12-05` → `05/DEZ`. */
export function dataCurta(iso: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.split('-').map(Number);
  if (!m || !d) return null;
  return `${String(d).padStart(2, '0')}/${MESES[m - 1]}`;
}

// ── peças do desenho ──────────────────────────────────────────────────

function texto(
  conteudo: string,
  x: number,
  y: number,
  opcoes: {
    corpo: number;
    cor?: string;
    peso?: number;
    ancora?: 'start' | 'middle' | 'end';
    fonte?: string;
    espaco?: number;
    opacidade?: number;
  },
): string {
  const {
    corpo,
    cor = '#FFFFFF',
    peso = 900,
    ancora = 'middle',
    fonte = DISPLAY,
    espaco = 0,
    opacidade = 1,
  } = opcoes;
  return (
    `<text x="${x}" y="${y}" font-family="${fonte}" font-size="${corpo}" ` +
    `font-weight="${peso}" fill="${cor}" text-anchor="${ancora}" ` +
    `letter-spacing="${espaco}"${opacidade < 1 ? ` opacity="${opacidade}"` : ''}>` +
    `${escapar(conteudo)}</text>`
  );
}

/**
 * Escudo redondo. Sem imagem, o círculo com iniciais — que é o caso comum:
 * a maioria das equipes nunca envia escudo, e desenhar um vazio faria a
 * arte parecer quebrada em vez de simplesmente sem logo.
 */
function escudo(
  equipe: EquipeNaArte,
  cx: number,
  cy: number,
  raio: number,
  indice: number,
): string {
  const id = `esc${indice}`;
  const fundo =
    `<circle cx="${cx}" cy="${cy}" r="${raio}" fill="#FFFFFF" opacity="0.14"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${raio - 3}" fill="${
      equipe.escudo ? '#FFFFFF' : matiz(equipe.nome)
    }"/>`;

  if (!equipe.escudo) {
    const sigla = iniciais(equipe.nome);
    return (
      fundo +
      texto(sigla, cx, cy + raio * 0.33, {
        corpo: raio * (sigla.length > 1 ? 0.78 : 1),
        espaco: 1,
      })
    );
  }

  const lado = (raio - 3) * 2 * 0.82;
  return (
    fundo +
    `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${raio - 3}"/></clipPath>` +
    `<image href="${equipe.escudo}" x="${cx - lado / 2}" y="${cy - lado / 2}" ` +
    `width="${lado}" height="${lado}" preserveAspectRatio="xMidYMid meet" ` +
    `clip-path="url(#${id})"/>`
  );
}

/** Tarja de realce com o contexto: categoria, fase e rodada. */
function tarja(conteudo: string, y: number): string {
  // 920 e piso baixo: o contexto é a informação que identifica a arte —
  // "SUB 09 · GRUPO A · 1ª RODADA" cortado no meio não identifica nada
  const { texto: t, corpo } = ajustar(conteudo, 920, 34, { minimo: 0.6 });
  const largura = Math.max(320, t.length * corpo * FATOR_DISPLAY + 80);
  const x = (LARGURA - largura) / 2;
  return (
    `<rect x="${x}" y="${y}" width="${largura}" height="66" rx="33" fill="${REALCE}"/>` +
    texto(t, LARGURA / 2, y + 45, {
      corpo,
      cor: REALCE_TEXTO,
      espaco: 2,
    })
  );
}

function fundoDaArte(cor: string): string {
  const claro = escurecer(cor, 0.35);
  const escuro = escurecer(cor, 0.78);
  return (
    `<defs>` +
    `<linearGradient id="fundo" x1="0" y1="0" x2="0.35" y2="1">` +
    `<stop offset="0" stop-color="${claro}"/>` +
    `<stop offset="1" stop-color="${escuro}"/>` +
    `</linearGradient>` +
    `<radialGradient id="brilho" cx="0.5" cy="0.17" r="0.55">` +
    `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/>` +
    `<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="${LARGURA}" height="${ALTURA}" fill="url(#fundo)"/>` +
    `<rect width="${LARGURA}" height="${ALTURA}" fill="url(#brilho)"/>` +
    // barras diagonais nas bordas — o enquadramento das referências
    // discretas e CURTAS: na primeira versão elas cruzavam as linhas de
    // confronto e disputavam atenção com o que a arte existe para dizer
    `<g opacity="0.28">` +
    `<path d="M-60 ${ALTURA} L120 ${ALTURA - 260} L180 ${ALTURA - 260} L0 ${ALTURA} Z" fill="${REALCE}"/>` +
    `<path d="M40 ${ALTURA} L210 ${ALTURA - 190} L236 ${ALTURA - 190} L66 ${ALTURA} Z" fill="#FFFFFF" opacity="0.6"/>` +
    `<path d="M${LARGURA + 60} 0 L${LARGURA - 120} 260 L${LARGURA - 180} 260 L${LARGURA} 0 Z" fill="${REALCE}"/>` +
    `<path d="M${LARGURA - 40} 0 L${LARGURA - 210} 190 L${LARGURA - 236} 190 L${LARGURA - 66} 0 Z" fill="#FFFFFF" opacity="0.6"/>` +
    `</g>`
  );
}

/** Logo + nome da competição. Devolve também onde o corpo pode começar. */
function cabecalho(cab: Cabecalho): { svg: string; fim: number } {
  let svg = '';
  let y = 56;

  if (cab.logo) {
    svg += `<image href="${cab.logo}" x="${(LARGURA - 300) / 2}" y="${y}" width="300" height="190" preserveAspectRatio="xMidYMid meet"/>`;
    y += 214;
  }

  // sem logo o nome vira o protagonista; com logo ele acompanha, menor
  const corpo = cab.logo ? 40 : 62;
  const nome = ajustar(cab.competicao.toUpperCase(), 940, corpo);
  svg += texto(nome.texto, LARGURA / 2, y + nome.corpo, {
    corpo: nome.corpo,
    espaco: 2,
  });
  y += nome.corpo + 34;

  svg += tarja(cab.contexto.toUpperCase(), y);
  return { svg, fim: y + 66 };
}

function rodape(cab: Cabecalho): string {
  const y = ALTURA - 96;
  let svg = `<rect x="${(LARGURA - 560) / 2}" y="${y - 34}" width="560" height="3" fill="${REALCE}" opacity="0.7"/>`;
  svg += texto(cab.local.toUpperCase(), LARGURA / 2, y + 10, {
    corpo: 26,
    espaco: 3,
    opacidade: 0.92,
  });
  if (cab.portal) {
    svg += texto(cab.portal, LARGURA / 2, y + 52, {
      corpo: 22,
      peso: 700,
      fonte: TEXTO,
      cor: REALCE,
      opacidade: 0.95,
    });
  }
  return svg;
}

const moldura = (conteudo: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGURA}" height="${ALTURA}" ` +
  `viewBox="0 0 ${LARGURA} ${ALTURA}">${conteudo}</svg>`;

// ── arte de um jogo ───────────────────────────────────────────────────

/**
 * Um confronto, em destaque. Com placar vira a arte de resultado: o número
 * ocupa o lugar do `X` e o vencedor ganha o realce.
 */
export function arteDeJogo(cab: Cabecalho, jogo: JogoNaArte): string {
  const topo = cabecalho(cab);
  let svg = fundoDaArte(cab.cor) + topo.svg;

  const encerrado = jogo.placar !== null;
  const cy = topo.fim + 190;
  const raio = 108;
  const xEsq = 268;
  const xDir = LARGURA - 268;

  svg += escudo(jogo.mandante, xEsq, cy, raio, 1);
  svg += escudo(jogo.visitante, xDir, cy, raio, 2);

  // nomes: duas equipes por linha pedem largura curta, então o corpo cai
  for (const [equipe, x] of [
    [jogo.mandante, xEsq],
    [jogo.visitante, xDir],
  ] as const) {
    const n = quebrar(equipe.nome.toUpperCase(), 430, 40);
    const venceu =
      encerrado &&
      (equipe === jogo.mandante
        ? jogo.placar!.mandante > jogo.placar!.visitante
        : jogo.placar!.visitante > jogo.placar!.mandante);
    n.linhas.forEach((linha, i) => {
      svg += texto(linha, x, cy + raio + 66 + i * (n.corpo + 8), {
        corpo: n.corpo,
        espaco: 1,
        cor: venceu ? REALCE : '#FFFFFF',
      });
    });
  }

  // os números fogem do centro para não colidirem com o × — sobrepostos,
  // "3 × 1" com espaçamento vira um borrão em qualquer placar de dois dígitos
  svg += encerrado
    ? texto(String(jogo.placar!.mandante), LARGURA / 2 - 92, cy + 40, { corpo: 108 }) +
      texto('×', LARGURA / 2, cy + 30, { corpo: 62, opacidade: 0.55 }) +
      texto(String(jogo.placar!.visitante), LARGURA / 2 + 92, cy + 40, { corpo: 108 })
    : texto('×', LARGURA / 2, cy + 40, { corpo: 108, opacidade: 0.85 });

  // bloco de quando e onde
  let y = cy + raio + 180;

  if (jogo.penaltis) {
    // abaixo dos nomes: colado no placar ele disputava espaço com o número,
    // que é o que a arte de resultado existe para mostrar
    svg += texto(
      `DECIDIDO NOS PÊNALTIS · ${jogo.penaltis.mandante} × ${jogo.penaltis.visitante}`,
      LARGURA / 2,
      y - 26,
      { corpo: 26, cor: REALCE, espaco: 2 },
    );
    y += 22;
  }
  const quando = encerrado ? dataPorExtenso(jogo.data) : dataPorExtenso(jogo.data);
  if (quando) {
    svg += tarja(quando, y);
    y += 108;
  }
  if (!encerrado && jogo.hora) {
    svg += texto(jogo.hora, LARGURA / 2, y + 62, { corpo: 78, espaco: 4 });
    y += 96;
  }
  if (jogo.local) {
    const l = ajustar(jogo.local.toUpperCase(), 900, 32, { fator: FATOR_TEXTO });
    svg += texto(l.texto, LARGURA / 2, y + 40, {
      corpo: l.corpo,
      peso: 700,
      fonte: TEXTO,
      espaco: 2,
      opacidade: 0.92,
    });
  }

  return moldura(svg + rodape(cab));
}

// ── arte da rodada ────────────────────────────────────────────────────

/**
 * Vários confrontos numa arte só. Cada linha é um jogo; o placar, quando
 * existe, substitui o horário — uma rodada com todos os jogos encerrados
 * vira naturalmente a arte de resultados.
 */
export function arteDaRodada(cab: Cabecalho, jogos: JogoNaArte[]): string {
  const topo = cabecalho(cab);
  let svg = fundoDaArte(cab.cor) + topo.svg;

  const area = topo.fim + 46;
  const disponivel = ALTURA - 150 - area;
  const n = Math.max(1, jogos.length);
  const passo = Math.min(190, disponivel / n);
  const altura = Math.min(162, passo - 14);

  // Bloco CENTRADO no espaço livre. Ancorado no topo, uma rodada de dois
  // jogos deixava metade da arte vazia embaixo — e rodada de dois jogos é
  // o caso comum numa semifinal.
  const inicio = area + (disponivel - passo * n) / 2;

  jogos.forEach((jogo, i) => {
    svg += linhaDeJogo(jogo, inicio + i * passo, altura, i);
  });

  return moldura(svg + rodape(cab));
}

/** Uma faixa de confronto: escudo — nome — placar/× — nome — escudo. */
function linhaDeJogo(
  jogo: JogoNaArte,
  y: number,
  altura: number,
  indice: number,
): string {
  const margem = 56;
  const largura = LARGURA - margem * 2;
  const meio = y + altura / 2;
  const raio = Math.min(46, altura * 0.34);
  const encerrado = jogo.placar !== null;

  let svg =
    `<rect x="${margem}" y="${y}" width="${largura}" height="${altura}" rx="${altura * 0.22}" ` +
    `fill="#FFFFFF" opacity="0.10"/>` +
    `<rect x="${margem}" y="${y}" width="6" height="${altura}" rx="3" fill="${REALCE}"/>`;

  const xEsc1 = margem + 26 + raio;
  const xEsc2 = LARGURA - margem - 26 - raio;
  // com legenda embaixo, escudo e nome sobem para não encostar nela
  const cyEsc = jogo.hora || jogo.local ? meio - altura * 0.14 : meio;
  svg += escudo(jogo.mandante, xEsc1, cyEsc, raio, indice * 2 + 10);
  svg += escudo(jogo.visitante, xEsc2, cyEsc, raio, indice * 2 + 11);

  const centro = LARGURA / 2;
  const espacoNome = centro - xEsc1 - raio - (encerrado ? 86 : 42);
  const corpoNome = Math.min(30, altura * 0.22);

  // duas linhas, como no confronto em destaque: "Academia Atlético
  // nacional" numa linha só cairia para corpo 17 e viraria legenda
  const m = quebrar(jogo.mandante.nome.toUpperCase(), espacoNome, corpoNome);
  const v = quebrar(jogo.visitante.nome.toUpperCase(), espacoNome, corpoNome);
  const venceuM = encerrado && jogo.placar!.mandante > jogo.placar!.visitante;
  const venceuV = encerrado && jogo.placar!.visitante > jogo.placar!.mandante;

  const linhas = (
    n: { linhas: string[]; corpo: number },
    x: number,
    ancora: 'start' | 'end',
    cor: string,
  ) => {
    const alturaTotal = (n.linhas.length - 1) * (n.corpo + 4);
    return n.linhas
      .map((linha, i) =>
        texto(linha, x, cyEsc - alturaTotal / 2 + i * (n.corpo + 4) + n.corpo * 0.36, {
          corpo: n.corpo,
          ancora,
          cor,
        }),
      )
      .join('');
  };

  svg += linhas(m, centro - (encerrado ? 82 : 40), 'end', venceuM ? REALCE : '#FFFFFF');
  svg += linhas(v, centro + (encerrado ? 82 : 40), 'start', venceuV ? REALCE : '#FFFFFF');

  if (encerrado) {
    svg += texto(
      `${jogo.placar!.mandante} × ${jogo.placar!.visitante}`,
      centro,
      cyEsc + corpoNome * 0.42,
      { corpo: corpoNome * 1.35, espaco: 2 },
    );
  } else {
    svg += texto('×', centro, cyEsc + corpoNome * 0.42, {
      corpo: corpoNome * 1.2,
      opacidade: 0.6,
    });
  }

  // legenda: quando e onde, ou os pênaltis do jogo decidido neles
  const partes = [
    dataCurta(jogo.data),
    encerrado ? null : jogo.hora,
    jogo.local,
  ].filter(Boolean) as string[];
  if (jogo.penaltis) {
    partes.push(`PÊN ${jogo.penaltis.mandante}×${jogo.penaltis.visitante}`);
  }
  if (partes.length) {
    const l = ajustar(partes.join(' · ').toUpperCase(), largura - 140, 22, {
      fator: FATOR_TEXTO,
    });
    svg += texto(l.texto, centro, y + altura - 16, {
      corpo: l.corpo,
      peso: 700,
      fonte: TEXTO,
      espaco: 2,
      opacidade: 0.82,
    });
  }

  return svg;
}
