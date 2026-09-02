import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Carrega o .env antes de qualquer provider ser instanciado — o PrismaService
// lê DATABASE_URL já no construtor. Node >= 20.6 tem isso nativo.
try {
  process.loadEnvFile();
} catch {
  // sem .env: assume variáveis já exportadas no ambiente
}

/**
 * Deriva a conexão da aplicação a partir da do dono, quando ela não foi
 * informada.
 *
 * São duas conexões para o MESMO banco: `DATABASE_URL_ADMIN` é o dono, que
 * aplica as migrações e ignora RLS; `DATABASE_URL` é `apitofut_app`, que
 * obedece às políticas e é quem atende os requests. Só mudam usuário e
 * senha — host, porta e banco são idênticos.
 *
 * Montar essa segunda URL à mão é onde o deploy trava: referência a
 * variável de outro serviço que resolve vazia, senha esquecida no
 * placeholder, porta ausente. Nada disso aparece até a aplicação subir e
 * quebrar. Derivar remove o passo inteiro: informe só a do dono e a senha
 * do papel da aplicação.
 *
 * Quem quiser controlar a conexão da aplicação continua podendo — basta
 * definir DATABASE_URL explicitamente, e ela tem precedência.
 */
function derivarConexaoDaAplicacao(): void {
  const informada = process.env.DATABASE_URL;

  // Vale também quando ela EXISTE mas não é utilizável. Uma URL quebrada não
  // é uma escolha do operador, é um engano — e insistir nela só produz outro
  // deploy morto. Derivar e avisar resolve; a variável fica lá, visível, para
  // ser limpa depois.
  if (informada && utilizavel(informada)) return;
  if (informada) {
    console.warn(
      'AVISO: DATABASE_URL está definida mas não é uma URL válida. ' +
        'Derivando de DATABASE_URL_ADMIN e seguindo — remova a variável.',
    );
  }

  const dono = process.env.DATABASE_URL_ADMIN;
  const senha = process.env.APITOFUT_APP_PASSWORD;
  if (!dono || !senha) return; // sem material: `conferirConexao` explica

  try {
    const u = new URL(dono);
    u.username = 'apitofut_app';
    // `password` faz o percent-encoding sozinho: senha com `@`, `:` ou `/`
    // quebraria a URL se fosse concatenada
    u.password = senha;
    process.env.DATABASE_URL = u.toString();
    console.log(
      '→ DATABASE_URL derivada de DATABASE_URL_ADMIN para o papel apitofut_app.',
    );
  } catch {
    // DATABASE_URL_ADMIN inválida: `conferirConexao` dá a mensagem boa
  }
}

/** URL que o `pg` consegue usar: parseia e tem host. */
function utilizavel(url: string): boolean {
  if (url.includes('${{')) return false;
  try {
    return new URL(url).hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Confere a DATABASE_URL antes de instanciar qualquer provider.
 *
 * Sem isto o erro chega como `TypeError: Invalid URL` vindo de dentro do
 * `pg`, no `onModuleInit` do RealtimeService, com a URL redigida pelo log
 * do provedor — não dá para saber se faltou a variável, se o valor tem
 * caractere inválido, ou se uma referência do tipo `${{Postgres.PGHOST}}`
 * não foi resolvida e virou texto literal. Este erro diz qual dos três é.
 */
function conferirConexao(): void {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'DATABASE_URL não definida. É a conexão do papel da aplicação ' +
        '(apitofut_app), que obedece ao RLS.',
    );
  }

  // A referência não resolvida vem ANTES do parse, e não depois: `new URL`
  // ACEITA "${{Postgres.PGHOST}}" no lugar do host — só reclama no lugar da
  // porta, que precisa ser numérica. Quem confia no parse deixa passar
  // metade dos casos, e a aplicação sobe apontando para um host literal.
  if (url.includes('${{')) {
    throw new Error(
      'DATABASE_URL contém "${{...}}": a referência a outro serviço não foi ' +
        'resolvida e o valor foi gravado como texto. Confira se o nome do ' +
        'serviço dentro da referência é exatamente o nome do serviço de banco.',
    );
  }

  try {
    new URL(url);
  } catch {
    // não imprime a URL: ela carrega a senha
    throw new Error(
      'DATABASE_URL não é uma URL válida. Formato esperado: ' +
        'postgresql://usuario:senha@host:porta/banco — senha com caractere ' +
        'especial precisa vir percent-encoded.',
    );
  }
}

async function bootstrap(): Promise<void> {
  derivarConexaoDaAplicacao();
  conferirConexao();
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const porta = Number(process.env.PORT ?? 3000);
  await app.listen(porta);
  console.log(`API do ApitoFut ouvindo em http://localhost:${porta}`);
}

void bootstrap();
