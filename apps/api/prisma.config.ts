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
  // Usado apenas pelo CLI (db pull / migrate diff). Em runtime, o
  // PrismaClient recebe um driver adapter — ver src/prisma/prisma.service.ts
  datasource: {
    url: env('DATABASE_URL'),
  },
});
