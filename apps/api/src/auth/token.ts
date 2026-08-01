import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token de sessão compacto: base64url(payload JSON) + '.' + HMAC-SHA256.
 * Mesma mecânica de um JWT, sem a biblioteca — o projeto evita dependência
 * nova de propósito. Não há refresh token ainda; expira e pronto.
 */
export interface SessaoToken {
  /** id do usuário */
  sub: string;
  /** organização — é o que vira app.current_org no RLS */
  org: string;
  perfil: string;
  /**
   * Só existe quando um superadmin assumiu a organização de outro
   * organizador (`POST /admin/competicoes/:id/assumir`): guarda a
   * organização de origem, para poder voltar. A presença deste campo é o
   * que o painel usa para exibir a tarja de "você está em outra conta".
   */
  orgPropria?: string;
  /** epoch em segundos */
  exp: number;
}

/** Valor de exemplo do .env.example — nunca pode assinar em produção. */
const SEGREDO_DE_EXEMPLO = 'troque-me';

function segredo(): string {
  const s = process.env.AUTH_SEGREDO;
  if (!s) {
    throw new Error('AUTH_SEGREDO não definido — ver apps/api/.env.example');
  }
  // Barra o segredo de exemplo fora de desenvolvimento: com ele qualquer
  // pessoa que leia o repositório forja um token de qualquer organização.
  if (process.env.NODE_ENV === 'production' && s.includes(SEGREDO_DE_EXEMPLO)) {
    throw new Error(
      'AUTH_SEGREDO ainda é o valor de exemplo. Gere um por ambiente: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }
  if (s.length < 32) {
    throw new Error('AUTH_SEGREDO curto demais: use ao menos 32 caracteres.');
  }
  return s;
}

function assinar(payloadB64: string): Buffer {
  return createHmac('sha256', segredo()).update(payloadB64).digest();
}

export function emitirToken(
  dados: Omit<SessaoToken, 'exp'>,
  validadeSegundos = 8 * 60 * 60,
): string {
  const payload: SessaoToken = {
    ...dados,
    exp: Math.floor(Date.now() / 1000) + validadeSegundos,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${assinar(b64).toString('base64url')}`;
}

/** Devolve o payload se o token for válido e não expirado; senão, null. */
export function validarToken(token: string): SessaoToken | null {
  const ponto = token.lastIndexOf('.');
  if (ponto <= 0) return null;

  const payloadB64 = token.slice(0, ponto);
  const assinaturaB64 = token.slice(ponto + 1);

  const esperada = assinar(payloadB64);
  let recebida: Buffer;
  try {
    recebida = Buffer.from(assinaturaB64, 'base64url');
  } catch {
    return null;
  }
  if (
    esperada.length !== recebida.length ||
    !timingSafeEqual(esperada, recebida)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString(),
    ) as SessaoToken;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
