import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Os SQLSTATEs `AF***` da migration 15 chegam aqui embrulhados pelo
 * Prisma. Traduzir para exceção HTTP mantém a regra num lugar só — o
 * banco — em vez de duplicá-la em cada rota.
 */
/** Formato do que o driver adapter do Prisma 7 pendura em `meta`. */
interface ErroComMeta {
  message?: string;
  meta?: {
    driverAdapterError?: {
      cause?: { code?: string; message?: string };
    };
  };
}

export function traduzirErroDoBanco(erro: unknown): never {
  const e = erro as ErroComMeta;
  const causa = e?.meta?.driverAdapterError?.cause;

  // O SQLSTATE vem estruturado em `meta`; o texto corrido é só o plano B,
  // caso uma versão do Prisma mude o embrulho. Nele o RAISE aparece como
  // "Raw query failed. Code: `AF422`. Message: `...`".
  const texto = typeof e?.message === 'string' ? e.message : String(erro ?? '');
  const codigo =
    causa?.code ?? texto.match(/Code: `(AF\w+)`/)?.[1] ?? '';

  // reaproveitar a mensagem do banco evita manter o mesmo texto em dois
  // lugares — quem define a regra é quem a explica
  const mensagem = (padrao: string) =>
    causa?.message ?? texto.match(/Message: `([^`]+)`/)?.[1] ?? padrao;

  switch (codigo) {
    case 'AF403':
      throw new ForbiddenException(mensagem('Ação restrita ao ADM do sistema.'));
    case 'AF404':
      throw new NotFoundException(mensagem('Registro não encontrado.'));
    case 'AF422':
      throw new BadRequestException(mensagem('Operação não permitida.'));
    case 'AF001':
      throw new ConflictException(mensagem('E-mail já cadastrado.'));
    default:
      throw erro;
  }
}
