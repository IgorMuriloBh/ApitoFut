import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buscar } from './manual/busca';
import { TOPICOS } from './manual/topicos';

/**
 * Manual do sistema.
 *
 * O que precisa ficar de pé:
 *   - a busca responde à pergunta como o usuário a escreve, não como nós
 *     nomeamos as telas. É a razão de o manual existir;
 *   - o acervo é consistente: sem id repetido, sem destino para tela que
 *     não existe, sem tópico órfão de público.
 *
 * Puro — não sobe o Nest nem toca no banco.
 */

/** Telas e seções que o painel realmente tem (App.tsx e Competicao.tsx). */
const TELAS = new Set(['painel', 'wizard', 'base', 'ranking', 'ajuda',
  'competicao', 'admin:plataforma', 'admin:usuarios', 'admin:competicoes']);
const SECOES = new Set(['visao', 'categorias', 'equipes', 'atletas', 'tabela',
  'aovivo', 'classificacao', 'estatisticas', 'suspensoes', 'estrutura',
  'config', 'ajuda']);

describe('acervo', () => {
  test('não há id repetido', () => {
    const ids = TOPICOS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('todo tópico declara onde aparece, e com valor válido', () => {
    for (const t of TOPICOS) {
      assert.ok(t.onde.length > 0, `${t.id} não aparece em lugar nenhum`);
      for (const o of t.onde) {
        assert.ok(o === 'painel' || o === 'portal', `${t.id}: público "${o}"`);
      }
    }
  });

  test('todo destino aponta para tela que existe', () => {
    // um destino inválido produz botão que não leva a lugar nenhum — o
    // usuário clica, nada acontece, e a ajuda perde a confiança dele
    for (const t of TOPICOS) {
      const p = t.destino?.painel;
      if (!p) continue;
      assert.ok(TELAS.has(p.tela), `${t.id}: tela "${p.tela}" não existe`);
      if (p.secao) {
        assert.ok(SECOES.has(p.secao), `${t.id}: seção "${p.secao}" não existe`);
      }
    }
  });

  test('tópico com destino no painel também aparece no painel', () => {
    for (const t of TOPICOS) {
      if (t.destino?.painel) {
        assert.ok(t.onde.includes('painel'), `${t.id} tem destino sem público`);
      }
      if (t.destino?.portal) {
        assert.ok(t.onde.includes('portal'), `${t.id} tem destino sem público`);
      }
    }
  });

  test('todo tópico tem corpo e palavras de busca', () => {
    for (const t of TOPICOS) {
      assert.ok(t.corpo.length > 0, `${t.id} sem corpo`);
      assert.ok(t.palavras.trim().length > 10, `${t.id} sem sinônimos`);
    }
  });
});

describe('busca — a dúvida escrita como o usuário escreve', () => {
  const casos: [string, string][] = [
    ['como faço para mandar o link para as equipes', 'link-convite'],
    ['nao consigo entrar no sistema', 'entrar'],
    ['criei conta e nao entra', 'conta-pendente'],
    ['atleta com idade errada', 'faixa-etaria'],
    ['quero cadastrar um jogador', 'inscrever-atleta'],
    ['como corrijo um gol errado', 'corrigir-lance'],
    ['quem ganhou o desempate', 'classificacao'],
    ['exportar para excel', 'exportar'],
    ['jogador suspenso', 'suspensoes'],
    ['meu campeonato nao aparece no site', 'status-visibilidade'],
    ['gerar os jogos', 'gerar-tabela'],
    ['pedir foto na inscricao', 'configuracao'],
    ['tecnico da equipe', 'comissao'],
    ['qr code do atleta', 'carteirinha'],
    ['liberar usuario novo', 'area-adm'],
    ['criar campeonato', 'criar-competicao'],
    ['placar do jogo ao vivo', 'central-ao-vivo'],
    // conjugação: quem pergunta escreve "inscrevo", o acervo diz
    // "inscrever". Sem a raiz comum isto caía em "Carteirinha do atleta"
    ['como inscrevo um atleta', 'inscrever-atleta'],
    ['como cadastro uma equipe', 'cadastrar-equipe'],
    ['configuro a ficha do atleta', 'configuracao'],
    ['publicar a competicao', 'status-visibilidade'],
  ];

  for (const [pergunta, esperado] of casos) {
    test(`"${pergunta}" → ${esperado}`, () => {
      const r = buscar(pergunta);
      assert.ok(r.length > 0, 'não encontrou nada');
      assert.equal(r[0].topico.id, esperado);
    });
  }

  test('acento e caixa não atrapalham', () => {
    const com = buscar('SUSPENSÃO');
    const sem = buscar('suspensao');
    assert.equal(com[0]?.topico.id, sem[0]?.topico.id);
  });

  test('raiz comum não aproxima palavras diferentes', () => {
    // "cartao" e "carteirinha" compartilham "cart" — quatro letras. Se o
    // piso da raiz caísse para 4, procurar cartão traria a carteirinha.
    const r = buscar('cartao');
    assert.equal(r[0]?.topico.id, 'suspensoes');
  });

  test('busca vazia devolve o acervo inteiro', () => {
    assert.equal(buscar('').length, TOPICOS.length);
  });

  test('filtra por público', () => {
    const doPortal = buscar('', 'portal');
    assert.ok(doPortal.length > 0);
    assert.ok(doPortal.every((a) => a.topico.onde.includes('portal')));
    assert.ok(doPortal.length < TOPICOS.length, 'o portal vê menos que o painel');
  });

  test('palavra só de ligação não devolve tudo como se fosse relevante', () => {
    // "como" e "para" aparecem em quase todo texto; se pontuassem, a busca
    // viraria uma lista aleatória com ar de resposta
    const r = buscar('como para');
    assert.ok(r.length < TOPICOS.length);
  });
});
