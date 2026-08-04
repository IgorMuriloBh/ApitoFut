/**
 * Escudo da equipe ao lado do nome.
 *
 * Sem imagem, mostra as iniciais sobre uma cor derivada do nome — mesma
 * ideia do `crest()` do protótipo e do `Escudo` do painel. Um espaço vazio
 * faria a linha "pular" entre equipes com e sem escudo, e um brasão
 * genérico seria pior: dá a entender que a equipe tem escudo quando não
 * tem.
 */

function iniciais(nome: string): string {
  const das = nome
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-Z]/.test(p))
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  // o filtro pode zerar tudo — nome só de partícula curta ("os 12"), ou
  // campo ainda em branco na pré-visualização da inscrição. Círculo vazio
  // parece defeito, não "sem escudo".
  return das || nome.trim()[0]?.toUpperCase() || '?';
}

/** Cor estável a partir do nome: a mesma equipe tem sempre a mesma cor. */
function matiz(nome: string): string {
  let soma = 0;
  for (let i = 0; i < nome.length; i++) soma = (soma * 31 + nome.charCodeAt(i)) % 360;
  return `hsl(${soma} 45% 42%)`;
}

export function Brasao({
  nome,
  url,
  tamanho = 42,
}: {
  nome: string;
  url?: string | null;
  tamanho?: number;
}) {
  const estilo = { width: tamanho, height: tamanho, fontSize: tamanho * 0.3 };

  if (url) {
    return <img src={url} alt="" className="brasao" style={estilo} />;
  }
  return (
    <span
      aria-hidden
      className="brasao"
      style={{ ...estilo, background: matiz(nome), borderColor: 'transparent' }}
    >
      {iniciais(nome)}
    </span>
  );
}
