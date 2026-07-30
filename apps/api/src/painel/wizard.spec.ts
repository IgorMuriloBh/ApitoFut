import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { WizardInvalido, validarWizard } from './wizard';

const base = {
  nome: 'Copa Teste',
  estado: 'MG',
  cidade: 'BH',
  dataInicio: '2027-03-01',
};

function falhaCom(payload: any, trecho: RegExp) {
  assert.throws(() => validarWizard(payload), (e: unknown) => {
    assert.ok(e instanceof WizardInvalido);
    assert.match(e.message, trecho);
    return true;
  });
}

describe('wizard — validação (mensagens do protótipo)', () => {
  test('campos obrigatórios de wzNext1', () => {
    falhaCom({ ...base, nome: '' }, /nome do campeonato/);
    falhaCom({ ...base, estado: '' }, /estado/);
    falhaCom({ ...base, cidade: ' ' }, /cidade/);
    falhaCom({ ...base, dataInicio: undefined }, /data de início/);
  });

  test('categoria sem nome cai na mensagem de wzFinishCats', () => {
    falhaCom({ ...base, categorias: [{ nome: '  ' }] }, /precisam de um nome/);
  });

  test('término antes do início é recusado', () => {
    falhaCom({ ...base, dataFim: '2027-01-01' }, /término anterior/);
  });

  test('limites de times e grupos', () => {
    falhaCom({ ...base, categorias: [{ nome: 'A', numTimes: 1 }] }, /entre 2 e 128/);
    falhaCom({ ...base, categorias: [{ nome: 'A', numGrupos: 17 }] }, /entre 1 e 16/);
  });

  test('nomes de categoria duplicados são recusados', () => {
    falhaCom(
      { ...base, categorias: [{ nome: 'Sub-9' }, { nome: 'sub-9' }] },
      /mesmo nome/,
    );
  });
});

describe('wizard — saneamento', () => {
  test('pontos_mata força grupo único, mesmo pedindo 4', () => {
    const { categorias } = validarWizard({
      ...base,
      categorias: [{ nome: 'A', formato: 'pontos_mata', numGrupos: 4 }],
    });
    assert.equal(categorias[0].num_grupos, 1);
  });

  test('sem categorias: nasce categoria única com o nome do campeonato', () => {
    const { categorias, competicao } = validarWizard({
      ...base,
      possuiCategorias: false,
    });
    assert.equal(categorias.length, 1);
    assert.equal(categorias[0].nome, competicao.nome);
  });

  test('defaults do protótipo: adulto, masculino, fut7, 8 times, 2 grupos, semi', () => {
    const { categorias } = validarWizard({ ...base, categorias: [{ nome: 'A' }] });
    const c = categorias[0];
    assert.deepEqual(
      [c.tipo, c.genero, c.modalidade, c.formato, c.num_times, c.num_grupos, c.fase_mata_mata],
      ['adulto', 'masculino', 'fut7', 'grupos_mata', 8, 2, 'semi'],
    );
  });

  test('UF sobe para maiúscula, cor normaliza, temporada sai da data', () => {
    const { competicao } = validarWizard({
      ...base,
      estado: 'mg',
      cor: '#7c3aed',
      categorias: [{ nome: 'A' }],
    });
    assert.equal(competicao.estado, 'MG');
    assert.equal(competicao.cor_primaria, '#7C3AED');
    assert.equal(competicao.temporada, 2027);
  });
});
