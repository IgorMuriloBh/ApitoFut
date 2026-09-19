import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ALTURA,
  Cabecalho,
  FATOR_DISPLAY,
  JogoNaArte,
  LARGURA,
  ajustar,
  arteDaRodada,
  arteDeJogo,
  dataCurta,
  dataPorExtenso,
  escapar,
  escurecer,
  iniciais,
  quebrar,
} from './arte';

/**
 * Artes de divulgação (RF033).
 *
 * O que dá para provar sem olhar: que o texto não transborda, que nada
 * externo é referenciado (senão o PNG sai com buracos), que o placar troca
 * a arte de agendada para resultado, e que caractere especial em nome de
 * equipe não quebra o XML.
 *
 * O que NÃO dá para provar aqui é se ficou bonito — isso se vê na tela.
 */

const cab: Cabecalho = {
  competicao: 'Festival DAG Esportes',
  logo: null,
  cor: '#16A34A',
  contexto: 'Sub 09 · Grupo A · 1ª rodada',
  local: 'Belo Horizonte/MG',
  portal: 'apitofut.app/festival',
};

const equipe = (nome: string, escudo: string | null = null) => ({ nome, escudo });

const jogo: JogoNaArte = {
  mandante: equipe('Academia Atlético nacional'),
  visitante: equipe('América Contagem'),
  data: '2026-09-19',
  hora: '12:29',
  local: 'Campo 1 · Belo Horizonte/MG',
  placar: null,
};

/** Todo `font-size` do SVG, para conferir que nada ficou ilegível. */
const corpos = (svg: string) =>
  [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));

describe('utilidades', () => {
  test('escapa o que quebraria o XML', () => {
    assert.equal(escapar('Bar & Cia <"A">'), 'Bar &amp; Cia &lt;&quot;A&quot;&gt;');
  });

  test('escurecer mistura com preto', () => {
    assert.equal(escurecer('#FFFFFF', 0), '#ffffff');
    assert.equal(escurecer('#FFFFFF', 1), '#000000');
    assert.equal(escurecer('#16A34A', 0.5), '#0b5225');
  });

  test('escurecer aceita hex de três dígitos', () => {
    assert.equal(escurecer('#0F0', 0), '#00ff00');
  });

  test('iniciais seguem a regra do painel', () => {
    assert.equal(iniciais('América Contagem'), 'AC');
    assert.equal(iniciais('União'), 'U');
    assert.equal(iniciais('Academia Atlético nacional'), 'AA');
  });

  test('data por extenso usa o dia civil, não o fuso local', () => {
    // 19/09/2026 é um sábado; com `new Date('2026-09-19')` lido em fuso
    // negativo isto viraria sexta
    assert.equal(dataPorExtenso('2026-09-19'), 'SÁBADO · 19 DE SET');
    assert.equal(dataCurta('2026-09-19'), '19/SET');
    assert.equal(dataPorExtenso(null), null);
  });
});

describe('ajustar', () => {
  test('texto que cabe não é tocado', () => {
    const r = ajustar('SÃO PEDRO', 900, 40);
    assert.equal(r.texto, 'SÃO PEDRO');
    assert.equal(r.corpo, 40);
  });

  test('encolhe enquanto o piso permitir', () => {
    // 10% a menos cabe: encolhe e mantém o nome inteiro
    const r = ajustar('ACADEMIA ATLÉTICO NACIONAL', 560, 40);
    assert.equal(r.texto, 'ACADEMIA ATLÉTICO NACIONAL');
    assert.ok(r.corpo < 40 && r.corpo >= 28);
  });

  test('abaixo do piso, corta em vez de virar letra miúda', () => {
    // a regra documentada: encolher só até 70% do corpo pedido
    const r = ajustar('ACADEMIA ATLÉTICO NACIONAL', 420, 40);
    assert.equal(r.corpo, 28);
    assert.ok(r.texto.endsWith('…'));
  });

  test('corta quando encolher não basta, e o resultado cabe', () => {
    const r = ajustar('ACADEMIA ATLETICA MUNICIPAL DE CONTAGEM', 120, 40);
    assert.ok(r.texto.endsWith('…'));
    assert.ok(r.texto.length * r.corpo * FATOR_DISPLAY <= 120);
  });
});

describe('quebrar', () => {
  test('parte em duas linhas, sem cortar palavra', () => {
    const r = quebrar('ACADEMIA ATLÉTICO NACIONAL', 430, 40);
    assert.equal(r.linhas.length, 2);
    // o ponto de quebra exato é indiferente — o que importa é que as duas
    // linhas juntas reconstroem o nome, inteiro
    assert.equal(r.linhas.join(' '), 'ACADEMIA ATLÉTICO NACIONAL');
  });

  test('encolhe até a quebra caber, em vez de desistir e cortar', () => {
    // no corpo cheio nenhuma das duas metades cabe em 430; a 90% cabem
    const r = quebrar('ACADEMIA ATLÉTICO NACIONAL', 430, 40);
    assert.ok(r.corpo <= 40);
    for (const linha of r.linhas) {
      assert.ok(
        linha.length * r.corpo * FATOR_DISPLAY <= 430,
        `"${linha}" não cabe em 430`,
      );
    }
    assert.ok(!r.linhas.some((l) => l.endsWith('…')), 'não devia ter cortado');
  });

  test('palavra única não tem onde quebrar: encolhe ou corta', () => {
    const r = quebrar('BARREIRINHOOOOOOOOOOOOOO', 120, 40);
    assert.equal(r.linhas.length, 1);
    assert.ok(r.linhas[0].length * r.corpo * FATOR_DISPLAY <= 120);
  });
});

describe('arte do jogo', () => {
  test('sai no formato pedido e é SVG válido na aparência', () => {
    const svg = arteDeJogo(cab, jogo);
    assert.ok(svg.startsWith('<svg '));
    assert.ok(svg.trimEnd().endsWith('</svg>'));
    assert.match(svg, new RegExp(`width="${LARGURA}"`));
    assert.match(svg, new RegExp(`height="${ALTURA}"`));
  });

  test('traz o que a arte existe para informar', () => {
    // no texto sem marcação: nome longo pode estar partido em duas linhas
    const plano = arteDeJogo(cab, jogo)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    for (const esperado of [
      'FESTIVAL DAG ESPORTES',
      'ACADEMIA ATLÉTICO NACIONAL',
      'AMÉRICA CONTAGEM',
      '12:29',
      'CAMPO 1 · BELO HORIZONTE/MG',
      'SÁBADO · 19 DE SET',
      'SUB 09 · GRUPO A · 1ª RODADA',
    ]) {
      assert.ok(plano.includes(esperado), `faltou "${esperado}"`);
    }
  });

  test('sem escudo, o círculo com iniciais entra no lugar', () => {
    const svg = arteDeJogo(cab, jogo);
    assert.ok(svg.includes('>AA</text>'), 'faltou a inicial do mandante');
    assert.ok(svg.includes('>AC</text>'), 'faltou a inicial do visitante');
    assert.ok(!svg.includes('<image'), 'não deveria haver imagem nenhuma');
  });

  test('com placar vira arte de resultado: o horário sai, o número entra', () => {
    const svg = arteDeJogo(cab, { ...jogo, placar: { mandante: 3, visitante: 1 } });
    assert.ok(svg.includes('>3</text>'));
    assert.ok(svg.includes('>1</text>'));
    assert.ok(!svg.includes('>12:29</text>'), 'horário não cabe em resultado');
    // o vencedor ganha o realce
    assert.match(svg, /fill="#FFC93C"[^>]*>ACADEMIA/);
  });

  test('pênaltis aparecem só quando existem', () => {
    const sem = arteDeJogo(cab, { ...jogo, placar: { mandante: 2, visitante: 2 } });
    assert.ok(!sem.includes('PÊNALTIS'));

    const com = arteDeJogo(cab, {
      ...jogo,
      placar: { mandante: 2, visitante: 2 },
      penaltis: { mandante: 4, visitante: 3 },
    });
    assert.ok(com.includes('DECIDIDO NOS PÊNALTIS · 4 × 3'));
  });

  test('nome com & não quebra o XML', () => {
    const svg = arteDeJogo(cab, {
      ...jogo,
      mandante: equipe('Bar & Cia <FC>'),
    });
    assert.ok(svg.includes('BAR &amp; CIA'));
    assert.ok(!svg.includes('<FC>'));
  });

  test('nada de referência externa — o PNG sairia com buracos', () => {
    const svg = arteDeJogo(cab, {
      ...jogo,
      mandante: equipe('União', 'data:image/png;base64,AAAA'),
    });
    assert.ok(!/href="https?:/.test(svg), 'href externo no SVG');
    assert.ok(!svg.includes('@import'), 'CSS externo no SVG');
    assert.match(svg, /href="data:image\/png/);
  });

  test('nenhum texto sai ilegível', () => {
    for (const c of corpos(arteDeJogo(cab, jogo))) {
      assert.ok(c >= 18, `corpo ${c} é pequeno demais para 1080px`);
    }
  });
});

describe('arte da rodada', () => {
  const rodada: JogoNaArte[] = [
    jogo,
    { ...jogo, mandante: equipe('São Pedro'), visitante: equipe('Segundo Distrito') },
    { ...jogo, mandante: equipe('Vila São José'), visitante: equipe('Barreirinho') },
  ];

  test('todos os confrontos entram', () => {
    // o nome pode estar partido em duas linhas, então a busca é no texto
    // do SVG sem as marcações, não na string literal
    const plano = arteDaRodada(cab, rodada)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    for (const nome of ['SÃO PEDRO', 'SEGUNDO DISTRITO', 'VILA SÃO JOSÉ', 'BARREIRINHO']) {
      assert.ok(plano.includes(nome), `faltou "${nome}"`);
    }
  });

  test('as linhas cabem na arte, mesmo com muitos jogos', () => {
    const muitos = Array.from({ length: 8 }, (_, i) => ({
      ...jogo,
      mandante: equipe(`Equipe ${i}A`),
      visitante: equipe(`Equipe ${i}B`),
    }));
    const svg = arteDaRodada(cab, muitos);
    // a faixa do jogo, não a barrinha de realce que também começa em x=56
    const ys = [...svg.matchAll(/<rect x="56" y="([\d.]+)" width="968"/g)].map((m) =>
      Number(m[1]),
    );
    assert.equal(ys.length, 8, 'uma faixa por jogo');
    assert.ok(Math.min(...ys) > 0, 'faixa acima do topo');
    assert.ok(Math.max(...ys) < ALTURA - 100, 'faixa passando do rodapé');
  });

  test('rodada encerrada mostra placar no lugar do horário', () => {
    const svg = arteDaRodada(
      cab,
      rodada.map((j) => ({ ...j, placar: { mandante: 2, visitante: 0 } })),
    );
    assert.ok(svg.includes('2 × 0'));
    assert.ok(!svg.includes('>12:29</text>'));
  });

  test('um jogo só continua centrado, sem metade da arte vazia', () => {
    const svg = arteDaRodada(cab, [jogo]);
    const y = Number(/<rect x="56" y="([\d.]+)" width="968"/.exec(svg)![1]);
    // no meio da área útil, não colado no cabeçalho
    assert.ok(y > ALTURA * 0.35 && y < ALTURA * 0.65, `faixa em y=${y}`);
  });
});
