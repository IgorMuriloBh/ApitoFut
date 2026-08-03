/**
 * Escudo da equipe ao lado do nome.
 *
 * Sem imagem, mostra as iniciais sobre uma cor derivada do nome — a mesma
 * ideia do `crest()` do protótipo. Um espaço vazio faria as listas
 * "pularem" entre linhas com e sem escudo, e uma imagem genérica seria
 * pior: dá a entender que a equipe tem escudo quando não tem.
 */

function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-Z]/.test(p))
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/**
 * Cor estável a partir do nome: a mesma equipe tem sempre a mesma cor, em
 * qualquer tela, sem guardar nada no banco.
 */
function matiz(nome: string): string {
  let soma = 0;
  for (let i = 0; i < nome.length; i++) soma = (soma * 31 + nome.charCodeAt(i)) % 360;
  return `hsl(${soma} 45% 42%)`;
}

const TAMANHOS = {
  sm: 'w-5 h-5 text-[8px]',
  md: 'w-7 h-7 text-[10px]',
  lg: 'w-10 h-10 text-xs',
} as const;

export function Escudo({
  nome,
  url,
  tamanho = 'md',
}: {
  nome: string;
  url?: string | null;
  tamanho?: keyof typeof TAMANHOS;
}) {
  const classe = `${TAMANHOS[tamanho]} rounded-full shrink-0 object-contain bg-white`;

  if (url) {
    return <img src={url} alt="" className={`${classe} border border-slate-200`} />;
  }

  return (
    <span
      aria-hidden
      className={`${TAMANHOS[tamanho]} rounded-full shrink-0 grid place-items-center font-bold text-white`}
      style={{ background: matiz(nome) }}
    >
      {iniciais(nome)}
    </span>
  );
}

/** Escudo + nome, que é como a equipe aparece em quase toda lista. */
export function EquipeComEscudo({
  nome,
  url,
  tamanho,
  className = '',
}: {
  nome: string;
  url?: string | null;
  tamanho?: keyof typeof TAMANHOS;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <Escudo nome={nome} url={url} tamanho={tamanho} />
      <span className="truncate">{nome}</span>
    </span>
  );
}
