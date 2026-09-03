import type { Metadata } from 'next';
import Ajuda from './Ajuda';

/**
 * Manual do sistema, lado público.
 *
 * O público daqui é outro: o responsável pela equipe que recebeu o link de
 * inscrição, e a torcida que acompanha a competição. Por isso o acervo é
 * filtrado por `onde=portal` — tópicos de operação da súmula não ajudam
 * quem só quer cadastrar o elenco.
 *
 * Sem `noindex`: ao contrário da área da equipe, esta página é conteúdo
 * útil e público. Quem procurar "como me inscrevo no campeonato" no
 * buscador merece encontrar.
 */
export const metadata: Metadata = {
  title: 'Ajuda · ApitoFut',
  description:
    'Como inscrever a equipe, cadastrar atletas e acompanhar a competição.',
};

const API = process.env.API_URL ?? 'http://localhost:3000';

export interface TopicoDoManual {
  id: string;
  titulo: string;
  resumo: string;
  corpo: string[];
  destino?: { portal?: string };
  acao?: string;
}

export default async function PaginaDeAjuda() {
  // busca no servidor para o primeiro pintado: a ajuda precisa aparecer
  // mesmo para quem tem conexão ruim, que é parte de quem está com dúvida
  const r = await fetch(`${API}/manual?onde=portal`, { cache: 'no-store' });
  const dados = r.ok
    ? ((await r.json()) as { topicos: TopicoDoManual[] })
    : { topicos: [] };

  return <Ajuda inicial={dados.topicos} />;
}
