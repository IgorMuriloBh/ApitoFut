#!/usr/bin/env node
/**
 * =====================================================================
 *  Gera o SQL que redefine a senha de um usuário.
 *
 *  POR QUE UMA FERRAMENTA E NÃO UM UPDATE À MÃO. A senha é guardada com
 *  scrypt (`apps/api/src/auth/senha.ts`), no formato
 *  `scrypt$N$r$p$salt$hash` — os parâmetros viajam junto do hash. Escrever
 *  isso à mão é inviável, e colar um hash de outra origem produz uma conta
 *  que nunca autentica.
 *
 *  A SENHA NÃO PASSA POR ARGUMENTO. Argumento de linha de comando fica no
 *  histórico do shell e aparece na lista de processos da máquina. Aqui ela
 *  é lida da entrada padrão, sem eco.
 *
 *  O QUE ELE NÃO FAZ: conectar no banco. Ele imprime o comando; quem
 *  decide onde executá-lo é você. Assim serve tanto para o banco local
 *  quanto para o console SQL do provedor, sem precisar expor o banco.
 *
 *  Uso:
 *    node db/ferramentas/redefinir-senha.mjs iber@gmail.com
 * =====================================================================
 */

import { createInterface } from 'node:readline';
import { scrypt as scryptCb, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

// Mesmos parâmetros de apps/api/src/auth/senha.ts — precisam bater, senão
// o hash gerado aqui não é reconhecido lá.
const N = 16384;
const r = 8;
const p = 1;
const TAMANHO = 64;

const email = process.argv[2];
if (!email) {
  console.error('Uso: node db/ferramentas/redefinir-senha.mjs <email>');
  process.exit(1);
}

/**
 * Lê a senha sem eco.
 *
 * O silenciamento troca `process.stdout.write` — e PRECISA devolvê-lo no
 * fim. Sem restaurar, todo `console.log` posterior vira no-op: o comando
 * roda, não imprime nada, e parece que travou. (Aconteceu.)
 */
function perguntarSenha(rotulo) {
  return new Promise((resolve) => {
    const escreverOriginal = process.stdout.write.bind(process.stdout);
    escreverOriginal(rotulo);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write = () => true;

    rl.question('', (resposta) => {
      rl.close();
      process.stdout.write = escreverOriginal;
      process.stdout.write('\n');
      resolve(resposta);
    });
  });
}

const senha = await perguntarSenha('Nova senha (não aparece na tela): ');
if (senha.length < 8) {
  console.error('\nA senha precisa ter ao menos 8 caracteres.');
  process.exit(1);
}

const sal = randomBytes(16);
const derivado = await scrypt(senha, sal, TAMANHO, { N, r, p, maxmem: 64 * 1024 * 1024 });
const hash = `scrypt$${N}$${r}$${p}$${sal.toString('base64')}$${derivado.toString('base64')}`;

console.log('\n-- Execute este comando no banco de destino:\n');
console.log(`UPDATE usuarios SET senha_hash = '${hash}'`);
console.log(` WHERE email = '${email}';`);
console.log('\n-- Confira que atualizou exatamente 1 linha (UPDATE 1).');
