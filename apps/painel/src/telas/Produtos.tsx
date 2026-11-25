import { useCallback, useEffect, useState } from 'react';
import { Alerta, Botao, Campo, Cartao, classeEntrada } from '../componentes/ui';
import { EnvioDeImagem } from '../componentes/EnvioDeImagem';
import { api, type ProdutoDoCatalogo } from '../lib/api';
import { centavosDeTexto, moeda, textoDeCentavos } from '../lib/dominio';
import { podeEscrever } from '../lib/permissoes';

/**
 * O cardápio da conta (RF035 — ficha de consumo).
 *
 * ── POR QUE É DA CONTA, E NÃO DO EVENTO ──────────────────────────────
 * A mesma cerveja aparece no festival de julho e na final de novembro.
 * Amarrar o produto ao evento obrigaria a redigitar o cardápio inteiro
 * a cada edição — e a errar o preço numa delas.
 *
 * ── O GRUPO É DIGITADO, MAS NÃO DO ZERO ──────────────────────────────
 * "Bebida", "Comida", "Brinde": a taxonomia é de cada organizador e não
 * dá para prever numa lista fechada. O campo oferece os grupos que a
 * conta já usa, que é o que evita "Bebidas" e "bebida" convivendo — e o
 * banco recusa o mesmo produto duas vezes no mesmo grupo.
 */

const vazio = {
  id: undefined as string | undefined,
  grupo: '',
  nome: '',
  preco: '0,00',
  ativo: true,
  imagemUrl: null as string | null,
};

type Formulario = typeof vazio;

export function Produtos() {
  const [itens, setItens] = useState<ProdutoDoCatalogo[] | null>(null);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [form, setForm] = useState<Formulario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState('');

  const podeMexer = podeEscrever('evento');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [lista, gs] = await Promise.all([
        api.produtos.listar(),
        api.produtos.grupos(),
      ]);
      setItens(lista);
      setGrupos(gs);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o cardápio.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function agir(acao: () => Promise<unknown>, sucesso?: string) {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      await acao();
      await carregar();
      if (sucesso) setAviso(sucesso);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  function salvar() {
    if (!form) return;
    const centavos = centavosDeTexto(form.preco);
    if (centavos === null) {
      setErro('Preço inválido. Use o formato 8,00.');
      return;
    }

    void agir(async () => {
      await api.produtos.salvar({
        id: form.id,
        grupo: form.grupo,
        nome: form.nome,
        precoCentavos: centavos,
        ativo: form.ativo,
        imagemUrl: form.imagemUrl,
      });
      setForm(null);
    }, 'Produto salvo.');
  }

  const termo = busca.trim().toLowerCase();
  const visiveis = (itens ?? []).filter(
    (p) =>
      !termo ||
      p.nome.toLowerCase().includes(termo) ||
      p.grupo.toLowerCase().includes(termo),
  );

  // agrupado para a tela parecer um cardápio, que é o que ela é
  const porGrupo = new Map<string, ProdutoDoCatalogo[]>();
  for (const p of visiveis) {
    const lista = porGrupo.get(p.grupo) ?? [];
    lista.push(p);
    porGrupo.set(p.grupo, lista);
  }

  return (
    <div className="max-w-4xl mx-auto p-5 space-y-4">
      <header className="flex items-start gap-3 flex-wrap">
        <div className="flex-1">
          <h1 className="text-xl font-bold">🍺 Produtos</h1>
          <p className="text-sm text-slate-500">
            O que você vende no balcão do evento. Cadastre uma vez e use em
            todos.
          </p>
        </div>
        {podeMexer && !form && (
          <Botao onClick={() => setForm({ ...vazio })}>+ Novo produto</Botao>
        )}
      </header>

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {aviso && <Alerta tom="info">{aviso}</Alerta>}

      {form && (
        <Cartao titulo={form.id ? 'Editar produto' : 'Novo produto'}>
          <div className="p-5">
            <div className="grid sm:grid-cols-[1fr_2fr] gap-3">
              <Campo
                rotulo="Grupo"
                obrigatorio
                dica="Ex.: Bebida, Comida, Brinde."
              >
                <input
                  className={classeEntrada}
                  value={form.grupo}
                  list="grupos-de-produto"
                  onChange={(e) => setForm({ ...form, grupo: e.target.value })}
                  placeholder="Bebida"
                />
                {/* sugere o que a conta já usa: é o que evita "Bebidas"
                    e "bebida" convivendo no mesmo cardápio */}
                <datalist id="grupos-de-produto">
                  {grupos.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Campo>

              <Campo rotulo="Descrição do produto" obrigatorio>
                <input
                  className={classeEntrada}
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Cerveja long neck 355 ml"
                />
              </Campo>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Campo rotulo="Preço de venda" obrigatorio>
                <input
                  className={classeEntrada}
                  value={form.preco}
                  onChange={(e) => setForm({ ...form, preco: e.target.value })}
                  inputMode="decimal"
                  placeholder="8,00"
                />
              </Campo>
              <div className="pt-7">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.ativo}
                    onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                  />
                  Ativo — aparece para venda
                </label>
              </div>
            </div>

            {/* O `rotulo` do EnvioDeImagem vira só o `alt` da prévia — não
                aparece na tela. O rótulo visível é este, em `span` e não
                em `label`: envolver o botão de arquivo num `label` faz o
                clique em "remover" abrir o seletor de arquivos. */}
            <span className="block text-sm font-medium mb-1.5">Foto do item</span>
            <EnvioDeImagem
              rotulo="Foto do produto"
              valor={form.imagemUrl}
              aoMudar={(caminho) => setForm({ ...form, imagemUrl: caminho })}
            />

            <div className="flex gap-2 mt-4">
              <Botao
                onClick={salvar}
                disabled={ocupado || !form.grupo.trim() || !form.nome.trim()}
              >
                Salvar produto
              </Botao>
              <Botao variante="neutro" onClick={() => setForm(null)}>
                Cancelar
              </Botao>
            </div>
          </div>
        </Cartao>
      )}

      {itens !== null && itens.length > 0 && (
        <input
          className={classeEntrada}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar por produto ou grupo"
        />
      )}

      {itens === null && (
        <p className="text-sm text-slate-500 py-8 text-center">Carregando…</p>
      )}

      {itens?.length === 0 && !form && (
        <Cartao>
          <div className="p-10 text-center">
            <p className="text-4xl mb-3">🍺</p>
            <p className="font-medium">Cardápio vazio.</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Cadastre o que você vende no evento — cerveja, espetinho,
              refrigerante. Depois é só colocar à venda e o cliente retira no
              balcão lendo o QR da ficha.
            </p>
          </div>
        </Cartao>
      )}

      {[...porGrupo.entries()].map(([grupo, lista]) => (
        <Cartao key={grupo} titulo={grupo} sub={`${lista.length} item(ns)`}>
          <div className="divide-y divide-slate-100">
            {lista.map((p) => (
              <div key={p.id} className="px-5 py-3 flex items-center gap-3">
                {p.imagemUrl ? (
                  <img
                    src={p.imagemUrl}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-slate-100 grid place-items-center text-xl">
                    🍽
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${p.ativo ? '' : 'text-slate-400'}`}>
                    {p.nome}
                    {!p.ativo && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        (inativo)
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-slate-500">
                    {moeda(p.precoCentavos)}
                  </p>
                </div>

                {podeMexer && (
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setForm({
                          id: p.id,
                          grupo: p.grupo,
                          nome: p.nome,
                          preco: textoDeCentavos(p.precoCentavos),
                          ativo: p.ativo,
                          imagemUrl: p.imagemUrl,
                        })
                      }
                      className="text-sm text-slate-500 hover:text-marca"
                    >
                      editar
                    </button>
                    <button
                      disabled={ocupado}
                      onClick={() => {
                        if (!confirm(`Excluir "${p.nome}" do cardápio?`)) return;
                        void agir(() => api.produtos.remover(p.id));
                      }}
                      className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-40"
                      title="Excluir"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Cartao>
      ))}

      {!podeMexer && (
        <Alerta tom="info">
          Seu perfil vê o cardápio, mas quem cadastra produto e mexe em preço
          é o responsável pela conta ou um gestor.
        </Alerta>
      )}
    </div>
  );
}
