import type { ReactNode } from 'react';

/**
 * Menu lateral da competição — o `renderSidebar` do protótipo (linha 816).
 *
 * POR QUE TROCAR AS ABAS DE TOPO POR ISTO. A fila de abas funcionava com
 * quatro itens; com onze ela transborda e some no scroll horizontal, e
 * perde o que a lateral dá de graça: **agrupamento**. "Equipes" e
 * "Atletas" são cadastro; "Tabela" e "Súmulas" são operação; "Campos" e
 * "Configurações" são estrutura. Numa fila reta esses três blocos viram
 * onze itens iguais, e o organizador tem que ler todos para achar um.
 *
 * As seções são exatamente as do protótipo — `NAV_COMP`, linha 797.
 */

export interface ItemDoMenu {
  chave: string;
  icone: string;
  rotulo: string;
  /** Contador ao lado do rótulo: pendências que pedem ação. */
  aviso?: number;
}

export interface SecaoDoMenu {
  titulo: string;
  itens: ItemDoMenu[];
}

export function MenuLateral({
  secoes,
  atual,
  aoEscolher,
  topo,
}: {
  secoes: SecaoDoMenu[];
  atual: string;
  aoEscolher: (chave: string) => void;
  /** Cabeçalho do menu — no painel, a competição ativa. */
  topo?: ReactNode;
}) {
  return (
    <nav
      className="lg:w-60 shrink-0 lg:border-r border-slate-200 lg:min-h-[calc(100vh-3.5rem)] bg-white"
      aria-label="Seções da competição"
    >
      {topo && <div className="p-4 border-b border-slate-200">{topo}</div>}

      {/* Em telas estreitas o menu vira uma faixa rolável no topo: o
          organizador usa o painel no tablet, na beira do campo, e uma
          coluna fixa de 240px comeria metade da tela. */}
      <div className="flex lg:block overflow-x-auto lg:overflow-visible p-2 gap-1">
        {secoes.map((secao) => (
          <div key={secao.titulo} className="lg:mb-3 flex lg:block gap-1">
            <p className="hidden lg:block px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {secao.titulo}
            </p>
            {secao.itens.map((item) => (
              <button
                key={item.chave}
                onClick={() => aoEscolher(item.chave)}
                aria-current={atual === item.chave ? 'page' : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition ${
                  atual === item.chave
                    ? 'bg-green-50 text-marca font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-base leading-none">{item.icone}</span>
                <span className="flex-1 text-left">{item.rotulo}</span>
                {item.aviso ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    {item.aviso}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
