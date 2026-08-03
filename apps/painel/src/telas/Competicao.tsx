import { useState } from 'react';
import { EnvioDeImagem } from '../componentes/EnvioDeImagem';
import { MenuLateral, type SecaoDoMenu } from '../componentes/MenuLateral';
import { Alerta, Botao, Cartao, Selo, classeEntrada } from '../componentes/ui';
import { api, type CompeticaoDoPainel, type JogoDaTabela } from '../lib/api';
import { STATUS, formataData } from '../lib/dominio';
import { Atletas } from './Atletas';
import { Configuracao } from './Configuracao';
import { Estatisticas } from './Estatisticas';
import { Estrutura } from './Estrutura';
import { Classificacao } from './Classificacao';
import { Suspensoes } from './Suspensoes';
import { Equipes } from './Equipes';
import { Sumula } from './Sumula';
import { Tabela } from './Tabela';

type Aba =
  | 'visao'
  | 'equipes'
  | 'atletas'
  | 'tabela'
  | 'classificacao'
  | 'estatisticas'
  | 'suspensoes'
  | 'estrutura'
  | 'config';

/**
 * Seções do menu lateral, iguais às do protótipo (`NAV_COMP`, linha 797).
 *
 * O agrupamento é o que a fila de abas não dava: cadastro, operação e
 * estrutura são três momentos diferentes do trabalho, e misturá-los em
 * nove itens iguais obrigava a ler todos para achar um.
 */
const SECOES: SecaoDoMenu[] = [
  {
    titulo: 'Competição',
    itens: [
      { chave: 'visao', icone: '◎', rotulo: 'Visão geral' },
      { chave: 'equipes', icone: '🛡', rotulo: 'Equipes' },
      { chave: 'atletas', icone: '🎽', rotulo: 'Atletas' },
    ],
  },
  {
    titulo: 'Operação',
    itens: [
      { chave: 'tabela', icone: '📅', rotulo: 'Tabela de jogos' },
      { chave: 'classificacao', icone: '📈', rotulo: 'Classificação' },
      { chave: 'estatisticas', icone: '🥇', rotulo: 'Estatísticas' },
      { chave: 'suspensoes', icone: '🚫', rotulo: 'Suspensões' },
    ],
  },
  {
    titulo: 'Estrutura',
    itens: [
      { chave: 'estrutura', icone: '📍', rotulo: 'Campos e árbitros' },
      { chave: 'config', icone: '⚙️', rotulo: 'Configurações' },
    ],
  },
];

const PORTAL = import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:3001';

export function Competicao({
  competicao,
  aoVoltar,
  aoMudar,
}: {
  competicao: CompeticaoDoPainel;
  aoVoltar: () => void;
  aoMudar: () => void;
}) {
  const [status, setStatus] = useState(competicao.status);
  const [escolhido, setEscolhido] = useState(competicao.status);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('visao');
  const [operando, setOperando] = useState<{
    jogo: JogoDaTabela;
    categoriaId: string;
  } | null>(null);
  const [dominio, setDominio] = useState(competicao.dominioPersonalizado ?? '');
  const [salvandoDominio, setSalvandoDominio] = useState(false);
  const [dominioSalvo, setDominioSalvo] = useState(false);
  const [erroDominio, setErroDominio] = useState<string | null>(null);
  const [erroLogo, setErroLogo] = useState<string | null>(null);

  const publico = status !== 'em_criacao';

  async function salvarStatus() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await api.mudarStatus(competicao.id, escolhido);
      setStatus(r.status);
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao alterar o status.');
    } finally {
      setSalvando(false);
    }
  }

  async function salvarDominio() {
    setErroDominio(null);
    setDominioSalvo(false);
    setSalvandoDominio(true);
    try {
      const r = await api.definirDominio(competicao.id, dominio.trim() || null);
      // a API normaliza (tira porta, www. e maiúsculas): mostrar o que foi
      // de fato gravado evita o organizador achar que salvou outra coisa
      setDominio(r.dominioPersonalizado ?? '');
      setDominioSalvo(true);
      aoMudar();
    } catch (e) {
      setErroDominio(
        e instanceof Error ? e.message : 'Falha ao salvar o domínio.',
      );
    } finally {
      setSalvandoDominio(false);
    }
  }

  async function salvarLogo(caminho: string | null) {
    setErroLogo(null);
    try {
      await api.definirImagens(competicao.id, { logoUrl: caminho });
      aoMudar();
    } catch (e) {
      setErroLogo(e instanceof Error ? e.message : 'Falha ao salvar o logo.');
    }
  }

  // a súmula ocupa a tela inteira — o operador precisa de foco
  if (operando) {
    return (
      <Sumula
        jogo={operando.jogo}
        categoriaId={operando.categoriaId}
        aoVoltar={() => setOperando(null)}
      />
    );
  }

  return (
    <div className="flex flex-col lg:flex-row">
      <MenuLateral
        secoes={SECOES}
        atual={aba}
        aoEscolher={(chave) => setAba(chave as Aba)}
        topo={
          <>
            <button
              onClick={aoVoltar}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              ← Meus campeonatos
            </button>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-2">
              Competição ativa
            </p>
            <p className="font-bold leading-tight">{competicao.nome}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {competicao.cidade} / {competicao.estado}
            </p>
          </>
        }
      />

      <main className="flex-1 min-w-0 p-5 lg:p-6 max-w-6xl">
        <header className="flex flex-wrap items-end gap-3 mb-5">
          <div className="flex-1 min-w-60">
            <h1 className="text-xl font-bold">
              {SECOES.flatMap((s) => s.itens).find((i) => i.chave === aba)
                ?.rotulo ?? competicao.nome}
            </h1>
            <p className="text-sm text-slate-500">
              {formataData(competicao.dataInicio)} →{' '}
              {formataData(competicao.dataFim)}
            </p>
          </div>
          {publico ? (
            <a
              href={`${PORTAL}/${competicao.slug}`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 hover:bg-slate-50"
            >
              🌐 Ver portal
            </a>
          ) : (
            <span className="text-xs text-slate-500 max-w-56">
              O portal só abre depois de publicar.
            </span>
          )}
        </header>

        {/* os números ficam só na visão geral: repeti-los em toda tela
            empurraria o conteúdo real para baixo da dobra */}
        {aba === 'visao' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <Numero rotulo="Categorias" valor={competicao.categorias.length} />
            <Numero rotulo="Equipes" valor={competicao.totais.equipes} />
            <Numero rotulo="Atletas" valor={competicao.totais.atletas} />
            <Numero rotulo="Jogos" valor={competicao.totais.jogos} />
          </div>
        )}

        {aba === 'equipes' && <Equipes competicao={competicao} />}
        {aba === 'atletas' && <Atletas competicao={competicao} />}
        {aba === 'estrutura' && <Estrutura competicao={competicao} />}
        {aba === 'estatisticas' && <Estatisticas competicao={competicao} />}
        {aba === 'classificacao' && <Classificacao competicao={competicao} />}
        {aba === 'suspensoes' && <Suspensoes competicao={competicao} />}
        {aba === 'config' && <Configuracao competicao={competicao} />}
        {aba === 'tabela' && (
          <Tabela
            competicao={competicao}
            aoOperar={(jogo, categoriaId) => setOperando({ jogo, categoriaId })}
          />
        )}

        <div
          className="grid lg:grid-cols-[1fr_340px] gap-5"
          hidden={aba !== 'visao'}
        >
          <Cartao
            titulo="Categorias"
            sub="Cada categoria tem sua própria tabela, classificação e configuração"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <th className="text-left px-5 py-2">Categoria</th>
                  <th className="px-5 py-2">Endereço público</th>
                </tr>
              </thead>
              <tbody>
                {competicao.categorias.map((k) => (
                  <tr
                    key={k.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-5 py-3 font-medium">{k.nome}</td>
                    <td className="px-5 py-3 text-center">
                      {publico ? (
                        <a
                          className="text-marca hover:underline"
                          href={`${PORTAL}/${competicao.slug}/${k.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          abrir ↗
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Cartao>

          <Cartao titulo="Status" sub="RF025 — publicação controlada">
            <div className="p-5">
              <div className="mb-3">
                <Selo status={status} />
              </div>

              {erro && (
                <div className="mb-3">
                  <Alerta tom="erro">{erro}</Alerta>
                </div>
              )}

              <div className="space-y-2">
                {Object.entries(STATUS).map(([chave, s]) => (
                  <label
                    key={chave}
                    className={`flex gap-3 items-start p-3 border rounded-xl cursor-pointer ${
                      escolhido === chave
                        ? 'border-marca bg-green-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="status"
                      className="mt-1"
                      checked={escolhido === chave}
                      onChange={() => setEscolhido(chave)}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {s.rotulo}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {s.descricao}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              <Botao
                onClick={salvarStatus}
                disabled={salvando || escolhido === status}
                className="w-full mt-4"
              >
                {salvando ? 'Salvando…' : 'Salvar status'}
              </Botao>
            </div>
          </Cartao>

          <Cartao titulo="Logo" sub="Aparece no portal e na súmula">
            <div className="p-5">
              {erroLogo && (
                <div className="mb-3">
                  <Alerta tom="erro">{erroLogo}</Alerta>
                </div>
              )}
              {/* grava na hora: um botão "salvar" a mais para um campo só
                seria cerimônia sem ganho */}
              <EnvioDeImagem
                valor={competicao.logoUrl}
                aoMudar={(c) => void salvarLogo(c)}
                rotulo="Logo da competição"
              />
            </div>
          </Cartao>

          <Cartao titulo="Domínio próprio" sub="RF002 — white-label por CNAME">
            <div className="p-5">
              <p className="text-xs text-slate-500 mb-3">
                Aponte um <b>CNAME</b> do seu domínio para o portal e a
                competição passa a responder no endereço da sua federação, sem{' '}
                <code>/{competicao.slug}</code> na URL.
              </p>

              {erroDominio && (
                <div className="mb-3">
                  <Alerta tom="erro">{erroDominio}</Alerta>
                </div>
              )}
              {dominioSalvo && (
                <div className="mb-3">
                  <Alerta tom="info">
                    {dominio
                      ? `Portal respondendo em ${dominio}.`
                      : 'Domínio removido — vale só o endereço da plataforma.'}
                  </Alerta>
                </div>
              )}

              <input
                className={classeEntrada}
                value={dominio}
                onChange={(e) => {
                  setDominio(e.target.value);
                  setDominioSalvo(false);
                }}
                placeholder="copa.suafederacao.com.br"
                autoComplete="off"
                spellCheck={false}
              />

              <Botao
                onClick={salvarDominio}
                disabled={salvandoDominio}
                variante="neutro"
                className="w-full mt-3"
              >
                {salvandoDominio ? 'Salvando…' : 'Salvar domínio'}
              </Botao>

              {/* o domínio só resolve depois de publicar: a API aplica ao CNAME
                a mesma regra de visibilidade do slug */}
              {status === 'em_criacao' && dominio && (
                <p className="text-xs text-amber-700 mt-3">
                  Enquanto a competição estiver <b>em criação</b>, o domínio não
                  abre o portal.
                </p>
              )}
            </div>
          </Cartao>
        </div>
      </main>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className="text-3xl font-bold mt-1">{valor}</p>
    </div>
  );
}
