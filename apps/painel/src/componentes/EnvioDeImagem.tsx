import { useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * Envio de imagem reaproveitado por escudo de equipe, logo de competição e
 * foto de atleta.
 *
 * Guarda **o caminho**, não a URL: é o caminho que vai para o banco. A
 * prévia usa a URL absoluta que a API devolve junto — trocar o domínio da
 * API não pode invalidar escudo já enviado.
 */

const LIMITE_MB = 2;

export function EnvioDeImagem({
  valor,
  aoMudar,
  rotulo = 'Imagem',
  redonda,
}: {
  /** Caminho ou URL já gravado; `null` quando não há imagem. */
  valor: string | null;
  aoMudar: (caminho: string | null) => void;
  rotulo?: string;
  /** Escudo e foto ficam melhores em círculo; logo e banner, não. */
  redonda?: boolean;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<string | null>(valor);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);

    // conferência local só para dar resposta imediata; quem decide de
    // verdade é a API, que olha os bytes e não o que o navegador declarou
    if (arquivo.size > LIMITE_MB * 1024 * 1024) {
      setErro(`Imagem maior que ${LIMITE_MB} MB.`);
      return;
    }

    setEnviando(true);
    try {
      const r = await api.enviarImagem(arquivo);
      setPrevia(r.url);
      aoMudar(r.caminho);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enviar a imagem.');
    } finally {
      setEnviando(false);
      // permite reescolher o mesmo arquivo depois de um erro
      if (entrada.current) entrada.current.value = '';
    }
  }

  function remover() {
    setPrevia(null);
    setErro(null);
    aoMudar(null);
    if (entrada.current) entrada.current.value = '';
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <div
          className={`w-16 h-16 shrink-0 border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center ${
            redonda ? 'rounded-full' : 'rounded-lg'
          }`}
        >
          {previa ? (
            <img src={previa} alt={rotulo} className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl text-slate-300">🖼</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <input
            ref={entrada}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void escolher(e.target.files?.[0])}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => entrada.current?.click()}
              disabled={enviando}
              className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              {enviando ? 'Enviando…' : previa ? 'Trocar' : 'Escolher imagem'}
            </button>
            {previa && !enviando && (
              <button
                type="button"
                onClick={remover}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:text-red-600"
              >
                Remover
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            PNG, JPEG ou WebP · até {LIMITE_MB} MB
          </p>
        </div>
      </div>

      {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
    </div>
  );
}
