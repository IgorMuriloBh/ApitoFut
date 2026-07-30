import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  senha: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

/**
 * Hash de senha com scrypt do node:crypto.
 *
 * O CLAUDE.md pedia bcrypt/argon2; scrypt cumpre a mesma função (KDF
 * memory-hard, recomendado pelo OWASP) sem trazer dependência nativa —
 * o projeto mantém npm audit em zero justamente por não acumular árvore.
 * Parâmetros N=2^14, r=8, p=1 (baseline OWASP para scrypt).
 *
 * Formato armazenado: scrypt$N$r$p$salt(base64)$hash(base64) — os
 * parâmetros viajam junto, então dá para endurecê-los no futuro sem
 * invalidar hashes antigos.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function gerarHash(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(senha, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verificarSenha(
  senha: string,
  armazenado: string,
): Promise<boolean> {
  const partes = armazenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const calculado = await scrypt(senha, Buffer.from(saltB64, 'base64'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2, // folga p/ parâmetros maiores
  });

  return (
    esperado.length === calculado.length && timingSafeEqual(esperado, calculado)
  );
}
