import { coluna_classificacao } from '@prisma/client';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { interpretarRotulo, montarMataMata } from './chaveamento';
import {
  CAMPO_DO_CRITERIO,
  CriterioAtivo,
  GrupoClassificado,
  ehPendente,
  resolverVaga,
} from './classificados';

/** Linha da classificação com os campos que os critérios usam. */
function time(
  nome: string,
  posicao: number,
  valores: Partial<Record<string, number>> = {},
) {
  return {
    timeId: `id-${nome}`,
    nome,
    posicao,
    pontos: 0,
    jogos: 3,
    vitorias: 0,
    empates: 0,
    derrotas: 0,
    golsPro: 0,
    golsContra: 0,
    saldoGols: 0,
    porcentagem: 0,
    cartaoAmarelo: 0,
    cartaoVermelho: 0,
    cartaoAzul: 0,
    colunaExtra: 0,
    ...valores,
  };
}

const PADRAO: CriterioAtivo[] = [
  { criterio: 'pontos', direcao: 'DESC' },
  { criterio: 'saldo_gols', direcao: 'DESC' },
];

describe('interpretarRotulo', () => {
  test('lê a vaga com grupo', () => {
    assert.deepEqual(interpretarRotulo('1º Grupo A'), { posicao: 1, grupo: 'A' });
    assert.deepEqual(interpretarRotulo('2º Grupo B'), { posicao: 2, grupo: 'B' });
  });

  test('lê a vaga de chave única', () => {
    assert.deepEqual(interpretarRotulo('3º colocado'), { posicao: 3, grupo: null });
  });

  test('vaga de vencedor não é dela — devolve null', () => {
    assert.equal(interpretarRotulo('Vencedor Semifinal 1'), null);
    assert.equal(interpretarRotulo('A definir'), null);
    assert.equal(interpretarRotulo(null), null);
  });

  test('lê de volta tudo que montarMataMata escreve na primeira fase', () => {
    // o casamento entre quem escreve e quem lê é a razão de existir do
    // parser: um rótulo novo que ele não entendesse viraria vaga eterna
    for (const numGrupos of [1, 2, 4]) {
      const jogos = montarMataMata('semi', numGrupos);
      const primeira = jogos.filter((j) => j.fase === 'semi');
      for (const j of primeira) {
        assert.ok(
          interpretarRotulo(j.mandanteRotulo),
          `não entendeu "${j.mandanteRotulo}" (${numGrupos} grupo(s))`,
        );
        assert.ok(
          interpretarRotulo(j.visitanteRotulo),
          `não entendeu "${j.visitanteRotulo}" (${numGrupos} grupo(s))`,
        );
      }
    }
  });
});

describe('resolverVaga', () => {
  const grupos: GrupoClassificado[] = [
    {
      grupo: 'A',
      times: [
        time('Alfa', 1, { pontos: 9, saldoGols: 5 }),
        time('Beta', 2, { pontos: 4, saldoGols: 1 }),
        time('Gama', 3, { pontos: 1, saldoGols: -6 }),
      ],
    },
    {
      grupo: 'B',
      times: [
        time('Delta', 1, { pontos: 7, saldoGols: 3 }),
        time('Ípsilon', 2, { pontos: 5, saldoGols: 0 }),
      ],
    },
  ];

  test('dá a vaga a quem está na posição', () => {
    const r = resolverVaga('1º Grupo A', grupos, PADRAO);
    assert.ok(r && !ehPendente(r));
    assert.equal(r.nome, 'Alfa');
    assert.equal(r.timeId, 'id-Alfa');
  });

  test('segunda vaga do outro grupo', () => {
    const r = resolverVaga('2º Grupo B', grupos, PADRAO);
    assert.ok(r && !ehPendente(r));
    assert.equal(r.nome, 'Ípsilon');
  });

  test('grupo que não existe vira pendência, não exceção', () => {
    const r = resolverVaga('1º Grupo Z', grupos, PADRAO);
    assert.ok(r && ehPendente(r));
    assert.equal(r.motivo, 'grupo_inexistente');
  });

  test('posição além do grupo vira pendência', () => {
    const r = resolverVaga('4º Grupo A', grupos, PADRAO);
    assert.ok(r && ehPendente(r));
    assert.equal(r.motivo, 'posicao_inexistente');
  });

  test('sem grupo no rótulo, conta a tabela inteira', () => {
    const chaveUnica: GrupoClassificado[] = [
      {
        grupo: null,
        times: [
          time('Um', 1, { pontos: 9 }),
          time('Dois', 2, { pontos: 6 }),
          time('Três', 3, { pontos: 3 }),
        ],
      },
    ];
    const r = resolverVaga('2º colocado', chaveUnica, PADRAO);
    assert.ok(r && !ehPendente(r));
    assert.equal(r.nome, 'Dois');
  });

  test('empate na fronteira da vaga NÃO é decidido sozinho', () => {
    // 2º e 3º iguais em tudo: quem vai à semifinal não pode sair da ordem
    // alfabética — é a mesma postura da premiação (RF024)
    const empatados: GrupoClassificado[] = [
      {
        grupo: 'A',
        times: [
          time('Alfa', 1, { pontos: 9, saldoGols: 5 }),
          time('Beta', 2, { pontos: 4, saldoGols: 1 }),
          time('Gama', 3, { pontos: 4, saldoGols: 1 }),
        ],
      },
    ];
    const r = resolverVaga('2º Grupo A', empatados, PADRAO);
    assert.ok(r && ehPendente(r));
    assert.equal(r.motivo, 'empate');
    assert.deepEqual(r.empatados, ['Beta', 'Gama']);
  });

  test('empate acima da vaga também trava — quem é 1º está em dúvida', () => {
    const empatados: GrupoClassificado[] = [
      {
        grupo: 'A',
        times: [
          time('Alfa', 1, { pontos: 7, saldoGols: 2 }),
          time('Beta', 2, { pontos: 7, saldoGols: 2 }),
          time('Gama', 3, { pontos: 1, saldoGols: -4 }),
        ],
      },
    ];
    const r = resolverVaga('2º Grupo A', empatados, PADRAO);
    assert.ok(r && ehPendente(r));
    assert.equal(r.motivo, 'empate');
  });

  test('critério escondido não desempata: o empate reaparece', () => {
    // esconder a coluna a tira dos critérios (regra da configuração); duas
    // equipes que só diferiam nela passam a estar empatadas de fato
    const grupos2: GrupoClassificado[] = [
      {
        grupo: 'A',
        times: [
          time('Alfa', 1, { pontos: 9, saldoGols: 5 }),
          time('Beta', 2, { pontos: 4, saldoGols: 3 }),
          time('Gama', 3, { pontos: 4, saldoGols: 1 }),
        ],
      },
    ];
    const comSaldo = resolverVaga('2º Grupo A', grupos2, PADRAO);
    assert.ok(comSaldo && !ehPendente(comSaldo), 'com saldo de gols, decide');

    const semSaldo = resolverVaga('2º Grupo A', grupos2, [
      { criterio: 'pontos', direcao: 'DESC' },
    ]);
    assert.ok(semSaldo && ehPendente(semSaldo), 'sem saldo de gols, empata');
  });
});

describe('CAMPO_DO_CRITERIO', () => {
  test('cobre todas as colunas que podem virar critério', () => {
    // lido do enum GERADO pelo banco, não de uma lista escrita à mão: se o
    // schema ganhar uma coluna e ela não estiver no mapa, o desempate a
    // ignoraria em silêncio e a vaga sairia errada
    for (const coluna of Object.keys(coluna_classificacao)) {
      assert.ok(CAMPO_DO_CRITERIO[coluna], `falta o campo de "${coluna}"`);
    }
  });
});
