import { useEffect, useState } from 'react';
import { EnvioDeImagem } from '../componentes/EnvioDeImagem';
import { SeletorDeCidade } from '../componentes/SeletorDeCidade';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import { api, type Estado } from '../lib/api';
import {
  CORES, FASES, FORMATOS, GENEROS, MODALIDADES, PAISES, TIPOS,
  categoriaPadrao, iniciais, type CategoriaBase,
} from '../lib/dominio';

/**
 * Wizard "Criar campeonato" em 3 etapas, como no protótipo. A validação
 * definitiva é da API — aqui só evitamos ida e volta óbvia; as mensagens
 * exibidas ao usuário são sempre as que a API devolve.
 */
export function Wizard({
  aoCancelar,
  aoCriar,
}: {
  aoCancelar: () => void;
  aoCriar: () => void;
}) {
  const [etapa, setEtapa] = useState(1);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const [nome, setNome] = useState('');
  const [pais, setPais] = useState('Brasil');
  const [estado, setEstado] = useState('');
  const [cidade, setCidade] = useState('');
  const [estados, setEstados] = useState<Estado[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // as UFs vêm do cadastro do IBGE (migration 18), não de uma lista fixa
  useEffect(() => {
    void api.estados().then(setEstados).catch(() => undefined);
  }, []);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [regulamento, setRegulamento] = useState('');
  const [cor, setCor] = useState('#16A34A');
  const [possuiCategorias, setPossuiCategorias] = useState(true);
  const [categorias, setCategorias] = useState<CategoriaBase[]>([
    categoriaPadrao('Categoria 1'),
  ]);
  const [aba, setAba] = useState(0);

  function avancarDaEtapa1() {
    setErro(null);
    if (!possuiCategorias) {
      // regra do protótipo: sem categorias, nasce uma com o nome do campeonato
      setCategorias([categoriaPadrao(nome.trim())]);
      setEtapa(3);
      return;
    }
    setEtapa(2);
  }

  function alterarCategoria(indice: number, mudanca: Partial<CategoriaBase>) {
    setCategorias((atual) =>
      atual.map((c, i) => {
        if (i !== indice) return c;
        const nova = { ...c, ...mudanca };
        // pontos corridos = grupo único (catSet no protótipo)
        if (nova.formato === 'pontos_mata') nova.numGrupos = 1;
        return nova;
      }),
    );
  }

  function adicionarCategoria() {
    // replica a configuração da categoria atual, como o protótipo
    setCategorias((atual) => [...atual, categoriaPadrao('', atual[aba])]);
    setAba(categorias.length);
  }

  async function criar() {
    setErro(null);
    setEnviando(true);
    try {
      await api.criarCompeticao({
        nome, pais, estado, cidade, dataInicio, logoUrl,
        dataFim: dataFim || null,
        regulamento: regulamento || null,
        cor, possuiCategorias, categorias,
      });
      aoCriar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao criar o campeonato.');
      setEnviando(false);
    }
  }

  const atual = categorias[aba] ?? categorias[0];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="flex items-center gap-4 mb-5">
        <div className="flex-1">
          <h1 className="text-xl font-bold">Criar campeonato</h1>
          <p className="text-sm text-slate-500">
            Configure sua nova competição em 3 etapas
          </p>
        </div>
        <Botao variante="neutro" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </header>

      <ol className="flex gap-2 mb-5">
        {['Dados do campeonato', 'Categorias', 'Revisão e criação'].map((r, i) => {
          const n = i + 1;
          const estadoEtapa =
            etapa === n ? 'bg-marca text-white border-marca'
            : etapa > n ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-white text-slate-500 border-slate-200';
          return (
            <li
              key={r}
              className={`flex-1 flex items-center gap-2 border rounded-xl px-3 py-2 text-sm ${estadoEtapa}`}
            >
              <span className="w-6 h-6 grid place-items-center rounded-full bg-white/25 text-xs font-bold">
                {etapa > n ? '✓' : n}
              </span>
              <span className="hidden sm:inline">{r}</span>
            </li>
          );
        })}
      </ol>

      {erro && (
        <div className="mb-4">
          <Alerta tom="erro">{erro}</Alerta>
        </div>
      )}

      {etapa === 1 && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-5">
          <Cartao titulo="Dados do campeonato" sub="RF003 — Cadastro de competição">
            <div className="p-5">
              <Campo rotulo="Nome do campeonato" obrigatorio>
                <input
                  className={classeEntrada}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex.: Copa Premium 2027"
                />
              </Campo>

              <Campo
                rotulo="Logo do campeonato"
                dica="PNG, JPEG ou WebP. Aparece ao lado do nome em todas as telas e no portal."
              >
                <EnvioDeImagem
                  valor={logoUrl}
                  aoMudar={setLogoUrl}
                  rotulo="Logo do campeonato"
                />
              </Campo>

              <div className="grid grid-cols-3 gap-3">
                <Campo rotulo="País">
                  <select className={classeEntrada} value={pais} onChange={(e) => setPais(e.target.value)}>
                    {PAISES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Estado" obrigatorio>
                  <select
                    className={classeEntrada}
                    value={estado}
                    onChange={(e) => {
                      setEstado(e.target.value);
                      // a cidade escolhida era de outra UF: some junto
                      setCidade('');
                    }}
                  >
                    <option value="">Selecione…</option>
                    {estados.map((u) => (
                      <option key={u.sigla} value={u.sigla}>
                        {u.sigla} — {u.nome}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo rotulo="Cidade" obrigatorio>
                  <SeletorDeCidade uf={estado} valor={cidade} aoMudar={setCidade} />
                </Campo>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Data de início" obrigatorio>
                  <input type="date" className={classeEntrada} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                </Campo>
                <Campo rotulo="Data de término">
                  <input type="date" className={classeEntrada} value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                </Campo>
              </div>

              <Campo
                rotulo="Cor predominante"
                obrigatorio
                dica="Aplicada ao portal público desta competição (RF002 — White Label)."
              >
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="color"
                    value={cor}
                    onChange={(e) => setCor(e.target.value.toUpperCase())}
                    className="w-12 h-9 rounded-lg border border-slate-300 cursor-pointer bg-white"
                    aria-label="Seletor de cor"
                  />
                  <input
                    className={`${classeEntrada} max-w-32 font-mono`}
                    value={cor}
                    onChange={(e) => setCor(e.target.value.toUpperCase())}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {CORES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCor(c)}
                      aria-label={`Cor ${c}`}
                      className={`w-7 h-7 rounded-lg border-2 ${cor === c ? 'border-slate-900' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </Campo>

              <Campo rotulo="Regulamento">
                <textarea
                  className={`${classeEntrada} min-h-24`}
                  value={regulamento}
                  onChange={(e) => setRegulamento(e.target.value)}
                  placeholder="Cole aqui o regulamento da competição…"
                />
              </Campo>

              <Campo
                rotulo="Possui categorias?"
                dica='Se "Não", será criada uma categoria única com o nome do campeonato.'
              >
                <div className="flex gap-2">
                  <Botao
                    type="button"
                    variante={possuiCategorias ? 'neutro' : 'primario'}
                    onClick={() => setPossuiCategorias(false)}
                  >
                    NÃO
                  </Botao>
                  <Botao
                    type="button"
                    variante={possuiCategorias ? 'primario' : 'neutro'}
                    onClick={() => setPossuiCategorias(true)}
                  >
                    SIM
                  </Botao>
                </div>
              </Campo>
            </div>
            <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <Botao onClick={avancarDaEtapa1}>Continuar →</Botao>
            </footer>
          </Cartao>

          <div className="space-y-4">
            <Cartao titulo="Pré-visualização">
              <div className="p-5">
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div
                    className="h-20 flex items-end p-3"
                    style={{ background: `linear-gradient(120deg, ${cor}, ${cor}cc)` }}
                  >
                    <span className="bg-white rounded-lg w-11 h-11 grid place-items-center font-bold shadow">
                      {iniciais(nome || '?')}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="font-semibold text-sm">{nome || 'Nome do campeonato'}</p>
                    <p className="text-xs text-slate-500">
                      {cidade || 'Cidade'}{estado && ` · ${estado}`}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <Alerta>
                    Toda competição nasce em <b>Em criação</b> — ambiente privado,
                    invisível ao público (RF025).
                  </Alerta>
                </div>
              </div>
            </Cartao>
          </div>
        </div>
      )}

      {etapa === 2 && (
        <Cartao>
          <div className="flex gap-1 px-3 pt-3 overflow-x-auto border-b border-slate-200">
            {categorias.map((c, i) => (
              <button
                key={i}
                onClick={() => setAba(i)}
                className={`px-4 py-2 text-sm rounded-t-lg whitespace-nowrap ${
                  aba === i ? 'bg-white border border-b-white border-slate-200 font-medium -mb-px' : 'text-slate-500'
                }`}
              >
                {c.nome || `Categoria ${i + 1}`}
              </button>
            ))}
          </div>

          <div className="p-5">
            <div className="mb-4">
              <Alerta tom="aviso">
                Você pode alterar essas informações depois de criar o campeonato,
                inclusive criar novas categorias.
              </Alerta>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Campo rotulo="Qual o nome da categoria?" obrigatorio>
                <input
                  className={classeEntrada}
                  value={atual.nome}
                  onChange={(e) => alterarCategoria(aba, { nome: e.target.value })}
                  placeholder="Ex.: Sub-9"
                />
              </Campo>
              <Campo rotulo="Qual categoria?">
                <select
                  className={classeEntrada}
                  value={atual.tipo}
                  onChange={(e) => alterarCategoria(aba, { tipo: e.target.value })}
                >
                  {TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Gênero">
                <select
                  className={classeEntrada}
                  value={atual.genero}
                  onChange={(e) => alterarCategoria(aba, { genero: e.target.value })}
                >
                  {GENEROS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Modalidade">
                <select
                  className={classeEntrada}
                  value={atual.modalidade}
                  onChange={(e) => alterarCategoria(aba, { modalidade: e.target.value })}
                >
                  {MODALIDADES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </Campo>
            </div>

            <Campo
              rotulo="Formato"
              dica={
                atual.formato === 'grupos_mata'
                  ? 'Cria múltiplos grupos + fase eliminatória.'
                  : 'Cria grupo único (todos contra todos) + fase eliminatória.'
              }
            >
              <select
                className={classeEntrada}
                value={atual.formato}
                onChange={(e) => alterarCategoria(aba, { formato: e.target.value })}
              >
                {FORMATOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
            </Campo>

            <div className="grid sm:grid-cols-3 gap-3">
              <Campo rotulo="Nº de times">
                <input
                  type="number" min={2} max={128}
                  className={classeEntrada}
                  value={atual.numTimes}
                  onChange={(e) => alterarCategoria(aba, { numTimes: +e.target.value })}
                />
              </Campo>
              <Campo
                rotulo="Nº de grupos"
                dica={
                  atual.formato === 'pontos_mata'
                    ? 'Grupo único (fixo)'
                    : `Times por grupo: ~${Math.ceil(atual.numTimes / Math.max(1, atual.numGrupos))}`
                }
              >
                <input
                  type="number" min={1} max={16}
                  className={classeEntrada}
                  value={atual.numGrupos}
                  disabled={atual.formato === 'pontos_mata'}
                  onChange={(e) => alterarCategoria(aba, { numGrupos: +e.target.value })}
                />
              </Campo>
              <Campo
                rotulo="Fase inicial do mata-mata"
                dica={`Classificam-se ${FASES.find((f) => f[0] === atual.faseMataMata)?.[2] ?? 4} times.`}
              >
                <select
                  className={classeEntrada}
                  value={atual.faseMataMata}
                  onChange={(e) => alterarCategoria(aba, { faseMataMata: e.target.value })}
                >
                  {FASES.map(([v, r, n]) => (
                    <option key={v} value={v}>{r} ({n} times)</option>
                  ))}
                </select>
              </Campo>
            </div>

            <label className="flex items-center gap-3 border-t border-slate-200 pt-4">
              <input
                type="checkbox"
                checked={atual.turnoReturno}
                onChange={(e) => alterarCategoria(aba, { turnoReturno: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm">
                Turno e returno na fase de grupos
                <span className="block text-xs text-slate-500">
                  Cada confronto ocorre duas vezes (ida e volta)
                </span>
              </span>
            </label>
          </div>

          <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap gap-2 justify-between">
            <Botao variante="neutro" onClick={() => setEtapa(1)}>← Voltar</Botao>
            <div className="flex flex-wrap gap-2">
              {categorias.length > 1 && (
                <Botao
                  variante="perigo"
                  onClick={() => {
                    setCategorias((a) => a.filter((_, i) => i !== aba));
                    setAba((a) => Math.max(0, a - 1));
                  }}
                >
                  Remover esta categoria
                </Botao>
              )}
              <Botao variante="neutro" onClick={adicionarCategoria}>
                ＋ Adicionar mais categorias
              </Botao>
              <Botao onClick={() => setEtapa(3)}>Finalizar categorias →</Botao>
            </div>
          </footer>
        </Cartao>
      )}

      {etapa === 3 && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-5">
          <Cartao titulo="Revisão" sub="Confira antes de criar a competição">
            <div className="p-5">
              <dl className="text-sm divide-y divide-slate-100">
                <Linha termo="Nome" valor={<b>{nome}</b>} />
                <Linha termo="Local" valor={`${cidade} / ${estado} — ${pais}`} />
                <Linha termo="Período" valor={`${dataInicio || '—'} → ${dataFim || '—'}`} />
                <Linha
                  termo="Cor"
                  valor={
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 rounded" style={{ background: cor }} />
                      <code>{cor}</code>
                    </span>
                  }
                />
                <Linha termo="Status inicial" valor="Em criação" />
              </dl>

              <h3 className="text-sm font-semibold mt-5 mb-2">
                Categorias ({categorias.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase text-slate-500 border-b border-slate-200">
                      <th className="text-left py-2">Nome</th>
                      <th>Modalidade</th>
                      <th>Formato</th>
                      <th>Times</th>
                      <th>Grupos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categorias.map((c, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-2 font-medium">{c.nome || '—'}</td>
                        <td className="text-center">
                          {MODALIDADES.find((m) => m[0] === c.modalidade)?.[1]}
                        </td>
                        <td className="text-center">
                          {FORMATOS.find((f) => f[0] === c.formato)?.[1]}
                        </td>
                        <td className="text-center">{c.numTimes}</td>
                        <td className="text-center">{c.numGrupos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-between">
              <Botao
                variante="neutro"
                onClick={() => setEtapa(possuiCategorias ? 2 : 1)}
              >
                ← Voltar
              </Botao>
              <Botao onClick={criar} disabled={enviando}>
                {enviando ? 'Criando…' : '✓ CRIAR CAMPEONATO'}
              </Botao>
            </footer>
          </Cartao>

          <Cartao titulo="Próximo passo">
            <div className="p-5 space-y-3">
              <Alerta>
                Cada categoria já nasce com a configuração padrão: pontuação
                3/1/0, colunas da classificação, critérios de desempate e súmula.
              </Alerta>
              <p className="text-xs text-slate-500">
                Depois de criada, a competição fica <b>Em criação</b> até você
                publicá-la.
              </p>
            </div>
          </Cartao>
        </div>
      )}
    </div>
  );
}

function Linha({ termo, valor }: { termo: string; valor: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2">
      <dt className="w-32 shrink-0 text-slate-500">{termo}</dt>
      <dd>{valor}</dd>
    </div>
  );
}
