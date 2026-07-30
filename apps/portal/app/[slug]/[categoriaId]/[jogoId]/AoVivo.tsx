'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlAoVivo } from '@/lib/api';

interface Placar {
  mandante: number;
  visitante: number;
}

/**
 * Placar ao vivo: assina o feed SSE da API (EventSource reconecta sozinho).
 * O aviso não traz dado de atleta por desenho — quando um lance chega, o
 * placar atualiza na hora e um refresh do server component busca a
 * cronologia completa pela rota que aplica a regra de visibilidade.
 */
export default function AoVivo({
  slug,
  categoriaId,
  jogoId,
  placarInicial,
}: {
  slug: string;
  categoriaId: string;
  jogoId: string;
  placarInicial: Placar;
}) {
  const [placar, setPlacar] = useState<Placar>(placarInicial);
  const [conectado, setConectado] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fonte = new EventSource(urlAoVivo(slug, categoriaId, jogoId));

    const aoChegar = (ev: MessageEvent) => {
      try {
        const aviso = JSON.parse(ev.data as string);
        if (aviso?.placar) setPlacar(aviso.placar);
        if (ev.type === 'lance') router.refresh(); // busca a cronologia nova
      } catch {
        /* aviso malformado: ignora */
      }
    };

    fonte.addEventListener('estado', aoChegar);
    fonte.addEventListener('lance', aoChegar);
    fonte.addEventListener('jogo', aoChegar);
    fonte.onopen = () => setConectado(true);
    fonte.onerror = () => setConectado(false);
    return () => fonte.close();
  }, [slug, categoriaId, jogoId, router]);

  return (
    <span className="placar" style={{ fontSize: 22, padding: '6px 16px' }}>
      {placar.mandante} × {placar.visitante}
      {conectado && <span className="pill vivo" style={{ marginLeft: 10 }}>AO VIVO</span>}
    </span>
  );
}
