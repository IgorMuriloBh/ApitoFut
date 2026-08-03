import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Municipio } from '../lib/api';
import { classeEntrada } from './ui';

/**
 * Seletor de município por UF (migration 18).
 *
 * A cidade era campo livre: "Belo Horizonte", "belo horizonte" e "BH"
 * viravam três cidades diferentes, e nenhum filtro por praça funcionava
 * depois. Agora só sai da lista do IBGE.
 *
 * O combo é caseiro em vez de `<datalist>` ou de uma biblioteca: o
 * `datalist` não impede texto fora da lista (que é justamente o problema
 * que se quer resolver), e uma biblioteca de autocomplete seria dependência
 * nova para trezentas linhas.
 */

/** Sem acento dos dois lados: quem digita "sao goncalo" acha "São Gonçalo". */
const simplificar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export function SeletorDeCidade({
  uf,
  valor,
  aoMudar,
}: {
  /** Sigla da UF; sem ela o seletor fica desabilitado. */
  uf: string;
  valor: string;
  aoMudar: (cidade: string) => void;
}) {
  const [municipios, setMunicipios] = useState<Municipio[] | null>(null);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  /**
   * Carrega a UF inteira de uma vez e filtra no cliente. São Paulo tem 645
   * municípios — um payload pequeno, e depois disso digitar não custa
   * viagem à rede. A resposta é cacheável por um dia.
   */
  useEffect(() => {
    if (!uf) {
      setMunicipios(null);
      return;
    }
    let ativo = true;
    setErro(null);
    api
      .municipios(uf)
      .then((lista) => ativo && setMunicipios(lista))
      .catch(() => ativo && setErro('Não foi possível carregar as cidades.'));
    return () => {
      ativo = false;
    };
  }, [uf]);

  // clicar fora fecha a lista sem escolher nada
  useEffect(() => {
    const aoClicar = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) {
        setAberto(false);
      }
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, []);

  const filtrados = useMemo(() => {
    if (!municipios) return [];
    const termo = simplificar(busca);
    if (!termo) return municipios.slice(0, 60);
    return municipios
      .filter((m) => simplificar(m.nome).includes(termo))
      .slice(0, 60);
  }, [municipios, busca]);

  if (!uf) {
    return (
      <input
        className={classeEntrada}
        disabled
        placeholder="Selecione o estado primeiro"
      />
    );
  }

  return (
    <div className="relative" ref={caixa}>
      <input
        className={classeEntrada}
        value={aberto ? busca : valor}
        placeholder={
          municipios ? 'Digite para buscar a cidade…' : 'Carregando cidades…'
        }
        onFocus={() => {
          setBusca('');
          setAberto(true);
        }}
        onChange={(e) => {
          setBusca(e.target.value);
          setAberto(true);
        }}
        autoComplete="off"
      />

      {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}

      {aberto && municipios && (
        <ul className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {filtrados.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">
              Nenhuma cidade de {uf} com “{busca}”.
            </li>
          ) : (
            filtrados.map((m) => (
              <li key={m.codigo}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // mousedown, não click: o blur do input fecharia a
                    // lista antes de o clique chegar
                    e.preventDefault();
                    aoMudar(m.nome);
                    setAberto(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                    m.nome === valor ? 'bg-green-50 text-marca font-medium' : ''
                  }`}
                >
                  {m.nome}
                </button>
              </li>
            ))
          )}
          {municipios.length > filtrados.length && filtrados.length === 60 && (
            <li className="px-3 py-2 text-xs text-slate-400 border-t border-slate-100">
              Mostrando as 60 primeiras — refine a busca.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
