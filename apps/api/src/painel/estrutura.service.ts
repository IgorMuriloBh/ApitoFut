import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { funcao_arbitro } from '@prisma/client';
import { paraCaminho, urlPublica } from '../arquivos/armazenamento';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Campos e árbitros da competição (RF013, RF014).
 *
 * As duas tabelas existiam desde o schema original e nada as preenchia —
 * `jogos.campo_id` e `jogos.arbitro_id` ficavam sempre nulos, e a súmula
 * impressa saía com "Local a definir" e uma linha em branco para o nome do
 * árbitro.
 *
 * Ambos pendem da **competição**, não da organização: o mesmo campo
 * cadastrado em duas competições são dois registros. É o desenho do schema,
 * e vem do protótipo — cada campeonato negocia seus locais e sua
 * arbitragem.
 */

export interface DadosDoCampo {
  nome?: string;
  endereco?: string | null;
  tipoPiso?: string | null;
  capacidade?: number | null;
  observacoes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface DadosDoArbitro {
  nome?: string;
  cpf?: string | null;
  federacao?: string | null;
  funcao?: string;
  contato?: string | null;
  fotoUrl?: string | null;
}

/** O enum do banco tem três funções; não invente uma quarta aqui. */
const FUNCOES: funcao_arbitro[] = ['principal', 'assistente', 'mesario'];

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

@Injectable()
export class EstruturaService {
  constructor(private readonly prisma: PrismaService) {}

  private async exigirCompeticao(tx: any, competicaoId: string) {
    const c = await tx.competicoes.findUnique({ where: { id: competicaoId } });
    if (!c) throw new NotFoundException('Competição não encontrada.');
    return c;
  }

  // -------------------------------------------------------------- campos

  listarCampos(organizacaoId: string, competicaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCompeticao(tx, competicaoId);
      const campos = await tx.campos.findMany({
        where: { competicao_id: competicaoId },
        orderBy: { nome: 'asc' },
        include: {
          campo_fotos: { orderBy: { ordem: 'asc' } },
          _count: { select: { jogos: true } },
        },
      });

      return campos.map((f: any) => ({
        id: f.id,
        nome: f.nome,
        endereco: f.endereco,
        tipoPiso: f.tipo_piso,
        capacidade: f.capacidade,
        observacoes: f.observacoes,
        latitude: f.latitude === null ? null : Number(f.latitude),
        longitude: f.longitude === null ? null : Number(f.longitude),
        fotos: f.campo_fotos.map((foto: any) => ({
          id: foto.id,
          url: urlPublica(foto.arquivo_url),
        })),
        jogos: f._count.jogos,
      }));
    });
  }

  criarCampo(organizacaoId: string, competicaoId: string, dados: DadosDoCampo) {
    const nome = texto(dados.nome);
    if (!nome) throw new BadRequestException('Informe o nome do campo.');

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCompeticao(tx, competicaoId);
      const campo = await tx.campos.create({
        data: {
          competicao_id: competicaoId,
          nome,
          endereco: dados.endereco || null,
          tipo_piso: dados.tipoPiso || null,
          capacidade: this.capacidade(dados.capacidade),
          observacoes: dados.observacoes || null,
          latitude: dados.latitude ?? null,
          longitude: dados.longitude ?? null,
        },
      });
      return { id: campo.id, nome: campo.nome };
    });
  }

  private capacidade(v: number | null | undefined): number | null {
    if (v === null || v === undefined || (v as unknown) === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      throw new BadRequestException('Capacidade precisa ser inteiro ≥ 0.');
    }
    return n;
  }

  editarCampo(organizacaoId: string, campoId: string, dados: DadosDoCampo) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const atual = await tx.campos.findUnique({ where: { id: campoId } });
      if (!atual) throw new NotFoundException('Campo não encontrado.');

      const campo = await tx.campos.update({
        where: { id: campoId },
        data: {
          ...(dados.nome !== undefined && { nome: texto(dados.nome) }),
          ...(dados.endereco !== undefined && { endereco: dados.endereco || null }),
          ...(dados.tipoPiso !== undefined && { tipo_piso: dados.tipoPiso || null }),
          ...(dados.capacidade !== undefined && {
            capacidade: this.capacidade(dados.capacidade),
          }),
          ...(dados.observacoes !== undefined && {
            observacoes: dados.observacoes || null,
          }),
          ...(dados.latitude !== undefined && { latitude: dados.latitude }),
          ...(dados.longitude !== undefined && { longitude: dados.longitude }),
        },
      });
      return { id: campo.id, nome: campo.nome };
    });
  }

  /**
   * Excluir um campo usado por jogo apagaria o local de partidas já
   * programadas. A FK é `SET NULL` — o banco não impediria, e o jogo
   * ficaria sem local sem ninguém perceber.
   */
  removerCampo(organizacaoId: string, campoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const campo = await tx.campos.findUnique({
        where: { id: campoId },
        include: { _count: { select: { jogos: true } } },
      });
      if (!campo) throw new NotFoundException('Campo não encontrado.');

      if (campo._count.jogos > 0) {
        throw new ConflictException(
          `Este campo está em ${campo._count.jogos} jogo(s). Reprograme-os antes de excluí-lo.`,
        );
      }

      await tx.campos.delete({ where: { id: campoId } });
      return { removido: campoId };
    });
  }

  /** Foto do campo — o caminho vem de POST /painel/uploads. */
  adicionarFoto(organizacaoId: string, campoId: string, url: unknown) {
    const caminho = paraCaminho(typeof url === 'string' ? url : null);
    if (!caminho) throw new BadRequestException('Informe a imagem.');

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const campo = await tx.campos.findUnique({ where: { id: campoId } });
      if (!campo) throw new NotFoundException('Campo não encontrado.');

      const ordem = await tx.campo_fotos.count({ where: { campo_id: campoId } });
      const foto = await tx.campo_fotos.create({
        data: { campo_id: campoId, arquivo_url: caminho, ordem },
      });
      return { id: foto.id, url: urlPublica(foto.arquivo_url) };
    });
  }

  removerFoto(organizacaoId: string, fotoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const foto = await tx.campo_fotos.findUnique({ where: { id: fotoId } });
      if (!foto) throw new NotFoundException('Foto não encontrada.');
      await tx.campo_fotos.delete({ where: { id: fotoId } });
      return { removido: fotoId };
    });
  }

  // ------------------------------------------------------------ árbitros

  listarArbitros(organizacaoId: string, competicaoId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCompeticao(tx, competicaoId);
      const arbitros = await tx.arbitros.findMany({
        where: { competicao_id: competicaoId },
        orderBy: [{ funcao: 'asc' }, { nome: 'asc' }],
        include: { _count: { select: { jogos: true } } },
      });

      return arbitros.map((a: any) => ({
        id: a.id,
        nome: a.nome,
        federacao: a.federacao,
        funcao: a.funcao,
        contato: a.contato,
        fotoUrl: urlPublica(a.foto_url),
        // CPF não sai da listagem: identifica a pessoa e não serve para
        // escalar ninguém. Fica no banco para a federação, se precisar.
        temCpf: Boolean(a.cpf),
        jogos: a._count.jogos,
      }));
    });
  }

  criarArbitro(
    organizacaoId: string,
    competicaoId: string,
    dados: DadosDoArbitro,
  ) {
    const nome = texto(dados.nome);
    if (!nome) throw new BadRequestException('Informe o nome do árbitro.');
    const funcao = this.funcao(dados.funcao);

    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      await this.exigirCompeticao(tx, competicaoId);
      const arbitro = await tx.arbitros.create({
        data: {
          competicao_id: competicaoId,
          nome,
          cpf: dados.cpf?.replace(/\D/g, '') || null,
          federacao: dados.federacao || null,
          funcao,
          contato: dados.contato || null,
          foto_url: paraCaminho(dados.fotoUrl),
        },
      });
      return { id: arbitro.id, nome: arbitro.nome };
    });
  }

  private funcao(v: string | undefined): funcao_arbitro {
    if (v === undefined) return 'principal';
    if (!FUNCOES.includes(v as funcao_arbitro)) {
      throw new BadRequestException(`Função deve ser uma de: ${FUNCOES.join(', ')}.`);
    }
    return v as funcao_arbitro;
  }

  editarArbitro(organizacaoId: string, arbitroId: string, dados: DadosDoArbitro) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const atual = await tx.arbitros.findUnique({ where: { id: arbitroId } });
      if (!atual) throw new NotFoundException('Árbitro não encontrado.');

      const arbitro = await tx.arbitros.update({
        where: { id: arbitroId },
        data: {
          ...(dados.nome !== undefined && { nome: texto(dados.nome) }),
          ...(dados.cpf !== undefined && {
            cpf: dados.cpf?.replace(/\D/g, '') || null,
          }),
          ...(dados.federacao !== undefined && {
            federacao: dados.federacao || null,
          }),
          ...(dados.funcao !== undefined && { funcao: this.funcao(dados.funcao) }),
          ...(dados.contato !== undefined && { contato: dados.contato || null }),
          ...(dados.fotoUrl !== undefined && {
            foto_url: paraCaminho(dados.fotoUrl),
          }),
        },
      });
      return { id: arbitro.id, nome: arbitro.nome };
    });
  }

  removerArbitro(organizacaoId: string, arbitroId: string) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const arbitro = await tx.arbitros.findUnique({
        where: { id: arbitroId },
        include: { _count: { select: { jogos: true } } },
      });
      if (!arbitro) throw new NotFoundException('Árbitro não encontrado.');

      if (arbitro._count.jogos > 0) {
        throw new ConflictException(
          `Este árbitro está escalado em ${arbitro._count.jogos} jogo(s). Troque a escalação antes de excluí-lo.`,
        );
      }

      await tx.arbitros.delete({ where: { id: arbitroId } });
      return { removido: arbitroId };
    });
  }

  /**
   * Escala campo e árbitro no jogo (RF016). `null` desescala.
   *
   * Os dois precisam ser **da mesma competição** do jogo: sem esta
   * checagem, um id de outra competição entraria pela porta lateral, e o
   * RLS não barraria — as duas competições podem ser da mesma organização.
   */
  escalar(
    organizacaoId: string,
    jogoId: string,
    dados: { campoId?: string | null; arbitroId?: string | null },
  ) {
    return this.prisma.comOrganizacao(organizacaoId, async (tx) => {
      const jogo = await tx.jogos.findUnique({
        where: { id: jogoId },
        include: { categorias: true },
      });
      if (!jogo) throw new NotFoundException('Jogo não encontrado.');
      const competicaoId = jogo.categorias.competicao_id;

      if (dados.campoId) {
        const campo = await tx.campos.findUnique({ where: { id: dados.campoId } });
        if (!campo || campo.competicao_id !== competicaoId) {
          throw new BadRequestException(
            'Campo não pertence a esta competição.',
          );
        }
      }
      if (dados.arbitroId) {
        const arbitro = await tx.arbitros.findUnique({
          where: { id: dados.arbitroId },
        });
        if (!arbitro || arbitro.competicao_id !== competicaoId) {
          throw new BadRequestException(
            'Árbitro não pertence a esta competição.',
          );
        }
      }

      const atualizado = await tx.jogos.update({
        where: { id: jogoId },
        data: {
          ...(dados.campoId !== undefined && { campo_id: dados.campoId }),
          ...(dados.arbitroId !== undefined && { arbitro_id: dados.arbitroId }),
        },
      });

      return {
        id: atualizado.id,
        campoId: atualizado.campo_id,
        arbitroId: atualizado.arbitro_id,
      };
    });
  }
}
