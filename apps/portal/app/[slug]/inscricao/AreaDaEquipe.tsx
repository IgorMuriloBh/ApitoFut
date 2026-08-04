'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brasao } from './Brasao';
import FormularioDeAtleta from './FormularioDeAtleta';
import { type Chamar, criarCliente, enviarImagem } from './cliente';
import type {
  AtletaDoElenco,
  CategoriaAberta,
  CategoriaDaEquipe,
  Convite,
  Painel,
} from './tipos';

/**
 * Área da equipe. Client component inteiro: é formulário, não conteúdo —
 * não há SEO a ganhar, e a página é `noindex`.
 *
 * O código de acesso fica em `sessionStorage`, não em `localStorage`: a
 * inscrição costuma ser feita de máquina compartilhada (secretaria do
 * clube, lan house), e o código dá acesso ao elenco inteiro da equipe.
 *
 * A NAVEGAÇÃO É POR ABA, uma por categoria, mais a dos dados cadastrais.
 * Cada categoria tem a sua configuração — elenco, limite, ficha do atleta,
 * comissão técnica —, e a tela antiga empilhava tudo numa página só: o
 * responsável rolava a página tentando adivinhar qual formulário era de
 * qual categoria.
 */

const CHAVE = 'apitofut.equipe';

/** Mesma cor inicial do protótipo. O campo é obrigatório, mas
    `<input type="color">` nunca fica vazio — o padrão é o ponto de
    partida, não um valor que passa despercebido. */
const UNIFORME_PADRAO = '#2563EB';

export default function AreaDaEquipe({
  slug,
  inicial,
}: {
  slug: string;
  inicial: Convite;
}) {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [tela, setTela] = useState<'inicio' | 'nova'>('inicio');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [codigoNovo, setCodigoNovo] = useState<string | null>(null);

  const chamar = useMemo(() => criarCliente(slug), [slug]);

  const carregarPainel = useCallback(
    async (cod: string) => {
      const p = (await chamar('/equipe', { codigo: cod })) as unknown as Painel;
      setPainel(p);
      setCodigo(cod);
      sessionStorage.setItem(CHAVE, JSON.stringify({ slug, codigo: cod }));
    },
    [chamar, slug],
  );

  // volta à sessão anterior sem pedir o código de novo
  useEffect(() => {
    const cru = sessionStorage.getItem(CHAVE);
    if (!cru) return;
    try {
      const s = JSON.parse(cru) as { slug: string; codigo: string };
      if (s.slug === slug) {
        void carregarPainel(s.codigo).catch(() => {
          sessionStorage.removeItem(CHAVE);
        });
      }
    } catch {
      sessionStorage.removeItem(CHAVE);
    }
  }, [slug, carregarPainel]);

  async function agir(acao: () => Promise<unknown>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      if (codigo) await carregarPainel(codigo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  const c = inicial.competicao;

  return (
    <main style={{ ['--cor' as string]: c.corPrimaria }}>
      <header className="faixa">
        <div className="miolo" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {c.logoUrl && (
            <img
              src={c.logoUrl}
              alt=""
              style={{
                width: 56,
                height: 56,
                objectFit: 'contain',
                background: '#fff',
                borderRadius: 12,
                padding: 4,
              }}
            />
          )}
          <div>
            <span className="pill">Inscrição de equipes</span>
            <h1 style={{ fontSize: 24, marginTop: 6 }}>{c.nome}</h1>
            <p style={{ opacity: 0.85, fontSize: 14 }}>
              {c.cidade} / {c.estado}
            </p>
          </div>
        </div>
      </header>

      <div className="miolo" style={{ paddingBottom: 40 }}>
        {erro && <p className="aviso">⚠️ {erro}</p>}

        {!inicial.inscricoesAbertas && !painel && (
          <div className="cartao">
            <h2>🔒 Inscrições encerradas</h2>
            <p style={{ padding: '12px 16px', fontSize: 14, color: 'var(--tinta2)' }}>
              {c.status === 'encerrada'
                ? 'Esta competição já foi encerrada.'
                : 'O organizador não está recebendo inscrições de novas equipes neste momento. Entre em contato com a organização.'}
            </p>
          </div>
        )}

        {/* código recém-gerado: aparece uma vez só */}
        {codigoNovo && (
          <div className="cartao" style={{ borderColor: 'var(--cor)' }}>
            <h2>🎉 Inscrição realizada</h2>
            <div style={{ padding: 16 }}>
              <p style={{ fontSize: 14 }}>
                Guarde o código abaixo. É com ele que você volta para cadastrar
                atletas e comissão técnica.
              </p>
              <p
                style={{
                  fontFamily: 'monospace',
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: 5,
                  textAlign: 'center',
                  padding: 16,
                  margin: '12px 0',
                  background: '#F1F5F9',
                  borderRadius: 12,
                }}
              >
                {codigoNovo}
              </p>
              <p className="aviso">
                ⚠️ Anote este código. Sem ele será preciso pedir ao organizador
                para recuperá-lo.
              </p>
              <button onClick={() => setCodigoNovo(null)}>Continuar</button>
            </div>
          </div>
        )}

        {painel ? (
          <PainelDaEquipe
            slug={slug}
            painel={painel}
            ocupado={ocupado}
            aoAgir={agir}
            chamar={chamar}
            codigo={codigo!}
            aoRecarregar={() => carregarPainel(codigo!)}
            aoSair={() => {
              sessionStorage.removeItem(CHAVE);
              setPainel(null);
              setCodigo(null);
            }}
          />
        ) : (
          inicial.inscricoesAbertas &&
          !codigoNovo &&
          (tela === 'inicio' ? (
            <Inicio
              categorias={inicial.categorias}
              ocupado={ocupado}
              aoComecar={() => setTela('nova')}
              aoEntrar={(cod) => agir(() => carregarPainel(cod.toUpperCase()))}
            />
          ) : (
            <FormularioDeEquipe
              categorias={inicial.categorias}
              cidadePadrao={c.cidade}
              estadoPadrao={c.estado}
              ocupado={ocupado}
              aoVoltar={() => setTela('inicio')}
              aoEnviar={(dados, escudo) =>
                agir(async () => {
                  const r = (await chamar('/equipes', {
                    metodo: 'POST',
                    corpo: dados,
                  })) as unknown as { codigoAcesso: string };

                  // o escudo vem depois, e de propósito: o upload é
                  // autenticado pelo código de acesso, que só existe
                  // agora. Se falhar, a equipe já está inscrita e o
                  // código aparece — o escudo entra pela aba de dados.
                  if (escudo) {
                    try {
                      const url = await enviarImagem(slug, r.codigoAcesso, escudo);
                      await chamar('/equipe', {
                        metodo: 'PATCH',
                        codigo: r.codigoAcesso,
                        corpo: { escudoUrl: url },
                      });
                    } catch {
                      /* inscrição vale mais que o escudo: segue sem ele */
                    }
                  }

                  setCodigoNovo(r.codigoAcesso);
                  setTela('inicio');
                  await carregarPainel(r.codigoAcesso);
                })
              }
            />
          ))
        )}
      </div>

      <footer className="pub-foot" style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
        Inscrição gerenciada pela plataforma <b>ApitoFut</b>
      </footer>
    </main>
  );
}

function Inicio({
  categorias,
  ocupado,
  aoComecar,
  aoEntrar,
}: {
  categorias: CategoriaAberta[];
  ocupado: boolean;
  aoComecar: () => void;
  aoEntrar: (codigo: string) => void;
}) {
  const [cod, setCod] = useState('');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="cartao">
        <h2>➕ Inscrever nova equipe</h2>
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 14, color: 'var(--tinta2)', lineHeight: 1.6 }}>
            Cadastre os dados da equipe e escolha as categorias em que vai
            disputar. Ao final você recebe um <b>código de acesso</b> para voltar
            e cadastrar atletas e comissão técnica quando quiser.
          </p>
          <p style={{ fontSize: 13, marginTop: 10 }}>
            Categorias com inscrições abertas:{' '}
            {categorias.map((k) => (
              <span key={k.id} className="etiqueta" style={{ marginRight: 4 }}>
                {k.nome}
              </span>
            ))}
          </p>
          <button onClick={aoComecar} style={{ marginTop: 14 }}>
            Começar inscrição
          </button>
        </div>
      </div>

      <div className="cartao">
        <h2>🔑 Já tenho inscrição</h2>
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 14, color: 'var(--tinta2)' }}>
            Continuar o cadastro com o código de acesso.
          </p>
          <input
            value={cod}
            onChange={(e) => setCod(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="Ex.: 7KDM4P"
            style={{
              fontFamily: 'monospace',
              fontSize: 18,
              letterSpacing: 3,
              textAlign: 'center',
              margin: '10px 0',
            }}
          />
          <button disabled={ocupado || cod.length !== 6} onClick={() => aoEntrar(cod)}>
            Acessar minha equipe
          </button>
          <p style={{ fontSize: 12, color: 'var(--tinta2)', marginTop: 8 }}>
            O código foi exibido ao final da inscrição. Perdeu? Solicite ao
            organizador.
          </p>
        </div>
      </div>
    </div>
  );
}

function FormularioDeEquipe({
  categorias,
  cidadePadrao,
  estadoPadrao,
  ocupado,
  aoVoltar,
  aoEnviar,
}: {
  categorias: CategoriaAberta[];
  cidadePadrao: string;
  estadoPadrao: string;
  ocupado: boolean;
  aoVoltar: () => void;
  aoEnviar: (dados: Record<string, unknown>, escudo: File | null) => void;
}) {
  const [nome, setNome] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [contato, setContato] = useState('');
  const [email, setEmail] = useState('');
  const [cidade, setCidade] = useState(cidadePadrao);
  const [estado, setEstado] = useState(estadoPadrao);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  // o escudo só sobe DEPOIS de criada a equipe: o upload é autenticado
  // pelo código de acesso, que não existe antes disso. Aqui guarda-se o
  // arquivo; quem orquestra é `aoEnviar`.
  const [escudo, setEscudo] = useState<File | null>(null);
  // criado uma vez por arquivo, não a cada render: `createObjectURL` no
  // corpo do componente vaza uma URL por repintura
  const [previa, setPrevia] = useState<string | null>(null);
  const [uniforme1, setUniforme1] = useState(UNIFORME_PADRAO);
  const [uniforme2, setUniforme2] = useState<string | null>(null);

  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);

  const alternar = (id: string) =>
    setEscolhidas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );

  return (
    <div className="cartao">
      <h2>Dados da equipe</h2>
      <div style={{ padding: 16 }}>
        <label className="campo">
          <span>
            Nome da equipe <b className="req">*</b>
          </span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
          <Brasao nome={nome} url={previa} tamanho={58} />
          <label className="campo" style={{ flex: 1, margin: 0 }}>
            <span>Logo da equipe (escudo)</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const arquivo = e.target.files?.[0] ?? null;
                setEscudo(arquivo);
                if (previa) URL.revokeObjectURL(previa);
                setPrevia(arquivo ? URL.createObjectURL(arquivo) : null);
              }}
            />
            <span style={{ fontSize: 11.5, color: 'var(--tinta2)' }}>
              Sem escudo, a equipe aparece com as iniciais sobre uma cor.
            </span>
          </label>
        </div>

        <Uniformes
          primario={uniforme1}
          secundario={uniforme2}
          aoMudarPrimario={setUniforme1}
          aoMudarSecundario={setUniforme2}
        />

        <div className="grade2">
          <label className="campo">
            <span>
              Responsável pela inscrição <b className="req">*</b>
            </span>
            <input
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
            />
          </label>
          <label className="campo">
            <span>
              Telefone de contato <b className="req">*</b>
            </span>
            <input value={contato} onChange={(e) => setContato(e.target.value)} />
          </label>
          <label className="campo">
            <span>E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10 }}>
            <label className="campo">
              <span>Cidade</span>
              <input value={cidade} onChange={(e) => setCidade(e.target.value)} />
            </label>
            <label className="campo">
              <span>UF</span>
              <input
                value={estado}
                maxLength={2}
                onChange={(e) => setEstado(e.target.value.toUpperCase())}
              />
            </label>
          </div>
        </div>

        <label className="campo">
          <span>
            Categorias que vai disputar <b className="req">*</b>
          </span>
          <div style={{ display: 'grid', gap: 8 }}>
            {categorias.map((k) => {
              const lotada = k.vagas <= 0 && !escolhidas.includes(k.id);
              return (
                <label
                  key={k.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: 10,
                    border: '1px solid #E2E8F0',
                    borderRadius: 10,
                    opacity: lotada ? 0.55 : 1,
                    cursor: lotada ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={lotada}
                    checked={escolhidas.includes(k.id)}
                    onChange={() => alternar(k.id)}
                  />
                  <span style={{ flex: 1 }}>
                    <b>{k.nome}</b>
                    <span
                      style={{ display: 'block', fontSize: 12, color: 'var(--tinta2)' }}
                    >
                      {k.modalidade} · {k.inscritos}/{k.numTimes} equipes
                    </span>
                  </span>
                  {/* a vaga aparece antes do formulário inteiro: descobrir
                      que lotou só ao enviar seria desrespeitoso */}
                  <span className={`etiqueta ${lotada ? 'erro' : 'ok'}`}>
                    {lotada ? 'Lotada' : `${k.vagas} vaga${k.vagas === 1 ? '' : 's'}`}
                  </span>
                </label>
              );
            })}
          </div>
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={aoVoltar} className="neutro">
            ← Voltar
          </button>
          <button
            disabled={ocupado}
            onClick={() =>
              aoEnviar(
                {
                  nome,
                  responsavel,
                  contato,
                  email: email || null,
                  cidade: cidade || null,
                  estado: estado || null,
                  uniformePrimario: uniforme1,
                  uniformeSecundario: uniforme2,
                  categoriaIds: escolhidas,
                },
                escudo,
              )
            }
          >
            {ocupado ? 'Enviando…' : 'Concluir inscrição da equipe'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Cores do uniforme.
 *
 * O principal é obrigatório e o campo nunca fica vazio — `<input
 * type="color">` sempre tem um valor. O secundário é opcional de verdade:
 * só existe quando a equipe o declara, e o botão devolve ao estado "sem
 * uniforme secundário", que é diferente de "branco".
 */
function Uniformes({
  primario,
  secundario,
  aoMudarPrimario,
  aoMudarSecundario,
}: {
  primario: string;
  secundario: string | null;
  aoMudarPrimario: (v: string) => void;
  aoMudarSecundario: (v: string | null) => void;
}) {
  return (
    <div className="grade2">
      <label className="campo">
        <span>
          Uniforme principal <b className="req">*</b>
        </span>
        <input
          type="color"
          className="cor"
          value={primario}
          onChange={(e) => aoMudarPrimario(e.target.value.toUpperCase())}
        />
      </label>

      <label className="campo">
        <span>Uniforme secundário</span>
        {secundario === null ? (
          <button
            type="button"
            className="neutro"
            onClick={() => aoMudarSecundario('#FFFFFF')}
          >
            ＋ Definir cor
          </button>
        ) : (
          <span style={{ display: 'flex', gap: 8 }}>
            <input
              type="color"
              className="cor"
              value={secundario}
              onChange={(e) => aoMudarSecundario(e.target.value.toUpperCase())}
            />
            <button
              type="button"
              className="neutro"
              title="Equipe sem uniforme secundário"
              onClick={() => aoMudarSecundario(null)}
            >
              ✕
            </button>
          </span>
        )}
      </label>
    </div>
  );
}

function PainelDaEquipe({
  slug,
  painel,
  ocupado,
  aoAgir,
  chamar,
  codigo,
  aoRecarregar,
  aoSair,
}: {
  slug: string;
  painel: Painel;
  ocupado: boolean;
  aoAgir: (acao: () => Promise<unknown>) => Promise<void>;
  chamar: Chamar;
  codigo: string;
  aoRecarregar: () => Promise<void>;
  aoSair: () => void;
}) {
  const [aba, setAba] = useState<string>(painel.categorias[0]?.id ?? 'equipe');
  const [modal, setModal] = useState<{
    categoria: CategoriaDaEquipe;
    atleta?: AtletaDoElenco;
  } | null>(null);

  const atual = painel.categorias.find((k) => k.id === aba);

  return (
    <div>
      <div className="cartao">
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: 14,
          }}
        >
          {/* 3.8: escudo do cadastro da equipe ao lado do nome */}
          <Brasao nome={painel.equipe.nome} url={painel.equipe.escudoUrl} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ margin: 0, padding: 0, border: 0, fontSize: 17 }}>
              {painel.equipe.nome}
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--tinta2)', margin: 0 }}>
              {painel.categorias.map((k) => k.nome).join(' · ') || 'Sem categoria'}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 11, color: 'var(--tinta2)' }}>
              Código de acesso
            </span>
            <br />
            <code style={{ fontWeight: 700, letterSpacing: 2 }}>
              {painel.equipe.codigoAcesso}
            </code>
          </div>
          <button onClick={aoSair} className="neutro">
            Sair
          </button>
        </div>
      </div>

      {/* 3.1: uma aba por categoria, mais a dos dados cadastrais */}
      <div className="abas-equipe">
        {painel.categorias.map((k) => (
          <button
            key={k.id}
            className={aba === k.id ? 'ativa' : ''}
            onClick={() => setAba(k.id)}
          >
            🎽 {k.nome}
          </button>
        ))}
        <button
          className={aba === 'equipe' ? 'ativa' : ''}
          onClick={() => setAba('equipe')}
        >
          🛡 Dados da equipe
        </button>
      </div>

      {painel.categorias.length === 0 && (
        <div className="cartao">
          <h2>Sem categoria</h2>
          <p className="vazio">
            Sua equipe não está vinculada a nenhuma categoria. Fale com o
            organizador.
          </p>
        </div>
      )}

      {aba === 'equipe' && (
        <DadosDaEquipe
          slug={slug}
          painel={painel}
          codigo={codigo}
          ocupado={ocupado}
          aoAgir={aoAgir}
          chamar={chamar}
        />
      )}

      {atual && (
        <AbaDaCategoria
          categoria={atual}
          equipe={painel.equipe}
          cargos={painel.cargosComissao}
          ocupado={ocupado}
          aoAgir={aoAgir}
          chamar={chamar}
          codigo={codigo}
          aoInscrever={() => setModal({ categoria: atual })}
          aoEditar={(a) => setModal({ categoria: atual, atleta: a })}
        />
      )}

      {/* comissão gravada antes da migration 19, quando a lista era da
          equipe inteira: aparece uma vez só, fora das abas */}
      {painel.comissaoSemCategoria.length > 0 && (
        <div className="cartao">
          <h2>Comissão sem categoria</h2>
          <p style={{ padding: '10px 16px 0', fontSize: 12.5, color: 'var(--tinta2)' }}>
            Membros cadastrados antes da separação por categoria. Recadastre-os
            na aba da categoria correspondente.
          </p>
          <table>
            <tbody>
              {painel.comissaoSemCategoria.map((m) => (
                <tr key={m.id}>
                  <td>
                    <b>{m.nome}</b>
                  </td>
                  <td>{m.cargo}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="perigo"
                      disabled={ocupado}
                      onClick={() =>
                        void aoAgir(() =>
                          chamar(`/equipe/comissao/${m.id}`, {
                            metodo: 'DELETE',
                            codigo,
                          }),
                        )
                      }
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <FormularioDeAtleta
          slug={slug}
          codigo={codigo}
          categoria={modal.categoria}
          equipe={painel.equipe}
          atleta={modal.atleta}
          chamar={chamar}
          aoFechar={() => setModal(null)}
          aoConcluir={aoRecarregar}
        />
      )}
    </div>
  );
}

/** Uma categoria: elenco e comissão técnica próprios (3.1 e 3.2). */
function AbaDaCategoria({
  categoria: k,
  equipe,
  cargos,
  ocupado,
  aoAgir,
  chamar,
  codigo,
  aoInscrever,
  aoEditar,
}: {
  categoria: CategoriaDaEquipe;
  equipe: { nome: string; escudoUrl: string | null };
  cargos: string[];
  ocupado: boolean;
  aoAgir: (acao: () => Promise<unknown>) => Promise<void>;
  chamar: Chamar;
  codigo: string;
  aoInscrever: () => void;
  aoEditar: (a: AtletaDoElenco) => void;
}) {
  const cheio = k.maxAtletas !== null && k.atletas.length >= k.maxAtletas;
  const podeInscrever = k.inscricoesAbertas && k.permiteInscrever && !cheio;

  return (
    <>
      <div className="cartao">
        <h2
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Brasao nome={equipe.nome} url={equipe.escudoUrl} tamanho={26} />
          <span style={{ flex: 1 }}>
            {equipe.nome} · {k.nome}
          </span>
          {podeInscrever && (
            <button onClick={aoInscrever}>＋ Inscrever atleta</button>
          )}
        </h2>

        <p style={{ padding: '10px 16px 0', fontSize: 12.5, color: 'var(--tinta2)' }}>
          {k.atletas.length} de {k.maxAtletas ?? '—'} atletas · {k.modalidade}
          {k.anoEsperado && ` · nascidos em ${k.anoEsperado}`}
          {!k.inscricoesAbertas && ' · '}
          {!k.inscricoesAbertas && (
            <span className="etiqueta erro">Inscrições fechadas</span>
          )}
          {k.inscricoesAbertas && !k.permiteInscrever && (
            <>
              {' · '}
              <span className="etiqueta">Inscrição de atletas desabilitada</span>
            </>
          )}
        </p>

        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              {/* 3.5 — `nowrap` porque "Nº DA CAMISA" em caixa alta quebra
                  em duas linhas na coluna estreita */}
              <th
                style={{ width: 112, textAlign: 'center', whiteSpace: 'nowrap' }}
              >
                Nº da Camisa
              </th>
              <th>Atleta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {k.atletas.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <div className="vazio">
                    🎽 Nenhum atleta inscrito
                    {k.maxAtletas && ` — limite de ${k.maxAtletas} nesta categoria.`}
                  </div>
                </td>
              </tr>
            )}
            {k.atletas.map((a) => (
              <tr key={a.inscricaoId}>
                <td style={{ textAlign: 'center' }}>
                  <b>{a.numero ?? '—'}</b>
                </td>
                <td>
                  <span
                    style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                  >
                    {typeof a.ficha.fotoUrl === 'string' && (
                      <img
                        src={a.ficha.fotoUrl}
                        alt=""
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          objectFit: 'cover',
                        }}
                      />
                    )}
                    <span>
                      <b>{a.nome}</b>
                      <ResumoDaFicha ficha={a.ficha} />
                    </span>
                    {a.foraDaFaixa && (
                      <span className="etiqueta alerta">⚠️ fora da faixa</span>
                    )}
                  </span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {k.permiteEditar && k.inscricoesAbertas && (
                    <button
                      className="neutro"
                      style={{ marginRight: 6 }}
                      onClick={() => aoEditar(a)}
                    >
                      Editar
                    </button>
                  )}
                  {k.permiteRemover && (
                    <button
                      className="perigo"
                      disabled={ocupado}
                      onClick={() =>
                        void aoAgir(() =>
                          chamar(`/equipe/atletas/${a.inscricaoId}`, {
                            metodo: 'DELETE',
                            codigo,
                          }),
                        )
                      }
                    >
                      Remover
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {cheio && (
          <p className="aviso" style={{ margin: 16 }}>
            Limite de {k.maxAtletas} atletas atingido nesta categoria.
          </p>
        )}
      </div>

      <ComissaoDaCategoria
        categoria={k}
        cargos={cargos}
        ocupado={ocupado}
        aoAgir={aoAgir}
        chamar={chamar}
        codigo={codigo}
      />
    </>
  );
}

/** Uma linha discreta com o que a ficha trouxe, sem virar segunda tabela. */
function ResumoDaFicha({ ficha }: { ficha: Record<string, unknown> }) {
  const partes = [
    ficha.posicao,
    ficha.dataNascimento,
    ficha.apelido && `"${String(ficha.apelido)}"`,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);

  if (!partes.length) return null;
  return (
    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--tinta2)' }}>
      {partes.join(' · ')}
    </span>
  );
}

/** 3.2: comissão técnica é da categoria, com o limite dela. */
function ComissaoDaCategoria({
  categoria: k,
  cargos,
  ocupado,
  aoAgir,
  chamar,
  codigo,
}: {
  categoria: CategoriaDaEquipe;
  cargos: string[];
  ocupado: boolean;
  aoAgir: (acao: () => Promise<unknown>) => Promise<void>;
  chamar: Chamar;
  codigo: string;
}) {
  const [membro, setMembro] = useState({
    nome: '',
    cargo: cargos[0] ?? '',
    contato: '',
  });
  const cheia = k.comissao.length >= k.maxComissao;

  return (
    <div className="cartao">
      <h2>👔 Comissão técnica · {k.nome}</h2>
      <p style={{ padding: '10px 16px 0', fontSize: 12.5, color: 'var(--tinta2)' }}>
        {k.comissao.length} de {k.maxComissao} membros nesta categoria
      </p>

      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Cargo</th>
            <th>Contato</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {k.comissao.length === 0 && (
            <tr>
              <td colSpan={4}>
                <div className="vazio">
                  Nenhum membro cadastrado nesta categoria.
                </div>
              </td>
            </tr>
          )}
          {k.comissao.map((m) => (
            <tr key={m.id}>
              <td>
                <b>{m.nome}</b>
              </td>
              <td>
                <span className="etiqueta">{m.cargo}</span>
              </td>
              <td>{m.contato ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="perigo"
                  disabled={ocupado}
                  onClick={() =>
                    void aoAgir(() =>
                      chamar(`/equipe/comissao/${m.id}`, {
                        metodo: 'DELETE',
                        codigo,
                      }),
                    )
                  }
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {cheia ? (
        <p className="aviso" style={{ margin: 16 }}>
          Limite de {k.maxComissao} membros atingido em {k.nome}.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1.3fr 1fr auto',
            gap: 8,
            alignItems: 'end',
            padding: 16,
          }}
        >
          <label className="campo" style={{ margin: 0 }}>
            <span>Nome</span>
            <input
              value={membro.nome}
              onChange={(e) => setMembro({ ...membro, nome: e.target.value })}
            />
          </label>
          <label className="campo" style={{ margin: 0 }}>
            {/* 3.7: cargo passou a ser lista fechada */}
            <span>Cargo</span>
            <select
              value={membro.cargo}
              onChange={(e) => setMembro({ ...membro, cargo: e.target.value })}
            >
              {cargos.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="campo" style={{ margin: 0 }}>
            <span>Contato</span>
            <input
              value={membro.contato}
              onChange={(e) => setMembro({ ...membro, contato: e.target.value })}
            />
          </label>
          <button
            disabled={ocupado || !membro.nome.trim()}
            onClick={() =>
              void aoAgir(async () => {
                await chamar('/equipe/comissao', {
                  metodo: 'POST',
                  codigo,
                  corpo: { ...membro, categoriaId: k.id },
                });
                setMembro({ nome: '', cargo: cargos[0] ?? '', contato: '' });
              })
            }
          >
            Adicionar
          </button>
        </div>
      )}
    </div>
  );
}

/** Aba de dados cadastrais — e é aqui que o escudo da equipe é enviado. */
function DadosDaEquipe({
  slug,
  painel,
  codigo,
  ocupado,
  aoAgir,
  chamar,
}: {
  slug: string;
  painel: Painel;
  codigo: string;
  ocupado: boolean;
  aoAgir: (acao: () => Promise<unknown>) => Promise<void>;
  chamar: Chamar;
}) {
  const e = painel.equipe;
  const [dados, setDados] = useState({
    nome: e.nome,
    responsavel: e.responsavel ?? '',
    contato: e.contato ?? '',
    email: e.email ?? '',
    cidade: e.cidade ?? '',
    estado: e.estado ?? '',
  });
  const [escudo, setEscudo] = useState<string | null>(e.escudoUrl);
  const [uniforme1, setUniforme1] = useState(e.uniformePrimario ?? UNIFORME_PADRAO);
  const [uniforme2, setUniforme2] = useState<string | null>(e.uniformeSecundario);
  const [enviando, setEnviando] = useState(false);

  return (
    <div className="cartao">
      <h2>🛡 Dados da equipe</h2>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
          <Brasao nome={dados.nome} url={escudo} tamanho={58} />
          <label className="campo" style={{ flex: 1, margin: 0 }}>
            <span>Escudo da equipe</span>
            <input
              type="file"
              accept="image/*"
              disabled={enviando}
              onChange={async (e2) => {
                const arquivo = e2.target.files?.[0];
                if (!arquivo) return;
                setEnviando(true);
                try {
                  setEscudo(await enviarImagem(slug, codigo, arquivo));
                } finally {
                  setEnviando(false);
                }
              }}
            />
            <span style={{ fontSize: 11.5, color: 'var(--tinta2)' }}>
              Aparece ao lado do nome da equipe no cadastro de atletas, na
              tabela de jogos e no portal.
            </span>
          </label>
        </div>

        <label className="campo">
          <span>
            Nome da equipe <b className="req">*</b>
          </span>
          <input
            value={dados.nome}
            onChange={(ev) => setDados({ ...dados, nome: ev.target.value })}
          />
        </label>

        <Uniformes
          primario={uniforme1}
          secundario={uniforme2}
          aoMudarPrimario={setUniforme1}
          aoMudarSecundario={setUniforme2}
        />

        <div className="grade2">
          <label className="campo">
            <span>Responsável</span>
            <input
              value={dados.responsavel}
              onChange={(ev) => setDados({ ...dados, responsavel: ev.target.value })}
            />
          </label>
          <label className="campo">
            <span>Telefone</span>
            <input
              value={dados.contato}
              onChange={(ev) => setDados({ ...dados, contato: ev.target.value })}
            />
          </label>
          <label className="campo">
            <span>E-mail</span>
            <input
              type="email"
              value={dados.email}
              onChange={(ev) => setDados({ ...dados, email: ev.target.value })}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10 }}>
            <label className="campo">
              <span>Cidade</span>
              <input
                value={dados.cidade}
                onChange={(ev) => setDados({ ...dados, cidade: ev.target.value })}
              />
            </label>
            <label className="campo">
              <span>UF</span>
              <input
                value={dados.estado}
                maxLength={2}
                onChange={(ev) =>
                  setDados({ ...dados, estado: ev.target.value.toUpperCase() })
                }
              />
            </label>
          </div>
        </div>

        <button
          disabled={ocupado || enviando || !dados.nome.trim()}
          onClick={() =>
            void aoAgir(() =>
              chamar('/equipe', {
                metodo: 'PATCH',
                codigo,
                corpo: {
                  ...dados,
                  email: dados.email || null,
                  cidade: dados.cidade || null,
                  estado: dados.estado || null,
                  uniformePrimario: uniforme1,
                  uniformeSecundario: uniforme2,
                  escudoUrl: escudo,
                },
              }),
            )
          }
        >
          Salvar alterações
        </button>
      </div>
    </div>
  );
}
