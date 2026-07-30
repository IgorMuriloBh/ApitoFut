import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Carrega o .env antes de qualquer provider ser instanciado — o PrismaService
// lê DATABASE_URL já no construtor. Node >= 20.6 tem isso nativo.
try {
  process.loadEnvFile();
} catch {
  // sem .env: assume variáveis já exportadas no ambiente
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const porta = Number(process.env.PORT ?? 3000);
  await app.listen(porta);
  console.log(`API do ApitoFut ouvindo em http://localhost:${porta}`);
}

void bootstrap();
