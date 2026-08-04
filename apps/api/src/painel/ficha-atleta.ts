import { BadRequestException } from '@nestjs/common';
import type { campo_atleta } from '@prisma/client';

/**
 * Ficha do atleta — o que a categoria pede, e como isso vira coluna.
 *
 * `categoria_inscricao_config` diz *quanto*; `categoria_campo_atleta` diz
 * *o quê*: por campo, se é pedido e se é obrigatório (RF005 · 2.4, RF009).
 * O protótipo monta o formulário a partir dessa configuração
 * (`fichaAtleta()`, linha 1831) — quem preenche vê exatamente os campos
 * que o organizador ligou, nem mais nem menos.
 *
 * Módulo puro, sem Prisma: é usado pelo painel e pela área da equipe, que
 * enxergam bancos com contextos de RLS diferentes.
 *
 * DUAS REGRAS QUE VALEM MAIS DO QUE PARECEM:
 *  - campo não pedido é campo **ignorado** na gravação. Se a equipe mandar
 *    CPF numa categoria que não pede CPF, o dado não entra: o organizador
 *    decidiu não coletar, e coletar assim mesmo seria guardar documento de
 *    menor de idade sem ninguém ter pedido;
 *  - `numero_camisa` não é do atleta, é da INSCRIÇÃO. Ele aparece na mesma
 *    configuração, mas grava em `inscricoes.numero_camisa` — o mesmo
 *    atleta usa números diferentes em categorias diferentes.
 */

export const POSICOES = [
  'Goleiro',
  'Zagueiro',
  'Lateral',
  'Volante',
  'Meia',
  'Atacante',
  'Fixo',
  'Ala',
  'Pivô',
] as const;

export const GENEROS = ['Masculino', 'Feminino'] as const;

/**
 * Cargos da comissão técnica — lista fechada, não campo livre.
 *
 * Campo livre virava "Tecnico", "TÉCNICO", "treinador" e "Prof." na mesma
 * competição, e a súmula impressa mostra o que estiver gravado. A lista é
 * a que o cliente pediu; valores anteriores a ela continuam no banco e
 * continuam sendo exibidos — só não podem ser criados de novo pela área
 * da equipe.
 */
export const CARGOS_COMISSAO = [
  'Treinador',
  'Comissão técnica',
  'Diretoria',
  'Médico(a)/Enfermeiro(a)',
] as const;

export type TipoDeCampo =
  | 'texto'
  | 'data'
  | 'email'
  | 'tel'
  | 'numero'
  | 'selecao'
  | 'foto'
  | 'responsavel'
  | 'anexos';

export interface DescritorDeCampo {
  rotulo: string;
  tipo: TipoDeCampo;
  opcoes?: readonly string[];
}

export const DESCRITORES: Record<campo_atleta, DescritorDeCampo> = {
  apelido: { rotulo: 'Apelido', tipo: 'texto' },
  foto: { rotulo: 'Foto', tipo: 'foto' },
  cpf: { rotulo: 'CPF', tipo: 'texto' },
  rg: { rotulo: 'RG', tipo: 'texto' },
  certidao_nascimento: { rotulo: 'Certidão de nascimento', tipo: 'texto' },
  data_nascimento: { rotulo: 'Data de nascimento', tipo: 'data' },
  posicao: { rotulo: 'Posição', tipo: 'selecao', opcoes: POSICOES },
  numero_camisa: { rotulo: 'Nº da Camisa', tipo: 'numero' },
  celular: { rotulo: 'Celular', tipo: 'tel' },
  email: { rotulo: 'E-mail', tipo: 'email' },
  passaporte: { rotulo: 'Passaporte', tipo: 'texto' },
  titulo_eleitor: { rotulo: 'Título de eleitor', tipo: 'texto' },
  genero: { rotulo: 'Gênero', tipo: 'selecao', opcoes: GENEROS },
  responsavel: { rotulo: 'Responsável (menor de idade)', tipo: 'responsavel' },
  nacionalidade: { rotulo: 'Nacionalidade', tipo: 'texto' },
  documentos_anexo: { rotulo: 'Documentos em anexo', tipo: 'anexos' },
};

/** O que o cliente manda. Chaves em camelCase, como todo o resto da API. */
export interface FichaDoAtleta {
  nome?: string;
  apelido?: string | null;
  cpf?: string | null;
  rg?: string | null;
  certidaoNascimento?: string | null;
  dataNascimento?: string | null;
  posicao?: string | null;
  celular?: string | null;
  email?: string | null;
  passaporte?: string | null;
  tituloEleitor?: string | null;
  genero?: string | null;
  nacionalidade?: string | null;
  responsavelNome?: string | null;
  responsavelContato?: string | null;
  fotoUrl?: string | null;
  documentos?: { tipo?: string; url?: string }[];
}

export interface CampoConfigurado {
  pedir: boolean;
  obrigatorio: boolean;
}

export type ConfigDaFicha = Partial<Record<campo_atleta, CampoConfigurado>>;

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * O valor que representa o campo para efeito de "está preenchido?".
 * `responsavel` conta pelo nome: contato sem nome não identifica ninguém.
 */
function valorDoCampo(campo: campo_atleta, ficha: FichaDoAtleta): string {
  switch (campo) {
    case 'apelido':
      return texto(ficha.apelido);
    case 'foto':
      return texto(ficha.fotoUrl);
    case 'cpf':
      return texto(ficha.cpf);
    case 'rg':
      return texto(ficha.rg);
    case 'certidao_nascimento':
      return texto(ficha.certidaoNascimento);
    case 'data_nascimento':
      return texto(ficha.dataNascimento);
    case 'posicao':
      return texto(ficha.posicao);
    case 'celular':
      return texto(ficha.celular);
    case 'email':
      return texto(ficha.email);
    case 'passaporte':
      return texto(ficha.passaporte);
    case 'titulo_eleitor':
      return texto(ficha.tituloEleitor);
    case 'genero':
      return texto(ficha.genero);
    case 'nacionalidade':
      return texto(ficha.nacionalidade);
    case 'responsavel':
      return texto(ficha.responsavelNome);
    case 'documentos_anexo':
      return (ficha.documentos ?? []).some((d) => texto(d?.url)) ? 'sim' : '';
    // pertence à inscrição, conferido por `exigirNumeroCamisa`
    case 'numero_camisa':
      return '';
  }
}

/**
 * Recusa o envio que deixou em branco um campo que a categoria marcou como
 * obrigatório. A mensagem nomeia o campo — "campo obrigatório" sozinho
 * manda o responsável caçar qual dos doze faltou.
 */
export function exigirObrigatorios(
  config: ConfigDaFicha,
  ficha: FichaDoAtleta,
): void {
  for (const [campo, c] of Object.entries(config) as [
    campo_atleta,
    CampoConfigurado,
  ][]) {
    if (!c?.pedir || !c.obrigatorio) continue;
    if (campo === 'numero_camisa') continue;
    if (!valorDoCampo(campo, ficha)) {
      throw new BadRequestException(
        `Campo obrigatório: ${DESCRITORES[campo].rotulo}.`,
      );
    }
  }
}

export function exigirNumeroCamisa(
  config: ConfigDaFicha,
  numero: number | null | undefined,
): number | null {
  const c = config.numero_camisa;
  if (numero == null || Number.isNaN(numero)) {
    if (c?.pedir && c.obrigatorio) {
      throw new BadRequestException('Campo obrigatório: Nº da Camisa.');
    }
    return null;
  }
  if (!Number.isInteger(numero) || numero < 1 || numero > 99) {
    throw new BadRequestException('Nº da Camisa deve estar entre 1 e 99.');
  }
  return numero;
}

/**
 * Ano de nascimento plausível.
 *
 * `<input type="date">` aceita 0218 sem reclamar — o ano tem quatro dígitos
 * e o navegador dá por bom. O banco também: `date` vai de 4713 a.C. a
 * 5874897 d.C. Quem barra é aqui.
 */
const ANO_MINIMO = 1900;

export function dataDeNascimento(valor: string | null | undefined): Date | null {
  const bruto = texto(valor);
  if (!bruto) return null;

  const m = bruto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new BadRequestException('Data de nascimento inválida.');

  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const limite = new Date().getUTCFullYear();
  if (ano < ANO_MINIMO || ano > limite) {
    throw new BadRequestException(
      `Ano de nascimento inválido: informe um ano entre ${ANO_MINIMO} e ${limite}.`,
    );
  }

  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // 2026-02-31 vira 03-03 no construtor: só a volta denuncia
  if (
    d.getUTCFullYear() !== ano ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    throw new BadRequestException('Data de nascimento inválida.');
  }
  if (d.getTime() > Date.now()) {
    throw new BadRequestException('Data de nascimento no futuro.');
  }
  return d;
}

/**
 * Traduz a ficha em colunas de `atletas`, **só** com os campos que a
 * categoria pede. Devolve `undefined` para o que não foi configurado, de
 * modo que um `update` parcial não apague o que outra categoria coletou.
 */
export function colunasDoAtleta(
  config: ConfigDaFicha,
  ficha: FichaDoAtleta,
): Record<string, unknown> {
  const pede = (campo: campo_atleta) => config[campo]?.pedir === true;
  const dados: Record<string, unknown> = {};
  const por = (campo: campo_atleta, coluna: string, valor: string) => {
    if (pede(campo)) dados[coluna] = valor || null;
  };

  por('apelido', 'apelido', texto(ficha.apelido));
  por('rg', 'rg', texto(ficha.rg));
  por('certidao_nascimento', 'certidao_nascimento', texto(ficha.certidaoNascimento));
  por('posicao', 'posicao', texto(ficha.posicao));
  por('celular', 'celular', texto(ficha.celular));
  por('email', 'email', texto(ficha.email));
  por('passaporte', 'passaporte', texto(ficha.passaporte));
  por('titulo_eleitor', 'titulo_eleitor', texto(ficha.tituloEleitor));
  por('genero', 'genero', texto(ficha.genero));
  por('nacionalidade', 'nacionalidade', texto(ficha.nacionalidade));

  if (pede('cpf')) dados.cpf = texto(ficha.cpf).replace(/\D/g, '') || null;
  if (pede('data_nascimento')) {
    dados.data_nascimento = dataDeNascimento(ficha.dataNascimento);
  }
  if (pede('responsavel')) {
    dados.responsavel_nome = texto(ficha.responsavelNome) || null;
    dados.responsavel_contato = texto(ficha.responsavelContato) || null;
  }

  // valor de seleção fora da lista é erro de cliente, não dado do usuário
  if (dados.posicao && !POSICOES.includes(dados.posicao as never)) {
    throw new BadRequestException('Posição inválida.');
  }
  if (dados.genero && !GENEROS.includes(dados.genero as never)) {
    throw new BadRequestException('Gênero inválido.');
  }

  return dados;
}

/** A configuração da categoria no formato que o cliente consome. */
export function fichaConfigurada(
  linhas: { campo: campo_atleta; pedir: boolean; obrigatorio: boolean }[],
): { campo: campo_atleta; rotulo: string; tipo: TipoDeCampo; opcoes?: readonly string[]; obrigatorio: boolean }[] {
  return linhas
    .filter((l) => l.pedir)
    .map((l) => ({
      campo: l.campo,
      rotulo: DESCRITORES[l.campo].rotulo,
      tipo: DESCRITORES[l.campo].tipo,
      ...(DESCRITORES[l.campo].opcoes && { opcoes: DESCRITORES[l.campo].opcoes }),
      obrigatorio: l.obrigatorio,
    }));
}
