import { Controller, Get } from '@nestjs/common';

/**
 * Configuração que o cliente precisa saber e não pode adivinhar.
 *
 * POR QUE ISTO EXISTE. O painel monta links que apontam para o PORTAL — o
 * convite de inscrição e a validação da carteirinha. Esse endereço vinha
 * de `VITE_PORTAL_URL`, e variável do Vite é resolvida no BUILD: trocar o
 * domínio exigia reconstruir a imagem, e quem apenas trocava a variável
 * continuava vendo o link antigo, sem erro nenhum na tela. O mesmo já
 * havia mordido com `VITE_API_URL` e com o `API_URL` do portal.
 *
 * Lido em runtime o problema some: o endereço mora num lugar só — aqui —
 * e trocar de domínio passa a ser reiniciar a API, não reconstruir imagem.
 *
 * PÚBLICO de propósito: o que ele devolve é o endereço do site público.
 * Não há o que proteger, e exigir token criaria uma ordem de inicialização
 * desnecessária no cliente.
 *
 * O nome não é `ConfigController` porque `ConfigModule` já é o do
 * `@nestjs/config`, importado no AppModule.
 */
@Controller('configuracao')
export class ConfiguracaoPublicaController {
  @Get()
  ler() {
    return {
      // sem barra no fim: quem consome concatena `/{slug}/inscricao`
      portalUrl: (process.env.PORTAL_URL ?? 'http://localhost:3001').replace(
        /\/+$/,
        '',
      ),
    };
  }
}
