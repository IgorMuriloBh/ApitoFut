/**
 * Súmula impressa (RF018) — `sumulaHTML()` no protótipo, linha 3351.
 *
 * É o papel que vai para a mesa: a arbitragem preenche à mão durante o
 * jogo, e depois alguém digita na súmula online. Por isso quase tudo aqui
 * é **espaço em branco** — rubrica, gols, cartões, substituições, faltas,
 * relatório. O sistema imprime quem está inscrito; o resto é do jogo.
 *
 * HTML puro, sem framework: o destino é a impressora, e o navegador do
 * cliente só precisa abrir e dar Ctrl+P. A folha é A4 paisagem, com uma
 * súmula por página — daí `page-break-after` em cada jogo, que é o que faz
 * a impressão em lote funcionar.
 */

export interface AtletaDaSumula {
  nome: string;
  numero: number | null;
  dataNascimento: string | null;
}

export interface LadoDaSumula {
  nome: string;
  atletas: AtletaDaSumula[];
  comissao: { nome: string; cargo: string }[];
}

export interface JogoDaSumula {
  competicao: string;
  categoria: string;
  fase: string | null;
  rodada: number | null;
  data: string | null;
  hora: string | null;
  campo: string | null;
  arbitro: string | null;
  mandante: LadoDaSumula;
  visitante: LadoDaSumula;
}

/** Nunca interpolar dado do banco em HTML sem escapar. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dataBR(iso: string | null): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : '';
}

const BORDA = 'border:1px solid #999;padding:2px';

/**
 * Mínimo de linhas do elenco. Com menos, sobra papel; com mais, a folha
 * quebra. Catorze cobre o elenco típico e ainda deixa linhas em branco
 * para quem for inscrito na hora — o protótipo usa o mesmo número.
 */
const LINHAS_MINIMAS = 14;

function tabelaDeAtletas(lado: LadoDaSumula): string {
  const linhas = Math.max(LINHAS_MINIMAS, lado.atletas.length);

  const corpo = Array.from({ length: linhas }, (_, i) => {
    const a = lado.atletas[i];
    return `<tr>
      <td style="${BORDA};text-align:center">${a ? dataBR(a.dataNascimento) : ''}</td>
      <td style="${BORDA}">${a ? esc(a.nome) : ''}</td>
      <td style="${BORDA};text-align:center">${a?.numero ?? ''}</td>
      <td style="${BORDA}"></td><td style="${BORDA}"></td>
      <td style="${BORDA}"></td><td style="${BORDA}"></td>
      <td style="${BORDA}"></td>
    </tr>`;
  }).join('');

  return `<table style="width:100%;border-collapse:collapse;font-size:9px">
    <thead><tr style="background:#DBEAFE">
      <th style="${BORDA}">Data nasc.</th>
      <th style="${BORDA};text-align:left">Nome do atleta</th>
      <th style="${BORDA}">Nº</th>
      <th style="${BORDA};width:52px">Rubrica</th>
      <th style="${BORDA}">Gols</th>
      <th style="${BORDA}">Assist.</th>
      <th style="${BORDA};background:#FEF08A">CAm</th>
      <th style="${BORDA};background:#FCA5A5">CV</th>
    </tr></thead>
    <tbody>${corpo}</tbody></table>`;
}

function tabelaDaComissao(lado: LadoDaSumula): string {
  const corpo = Array.from({ length: 3 }, (_, i) => {
    const m = lado.comissao[i];
    return `<tr>
      <td style="${BORDA}">${m ? `${esc(m.nome)} — ${esc(m.cargo)}` : ''}</td>
      <td style="${BORDA}"></td><td style="${BORDA}"></td><td style="${BORDA}"></td>
    </tr>`;
  }).join('');

  return `<table style="width:100%;border-collapse:collapse;font-size:9px;margin-bottom:4px">
    <thead><tr style="background:#DBEAFE">
      <th style="${BORDA};text-align:left">Comissão técnica — cargo</th>
      <th style="${BORDA}">Assinatura</th>
      <th style="${BORDA};background:#FEF08A">CA</th>
      <th style="${BORDA};background:#FCA5A5">CV</th>
    </tr></thead><tbody>${corpo}</tbody></table>`;
}

/** Uma súmula. Várias delas concatenadas viram a impressão em lote. */
export function sumulaDeUmJogo(j: JogoDaSumula): string {
  const cabecalho = [
    j.fase,
    j.rodada ? `${j.rodada}ª rodada` : null,
    dataBR(j.data),
    j.hora?.slice(0, 5),
    j.campo ?? 'Local a definir',
    `Árbitro: ${j.arbitro ?? '________________'}`,
  ]
    .filter(Boolean)
    .map((p) => esc(p))
    .join(' · ');

  const coluna = (lado: LadoDaSumula) =>
    `<div>
      <div style="font-weight:bold;font-size:10px;margin-bottom:3px">${esc(lado.nome)}</div>
      ${tabelaDaComissao(lado)}${tabelaDeAtletas(lado)}
    </div>`;

  return `<div style="page-break-after:always;padding:14px;font-family:Arial,sans-serif">
    <div style="text-align:center;font-weight:bold;font-size:13px;margin-bottom:8px">
      ${esc(j.competicao)} — ${esc(j.categoria)}
    </div>
    <div style="text-align:center;font-size:10px;margin-bottom:10px">${cabecalho}</div>

    <div style="display:grid;grid-template-columns:1fr 96px 1fr;gap:8px;align-items:start">
      ${coluna(j.mandante)}
      <div style="text-align:center;padding-top:14px">
        <div style="display:flex;gap:6px;justify-content:center;align-items:center">
          <div style="width:34px;height:34px;border:1px solid #333"></div>
          <b>X</b>
          <div style="width:34px;height:34px;border:1px solid #333"></div>
        </div>
        <div style="font-size:8px;margin-top:4px">Pênaltis</div>
        <div style="display:flex;gap:6px;justify-content:center;margin-top:2px">
          <div style="width:22px;height:20px;border:1px solid #333"></div>
          <div style="width:22px;height:20px;border:1px solid #333"></div>
        </div>
      </div>
      ${coluna(j.visitante)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;font-size:9px">
      <div style="border:1px solid #999">
        <div style="background:#FEE2E2;padding:2px 4px;font-weight:bold">Substituições — entra / sai</div>
        <div style="height:36px"></div>
      </div>
      <div style="border:1px solid #999">
        <div style="background:#DBEAFE;padding:2px 4px;font-weight:bold">Faltas acumuladas — 1ºT / 2ºT</div>
        <div style="height:36px"></div>
      </div>
    </div>

    <div style="border:1px solid #999;margin-top:8px;font-size:9px">
      <div style="background:#DCFCE7;padding:2px 4px;font-weight:bold">Relatório do árbitro</div>
      <div style="height:52px"></div>
    </div>

    <div style="display:flex;gap:14px;margin-top:6px;font-size:9px">
      <span>Início 1ºT: ______</span><span>Fim 1ºT: ______</span>
      <span>Início 2ºT: ______</span><span>Fim 2ºT: ______</span>
      <span>Período extra: ______</span>
    </div>
  </div>`;
}

/** Documento completo, pronto para o Ctrl+P. */
export function paginaDeImpressao(jogos: JogoDaSumula[]): string {
  const titulo = jogos.length === 1 ? 'Súmula' : `Súmulas (${jogos.length})`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(titulo)} · ApitoFut</title>
<style>
  @page { size: A4 landscape; margin: 8mm }
  body { margin: 0 }
  /* a última súmula não força uma folha em branco depois dela */
  div[style*="page-break-after"]:last-child { page-break-after: auto }
  @media screen {
    body { background: #F1F5F9; padding: 16px }
    div[style*="page-break-after"] { background: #fff; margin: 0 auto 16px; max-width: 1040px;
      box-shadow: 0 1px 3px rgba(0,0,0,.2) }
  }
</style></head>
<body>${jogos.map(sumulaDeUmJogo).join('')}</body></html>`;
}
