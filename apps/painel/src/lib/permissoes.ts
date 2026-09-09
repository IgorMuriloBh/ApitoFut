import { sessao } from './api';

/**
 * O que o usuário logado pode ESCREVER.
 *
 * Cópia deliberada da matriz da API (`apps/api/src/auth/permissoes.ts`),
 * usada só para **não oferecer** botão que a API vai recusar. Quem decide
 * é o servidor, sempre: esta lista é conveniência de tela, e um bundle
 * antigo em cache nunca libera nada — o `PermissaoGuard` responde 403 do
 * mesmo jeito.
 *
 * `equipe` fica de fora: o item de menu correspondente é decidido em
 * `App.tsx`, que também precisa saber se o ADM está com a conta de outra
 * pessoa assumida.
 */

export type Recurso =
  | 'competicao'
  | 'estrutura'
  | 'elenco'
  | 'tabela'
  | 'sumula'
  | 'disciplina';

const DONOS = ['organizador', 'superadmin'];

const PERMISSOES: Record<Recurso, string[]> = {
  competicao: [...DONOS, 'gestor'],
  estrutura: [...DONOS, 'gestor'],
  elenco: [...DONOS, 'gestor', 'secretaria'],
  tabela: [...DONOS, 'gestor'],
  sumula: [...DONOS, 'gestor', 'mesario'],
  disciplina: [...DONOS, 'gestor'],
};

/** Perfil da sessão atual; `undefined` quando ninguém está logado. */
export function perfilAtual(): string | undefined {
  return sessao.ler()?.usuario.perfil;
}

export function podeEscrever(recurso: Recurso, perfil = perfilAtual()): boolean {
  return PERMISSOES[recurso]?.includes(perfil ?? '') ?? false;
}

/** Aviso curto para quando a tela precisa explicar por que está só de leitura. */
export const SOMENTE_LEITURA =
  'Seu perfil vê estas informações, mas não altera. Peça ao responsável pela conta.';
