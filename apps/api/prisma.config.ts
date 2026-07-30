import { defineConfig, env } from 'prisma/config';

// O Prisma 7 não carrega .env sozinho. Node >= 20.6 tem loadEnvFile nativo,
// então não precisamos de dotenv.
try {
  process.loadEnvFile();
} catch {
  // sem .env (CI, produção com env já exportada) — segue com process.env
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Só o CLI (db pull / migrate diff) usa isto, e ele precisa do DONO do
  // banco para enxergar o catálogo inteiro — o papel da aplicação está sob
  // RLS e enxergaria um schema parcial.
  // Em runtime quem manda é o driver adapter, com a DATABASE_URL restrita.
  datasource: {
    url: process.env.DIRECT_URL ?? env('DATABASE_URL'),
  },
});
