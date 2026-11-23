import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  PERFIS_DA_EQUIPE,
  PERMISSOES,
  RECURSOS,
  ROTULO_DO_PERFIL,
  podeEscrever,
  recursosDoPerfil,
} from './permissoes';

describe('matriz de permissões', () => {
  test('o dono e o ADM escrevem tudo da competição', () => {
    for (const perfil of ['organizador', 'superadmin']) {
      for (const r of RECURSOS) {
        if (r === 'equipe' ) continue;
        assert.ok(podeEscrever(perfil, r), `${perfil} deveria escrever ${r}`);
      }
    }
  });

  test('gestor faz tudo na competição, menos mexer em quem entra na conta', () => {
    for (const r of RECURSOS) {
      assert.equal(
        podeEscrever('gestor', r),
        r !== 'equipe',
        `gestor × ${r}`,
      );
    }
  });

  test('mesário opera a partida e o portão, nada além', () => {
    // `portaria` entrou com os eventos (RF035): quem fica no portão lendo
    // QR é o mesmo plantão operacional. Continua sem alcançar preço,
    // cadastro ou configuração — é o que o teste seguinte fixa
    assert.deepEqual(recursosDoPerfil('mesario'), ['sumula', 'portaria']);
  });

  test('secretaria só mexe em elenco', () => {
    assert.deepEqual(recursosDoPerfil('secretaria'), ['elenco']);
  });

  test('mesário não apaga competição, não gera tabela e não mexe em preço', () => {
    for (const r of ['competicao', 'estrutura', 'tabela', 'elenco', 'disciplina', 'evento'] as const) {
      assert.equal(podeEscrever('mesario', r), false, r);
    }
  });

  test('secretaria não opera jogo', () => {
    assert.equal(podeEscrever('secretaria', 'sumula'), false);
  });

  test('ninguém além do dono gerencia a equipe', () => {
    for (const p of PERFIS_DA_EQUIPE) {
      assert.equal(podeEscrever(p, 'equipe'), false, p);
    }
  });

  test('perfil desconhecido ou ausente não escreve nada', () => {
    // um token antigo, ou um perfil herdado do protótipo (tecnico, arbitro,
    // atleta) que nunca ganhou tela: nega, não presume
    for (const perfil of [undefined, '', 'tecnico', 'arbitro', 'atleta', 'inventado']) {
      assert.deepEqual(recursosDoPerfil(perfil), [], String(perfil));
    }
  });

  test('todo recurso tem mapa — nenhum fica implicitamente aberto', () => {
    for (const r of RECURSOS) {
      assert.ok(
        Array.isArray(PERMISSOES[r]) && PERMISSOES[r].length > 0,
        `recurso "${r}" sem perfis declarados`,
      );
    }
  });

  test('todo perfil da equipe tem rótulo para a tela', () => {
    for (const p of PERFIS_DA_EQUIPE) {
      assert.ok(ROTULO_DO_PERFIL[p], p);
    }
  });
});
