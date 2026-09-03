import { Controller, Get, Query } from '@nestjs/common';
import { buscar } from './busca';
import { MANUAL_VERSAO, TOPICOS, type Publico } from './topicos';

/**
 * Manual do sistema (RF — ajuda ao usuário).
 *
 * PÚBLICO e sem token: o portal é anônimo, e a ajuda precisa funcionar
 * inclusive para quem não conseguiu entrar — "criei a conta e não entro" é
 * justamente um dos tópicos. Exigir sessão fecharia a porta na cara de
 * quem mais precisa dela.
 *
 * A busca acontece no servidor para que o acervo não precise viajar
 * inteiro até o cliente, e para que painel e portal usem exatamente a
 * mesma pontuação — dúvida igual, resposta igual, nos dois lugares.
 */
@Controller('manual')
export class ManualController {
  /** GET /manual?onde=painel|portal — acervo completo. */
  @Get()
  listar(@Query('onde') onde?: string) {
    const publico = onde === 'painel' || onde === 'portal' ? onde : undefined;
    return {
      versao: MANUAL_VERSAO,
      topicos: publico
        ? TOPICOS.filter((t) => t.onde.includes(publico as Publico))
        : TOPICOS,
    };
  }

  /** GET /manual/busca?q=&onde= — os tópicos que respondem à dúvida. */
  @Get('busca')
  procurar(@Query('q') q = '', @Query('onde') onde?: string) {
    const publico = onde === 'painel' || onde === 'portal' ? onde : undefined;
    const achados = buscar(q, publico as Publico | undefined);
    return {
      versao: MANUAL_VERSAO,
      consulta: q,
      total: achados.length,
      topicos: achados.map((a) => a.topico),
    };
  }
}
