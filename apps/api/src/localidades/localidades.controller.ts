import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Estados e municípios do Brasil (migration 18).
 *
 * Rotas **abertas** e sem RLS: é dado público do IBGE, não de nenhuma
 * organização. Uma cidade não pertence a ninguém, e exigir token aqui só
 * atrapalharia o auto-cadastro de equipe, que também precisa da lista.
 *
 * Cacheável de verdade: a divisão municipal muda a cada poucos anos.
 */
@Controller('localidades')
export class LocalidadesController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /localidades/estados — as 27 UFs, para o seletor. */
  @Get('estados')
  @Header('Cache-Control', 'public, max-age=86400')
  async estados() {
    const linhas = await this.prisma.$queryRaw<
      { sigla: string; nome: string; regiao: string }[]
    >`SELECT sigla, nome, regiao FROM estados ORDER BY nome`;

    return linhas.map((e) => ({
      sigla: e.sigla.trim(),
      nome: e.nome,
      regiao: e.regiao.trim(),
    }));
  }

  /**
   * GET /localidades/estados/:uf/municipios?busca=
   *
   * Sem busca devolve a UF inteira — São Paulo tem 645 municípios, o que é
   * um payload aceitável e deixa o seletor funcionar offline depois do
   * primeiro carregamento. Com busca, filtra ignorando acento.
   */
  @Get('estados/:uf/municipios')
  @Header('Cache-Control', 'public, max-age=86400')
  async municipios(@Param('uf') uf: string, @Query('busca') busca = '') {
    const sigla = (uf ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(sigla)) {
      throw new BadRequestException('UF deve ser a sigla de 2 letras.');
    }

    // o termo também perde o acento: quem digita "sao goncalo" acha
    // "São Gonçalo" sem saber onde fica a cedilha
    const termo = busca.trim();

    const linhas = await this.prisma.$queryRaw<
      { codigo: number; nome: string }[]
    >`
      SELECT codigo, nome
        FROM municipios
       WHERE uf = ${sigla}
         AND (${termo} = ''
              OR lower(unaccent_simples(nome))
                 LIKE '%' || lower(unaccent_simples(${termo})) || '%')
       -- ordenar pelo nome cru jogaria "Mâncio Lima" DEPOIS de
       -- "Marechal Thaumaturgo": o collation do banco compara o byte do
       -- 'a' com circunflexo, não a letra. Sem acento é a ordem que o
       -- brasileiro espera — e é a expressão que já tem índice.
       ORDER BY lower(unaccent_simples(nome))
    `;

    return linhas.map((m) => ({ codigo: m.codigo, nome: m.nome }));
  }
}
