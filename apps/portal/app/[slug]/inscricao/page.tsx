import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AreaDaEquipe from './AreaDaEquipe';

interface Props {
  params: Promise<{ slug: string }>;
}

const API = process.env.API_URL ?? 'http://localhost:3000';

/**
 * Área da equipe — auto-cadastro por link de convite (RF006, RF007).
 *
 * Rota estática, então ganha de `[categoriaId]`: `/copa/inscricao` nunca
 * será confundido com uma categoria.
 *
 * `noindex` de propósito. É um link que o organizador manda para equipes
 * específicas; não é conteúdo de busca, e uma competição `em_criacao`
 * aparecendo no Google seria justamente o que a regra de visibilidade
 * evita no resto do portal.
 */
export const metadata: Metadata = {
  title: 'Inscrição de equipes',
  robots: { index: false, follow: false },
};

export default async function PaginaDeInscricao({ params }: Props) {
  const { slug } = await params;

  // busca no servidor só para o primeiro pintado: a competição pode estar
  // `em_criacao`, que o endpoint público comum esconderia
  const r = await fetch(`${API}/convite/${slug}`, { cache: 'no-store' });
  if (!r.ok) notFound();

  const dados = (await r.json()) as Parameters<typeof AreaDaEquipe>[0]['inicial'];
  return <AreaDaEquipe slug={slug} inicial={dados} />;
}
