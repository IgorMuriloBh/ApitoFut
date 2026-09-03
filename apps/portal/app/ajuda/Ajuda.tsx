'use client';

import { useEffect, useState } from 'react';
import type { TopicoDoManual } from './page';

/**
 * Busca da ajuda no portal.
 *
 * A lista chega pronta do servidor; digitar filtra pela API, que é a mesma
 * usada pelo painel — pergunta igual, resposta igual nos dois lugares.
 */

/**
 * Renderiza `**negrito**` do texto do manual.
 *
 * Sem `innerHTML`: monta elementos React, então nada do acervo pode virar
 * HTML executável. O acervo é nosso, mas confiar nele por ser nosso é
 * exatamente como injeções entram.
 */
function comEnfase(texto: string) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**') ? (
      <strong key={i}>{parte.slice(2, -2)}</strong>
    ) : (
      parte
    ),
  );
}

const SUGESTOES = [
  'como inscrevo minha equipe',
  'perdi o código de acesso',
  'cadastrar atleta',
  'carteirinha do atleta',
];

export default function Ajuda({ inicial }: { inicial: TopicoDoManual[] }) {
  const [consulta, setConsulta] = useState('');
  const [topicos, setTopicos] = useState(inicial);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = consulta.trim();
      const caminho = q
        ? `/api/manual/busca?onde=portal&q=${encodeURIComponent(q)}`
        : '/api/manual?onde=portal';
      try {
        const r = await fetch(caminho);
        if (!r.ok) return;
        const d = (await r.json()) as { topicos: TopicoDoManual[] };
        setTopicos(d.topicos);
      } catch {
        // rede fora: a lista que veio do servidor continua na tela
      }
    }, 250);
    return () => clearTimeout(t);
  }, [consulta]);

  return (
    <main>
      <header className="faixa">
        <div className="miolo">
          <span className="pill">Manual</span>
          <h1 style={{ fontSize: 26, marginTop: 6 }}>Ajuda</h1>
          <p style={{ opacity: 0.85, fontSize: 14 }}>
            Escreva sua dúvida como você falaria.
          </p>
        </div>
      </header>

      <div className="miolo" style={{ paddingBottom: 40 }}>
        <div className="cartao">
          <div style={{ padding: 16 }}>
            <input
              autoFocus
              placeholder="Ex.: como inscrevo minha equipe?"
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
            />
            <div
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}
            >
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  className="neutro"
                  style={{ fontSize: 12, padding: '5px 11px' }}
                  onClick={() => setConsulta(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {topicos.length === 0 && (
          <div className="cartao">
            <p className="vazio">
              Nada encontrado. Tente com outras palavras — o manual entende o
              jeito comum de falar.
            </p>
          </div>
        )}

        {topicos.map((t) => {
          const expandido = aberto === t.id || consulta.trim().length > 0;
          return (
            <div key={t.id} className="cartao">
              <button
                onClick={() => setAberto(aberto === t.id ? null : t.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  color: 'inherit',
                  padding: '13px 16px',
                  fontWeight: 600,
                }}
              >
                {t.titulo}
                <span
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    color: 'var(--tinta2)',
                    fontWeight: 400,
                    marginTop: 2,
                  }}
                >
                  {t.resumo}
                </span>
              </button>

              {expandido && (
                <div
                  style={{
                    padding: '12px 16px 16px',
                    borderTop: '1px solid var(--linha)',
                    fontSize: 14,
                    lineHeight: 1.65,
                  }}
                >
                  {t.corpo.map((p, i) => (
                    <p key={i} style={{ marginBottom: 8 }}>
                      {comEnfase(p)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
        Plataforma <b>ApitoFut</b>
      </footer>
    </main>
  );
}
