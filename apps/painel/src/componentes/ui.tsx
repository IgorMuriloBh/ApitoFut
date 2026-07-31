import type { ReactNode } from 'react';
import { STATUS } from '../lib/dominio';

export function Cartao({
  titulo,
  sub,
  acao,
  children,
}: {
  titulo?: string;
  sub?: string;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {titulo && (
        <header className="flex items-center gap-3 px-5 py-3 border-b border-slate-200">
          <div className="flex-1">
            <h2 className="text-sm font-semibold">{titulo}</h2>
            {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
          </div>
          {acao}
        </header>
      )}
      {children}
    </section>
  );
}

export function Botao({
  variante = 'primario',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'primario' | 'neutro' | 'perigo';
}) {
  const estilos = {
    primario: 'bg-marca text-white hover:bg-marca-escura',
    neutro: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    perigo: 'bg-red-600 text-white hover:bg-red-700',
  }[variante];

  return (
    <button
      {...props}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${estilos} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Campo({
  rotulo,
  obrigatorio,
  dica,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  dica?: string;
  children: ReactNode;
}) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium mb-1.5">
        {rotulo}
        {obrigatorio && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      {children}
      {dica && <span className="block text-xs text-slate-500 mt-1">{dica}</span>}
    </label>
  );
}

export const classeEntrada =
  'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-marca/30 focus:border-marca';

export function Selo({ status }: { status: string }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${s?.cor ?? 'bg-slate-100 text-slate-700'}`}
    >
      {s?.rotulo ?? status}
    </span>
  );
}

export function Alerta({
  tom = 'info',
  children,
}: {
  tom?: 'info' | 'erro' | 'aviso';
  children: ReactNode;
}) {
  const estilos = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    erro: 'bg-red-50 border-red-200 text-red-800',
    aviso: 'bg-amber-50 border-amber-200 text-amber-800',
  }[tom];
  return (
    <div className={`border rounded-lg px-4 py-3 text-sm ${estilos}`} role={tom === 'erro' ? 'alert' : undefined}>
      {children}
    </div>
  );
}
