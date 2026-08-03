import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
// zero-dependência própria: gera o SVG do QR sem árvore transitiva. O
// `qrcode` clássico arrastaria yargs@15 — exatamente o tipo de árvore que
// este projeto removeu ao trocar o @nestjs/cli por tsc puro.
import QRCode from 'qrcode-svg';
import { urlPublica } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';
import { anoEsperadoDaCategoria } from '../painel/faixa-etaria';

/**
 * Carteirinha digital e validação por QR (RF029).
 *
 * O QR impresso aponta para `/c/{competicao}/{atleta}` no portal. Quem
 * escaneia é a arbitragem, na beira do campo, e precisa de três respostas:
 * é este atleta mesmo, ele está inscrito, e ele pode entrar hoje.
 *
 * Rota **aberta**: o árbitro não tem conta. O que a protege é precisar dos
 * dois uuids — não há rota que enumere atletas, e sem o par não há
 * resposta. Documento (CPF, RG) não sai daqui: a página é pública e a
 * maioria dos atletas é menor de idade.
 */

interface LinhaCarteirinha {
  competicao_id: string;
  competicao_nome: string;
  competicao_slug: string;
  competicao_status: string;
  cidade: string;
  estado: string;
  cor_primaria: string;
  logo_url: string | null;
  atleta_id: string;
  atleta_nome: string;
  apelido: string | null;
  foto_url: string | null;
  data_nascimento: Date | null;
  posicao: string | null;
  time_id: string;
  time_nome: string;
  escudo_url: string | null;
  categorias: {
    id: string;
    nome: string;
    numero: number | null;
    temporada: number | null;
    tipo: string;
    anoNascimento: number | null;
    suspensoPor: number;
  }[];
}

/** Base pública do portal — é para lá que o QR aponta. */
const PORTAL = (process.env.PORTAL_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);

@Controller('carteirinha/:competicaoId/:atletaId')
export class CarteirinhaController {
  constructor(private readonly prisma: PrismaService) {}

  private async buscar(competicaoId: string, atletaId: string) {
    const [linha] = await this.prisma.$queryRaw<LinhaCarteirinha[]>`
      SELECT * FROM fn_carteirinha(${competicaoId}::uuid, ${atletaId}::uuid)
    `;
    if (!linha) {
      throw new NotFoundException(
        'Credencial não encontrada: o atleta não tem inscrição nesta competição.',
      );
    }
    return linha;
  }

  private endereco(competicaoId: string, atletaId: string) {
    return `${PORTAL}/c/${competicaoId}/${atletaId}`;
  }

  /** GET /carteirinha/:competicaoId/:atletaId — dados da credencial. */
  @Get()
  async validar(
    @Param('competicaoId', ParseUUIDPipe) competicaoId: string,
    @Param('atletaId', ParseUUIDPipe) atletaId: string,
  ) {
    const c = await this.buscar(competicaoId, atletaId);

    const categorias = c.categorias.map((k) => {
      // faixa etária é AVISO, não bloqueio (CLAUDE.md) — a arbitragem
      // decide, o sistema só informa
      const esperado = anoEsperadoDaCategoria(k.nome, k.temporada);
      return {
        id: k.id,
        nome: k.nome,
        numero: k.numero,
        suspensoPor: Number(k.suspensoPor ?? 0),
        foraDaFaixa:
          esperado !== null &&
          k.anoNascimento !== null &&
          k.anoNascimento !== esperado,
        anoEsperado: esperado,
        anoDoAtleta: k.anoNascimento,
      };
    });

    return {
      valida: true,
      competicao: {
        id: c.competicao_id,
        nome: c.competicao_nome,
        slug: c.competicao_slug,
        status: c.competicao_status,
        cidade: c.cidade,
        estado: c.estado.trim(),
        corPrimaria: c.cor_primaria.trim(),
        logoUrl: urlPublica(c.logo_url),
      },
      atleta: {
        id: c.atleta_id,
        nome: c.atleta_nome,
        apelido: c.apelido,
        fotoUrl: urlPublica(c.foto_url),
        dataNascimento: c.data_nascimento?.toISOString().slice(0, 10) ?? null,
        posicao: c.posicao,
      },
      equipe: {
        id: c.time_id,
        nome: c.time_nome,
        escudoUrl: urlPublica(c.escudo_url),
      },
      categorias,
      /** Somado: se for > 0, o atleta não entra em campo. */
      suspenso: categorias.some((k) => k.suspensoPor > 0),
      url: this.endereco(competicaoId, atletaId),
    };
  }

  /**
   * GET /carteirinha/:competicaoId/:atletaId/qr.svg — o QR para imprimir.
   *
   * Gerado no servidor para que painel e portal só precisem de uma `<img>`.
   * Correção de erro alta: a carteirinha vive no bolso do responsável e é
   * lida sob sol, chuva e plástico amassado.
   */
  @Get('qr.svg')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'public, max-age=86400')
  async qr(
    @Param('competicaoId', ParseUUIDPipe) competicaoId: string,
    @Param('atletaId', ParseUUIDPipe) atletaId: string,
  ) {
    // exige credencial existente: um QR de atleta inexistente só levaria
    // o árbitro a uma página de erro no meio do jogo
    await this.buscar(competicaoId, atletaId);

    return new QRCode({
      content: this.endereco(competicaoId, atletaId),
      padding: 1,
      width: 220,
      height: 220,
      color: '#000000',
      background: '#ffffff',
      ecl: 'H',
    }).svg();
  }
}
