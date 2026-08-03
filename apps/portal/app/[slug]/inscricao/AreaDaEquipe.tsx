'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Área da equipe. Client component inteiro: é formulário, não conteúdo —
 * não há SEO a ganhar, e a página é `noindex`.
 *
 * O código de acesso fica em `sessionStorage`, não em `localStorage`: a
 * inscrição costuma ser feita de máquina compartilhada (secretaria do
 * clube, lan house), e o código dá acesso ao elenco inteiro da equipe.
 */

interface Categoria {
  id: string;
  nome: string;
  tipo: string;
  genero: string;
  modalidade: string;
  vagas: number;
  numTimes: number;
  inscritos: number;
  maxAtletas: number;
  maxComissao: number;
}

interface Convite {
  competicao: {
    nome: string;
    slug: string;
    cidade: string;
    estado: string;
    corPrimaria: string;
    logoUrl: string | null;
    status: string;
  };
  inscricoesAbertas: boolean;
  categorias: Categoria[];
}

interface Painel {
  equipe: {
    id: string;
    nome: string;
    escudoUrl: string | null;
    cidade: string | null;
    estado: string | null;
    responsavel: string | null;
    contato: string | null;
    email: string | null;
    codigoAcesso: string | null;
  };
  comissao: { id: string; nome: string; cargo: string; contato: string | null }[];
  categorias: {
    id: string;
    nome: string;
    maxAtletas: number | null;
    maxComissao: number;
    permiteInscrever: boolean;
    permiteEditar: boolean;
    permiteRemover: boolean;
    inscricoesAbertas: boolean;
    atletas: {
      inscricaoId: string;
      nome: string;
      numero: number | null;
      posicao: string | null;
      dataNascimento: string | null;
    }[];
  }[];
}

const CHAVE = 'apitofut.equipe';

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

  const chamar = useCallback(
    async (
      caminho: string,
      opcoes: { metodo?: string; corpo?: unknown; codigo?: string } = {},
    ) => {
      const r = await fetch(`/api/convite/${slug}${caminho}`, {
        method: opcoes.metodo ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(opcoes.codigo ? { 'X-Codigo-Equipe': opcoes.codigo } : {}),
        },
        body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      });
      const dados = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(
          (dados as { message?: string })?.message ?? 'Não foi possível concluir.',
        );
      }
      return dados;
    },
    [slug],
  );

  const carregarPainel = useCallback(
    async (cod: string) => {
      const p = (await chamar('/equipe', { codigo: cod })) as Painel;
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
      if (s.slug === slug) void carregarPainel(s.codigo).catch(() => {
        sessionStorage.removeItem(CHAVE);
      });
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
            <p style={{ fontSize: 14, color: 'var(--tinta2)' }}>
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
        )}

        {painel ? (
          <PainelDaEquipe
            painel={painel}
            ocupado={ocupado}
            aoAgir={agir}
            chamar={chamar}
            codigo={codigo!}
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
              aoEnviar={(dados) =>
                agir(async () => {
                  const r = (await chamar('/equipes', {
                    metodo: 'POST',
                    corpo: dados,
                  })) as { codigoAcesso: string };
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
  categorias: Categoria[];
  ocupado: boolean;
  aoComecar: () => void;
  aoEntrar: (codigo: string) => void;
}) {
  const [cod, setCod] = useState('');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="cartao">
        <h2>➕ Inscrever nova equipe</h2>
        <p style={{ fontSize: 14, color: 'var(--tinta2)', lineHeight: 1.6 }}>
          Cadastre os dados da equipe e escolha as categorias em que vai
          disputar. Ao final você recebe um <b>código de acesso</b> para voltar
          e cadastrar atletas e comissão técnica quando quiser.
        </p>
        <p style={{ fontSize: 13, marginTop: 10 }}>
          Categorias com inscrições abertas:{' '}
          {categorias.map((k) => (
            <span key={k.id} className="pill" style={{ marginRight: 4 }}>
              {k.nome}
            </span>
          ))}
        </p>
        <button onClick={aoComecar} style={{ marginTop: 14 }}>
          Começar inscrição
        </button>
      </div>

      <div className="cartao">
        <h2>🔑 Já tenho inscrição</h2>
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
            width: '100%',
            padding: 10,
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
  categorias: Categoria[];
  cidadePadrao: string;
  estadoPadrao: string;
  ocupado: boolean;
  aoVoltar: () => void;
  aoEnviar: (dados: Record<string, unknown>) => void;
}) {
  const [nome, setNome] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [contato, setContato] = useState('');
  const [email, setEmail] = useState('');
  const [cidade, setCidade] = useState(cidadePadrao);
  const [estado, setEstado] = useState(estadoPadrao);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);

  const alternar = (id: string) =>
    setEscolhidas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );

  return (
    <div className="cartao">
      <h2>Dados da equipe</h2>

      <Campo rotulo="Nome da equipe *">
        <input value={nome} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      <Campo rotulo="Responsável pela inscrição *">
        <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
      </Campo>
      <Campo rotulo="Telefone de contato *">
        <input value={contato} onChange={(e) => setContato(e.target.value)} />
      </Campo>
      <Campo rotulo="E-mail">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Campo>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10 }}>
        <Campo rotulo="Cidade">
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} />
        </Campo>
        <Campo rotulo="Estado">
          <input
            value={estado}
            maxLength={2}
            onChange={(e) => setEstado(e.target.value.toUpperCase())}
          />
        </Campo>
      </div>

      <Campo rotulo="Categorias que vai disputar *">
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
                <span className="pill">
                  {lotada ? 'Lotada' : `${k.vagas} vaga${k.vagas === 1 ? '' : 's'}`}
                </span>
              </label>
            );
          })}
        </div>
      </Campo>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={aoVoltar} style={{ background: '#64748B' }}>
          ← Voltar
        </button>
        <button
          disabled={ocupado}
          onClick={() =>
            aoEnviar({
              nome,
              responsavel,
              contato,
              email: email || null,
              cidade: cidade || null,
              estado: estado || null,
              categoriaIds: escolhidas,
            })
          }
        >
          {ocupado ? 'Enviando…' : 'Concluir inscrição da equipe'}
        </button>
      </div>
    </div>
  );
}

function PainelDaEquipe({
  painel,
  ocupado,
  aoAgir,
  chamar,
  codigo,
  aoSair,
}: {
  painel: Painel;
  ocupado: boolean;
  aoAgir: (acao: () => Promise<unknown>) => Promise<void>;
  chamar: (
    caminho: string,
    opcoes?: { metodo?: string; corpo?: unknown; codigo?: string },
  ) => Promise<unknown>;
  codigo: string;
  aoSair: () => void;
}) {
  const [novo, setNovo] = useState<{ categoriaId: string; nome: string; numero: string; nascimento: string }>({
    categoriaId: '',
    nome: '',
    numero: '',
    nascimento: '',
  });
  const [membro, setMembro] = useState({ nome: '', cargo: 'Técnico' });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="cartao">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ margin: 0 }}>{painel.equipe.nome}</h2>
            <p style={{ fontSize: 13, color: 'var(--tinta2)', margin: 0 }}>
              {painel.equipe.responsavel} · {painel.equipe.contato}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 11, color: 'var(--tinta2)' }}>Código de acesso</span>
            <br />
            <code style={{ fontWeight: 700, letterSpacing: 2 }}>
              {painel.equipe.codigoAcesso}
            </code>
          </div>
          <button onClick={aoSair} style={{ background: '#64748B' }}>
            Sair
          </button>
        </div>
      </div>

      {painel.categorias.length === 0 && (
        <div className="cartao">
          <h2>Sem categoria</h2>
          <p style={{ fontSize: 14 }}>
            Sua equipe não está vinculada a nenhuma categoria. Fale com o
            organizador.
          </p>
        </div>
      )}

      {painel.categorias.map((k) => {
        const cheio = k.maxAtletas !== null && k.atletas.length >= k.maxAtletas;
        const podeInscrever = k.inscricoesAbertas && k.permiteInscrever && !cheio;

        return (
          <div key={k.id} className="cartao">
            <h2>{k.nome}</h2>
            <p style={{ fontSize: 13, color: 'var(--tinta2)' }}>
              {k.atletas.length} de {k.maxAtletas ?? '—'} atletas
              {!k.inscricoesAbertas && ' · inscrições fechadas'}
              {k.inscricoesAbertas && !k.permiteInscrever &&
                ' · inscrição de atletas desabilitada pelo organizador'}
            </p>

            <table>
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Atleta</th>
                  <th>Nascimento</th>
                  <th>Posição</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {k.atletas.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 20 }}>
                      Nenhum atleta inscrito.
                    </td>
                  </tr>
                )}
                {k.atletas.map((a) => (
                  <tr key={a.inscricaoId}>
                    <td>{a.numero ?? '—'}</td>
                    <td>
                      <b>{a.nome}</b>
                    </td>
                    <td>{a.dataNascimento ?? '—'}</td>
                    <td>{a.posicao ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {k.permiteRemover && (
                        <button
                          disabled={ocupado}
                          style={{ background: '#DC2626' }}
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

            {podeInscrever && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 70px 140px auto',
                  gap: 8,
                  marginTop: 12,
                  alignItems: 'end',
                }}
              >
                <Campo rotulo="Nome do atleta">
                  <input
                    value={novo.categoriaId === k.id ? novo.nome : ''}
                    onChange={(e) =>
                      setNovo({ ...novo, categoriaId: k.id, nome: e.target.value })
                    }
                  />
                </Campo>
                <Campo rotulo="Nº">
                  <input
                    value={novo.categoriaId === k.id ? novo.numero : ''}
                    onChange={(e) =>
                      setNovo({ ...novo, categoriaId: k.id, numero: e.target.value })
                    }
                  />
                </Campo>
                <Campo rotulo="Nascimento">
                  <input
                    type="date"
                    value={novo.categoriaId === k.id ? novo.nascimento : ''}
                    onChange={(e) =>
                      setNovo({ ...novo, categoriaId: k.id, nascimento: e.target.value })
                    }
                  />
                </Campo>
                <button
                  disabled={ocupado || novo.categoriaId !== k.id || !novo.nome.trim()}
                  onClick={() =>
                    void aoAgir(async () => {
                      await chamar('/equipe/atletas', {
                        metodo: 'POST',
                        codigo,
                        corpo: {
                          categoriaId: k.id,
                          nome: novo.nome,
                          numeroCamisa: novo.numero ? Number(novo.numero) : null,
                          dataNascimento: novo.nascimento || null,
                        },
                      });
                      setNovo({ categoriaId: '', nome: '', numero: '', nascimento: '' });
                    })
                  }
                >
                  Inscrever
                </button>
              </div>
            )}
            {cheio && (
              <p className="aviso">Limite de {k.maxAtletas} atletas atingido.</p>
            )}
          </div>
        );
      })}

      <div className="cartao">
        <h2>Comissão técnica</h2>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Cargo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {painel.comissao.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: 20 }}>
                  Nenhum membro cadastrado.
                </td>
              </tr>
            )}
            {painel.comissao.map((m) => (
              <tr key={m.id}>
                <td>
                  <b>{m.nome}</b>
                </td>
                <td>{m.cargo}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    disabled={ocupado}
                    style={{ background: '#DC2626' }}
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

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr auto',
            gap: 8,
            marginTop: 12,
            alignItems: 'end',
          }}
        >
          <Campo rotulo="Nome">
            <input
              value={membro.nome}
              onChange={(e) => setMembro({ ...membro, nome: e.target.value })}
            />
          </Campo>
          <Campo rotulo="Cargo">
            <input
              value={membro.cargo}
              onChange={(e) => setMembro({ ...membro, cargo: e.target.value })}
            />
          </Campo>
          <button
            disabled={ocupado || !membro.nome.trim()}
            onClick={() =>
              void aoAgir(async () => {
                await chamar('/equipe/comissao', {
                  metodo: 'POST',
                  codigo,
                  corpo: membro,
                });
                setMembro({ nome: '', cargo: 'Técnico' });
              })
            }
          >
            Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {rotulo}
      </span>
      {children}
    </label>
  );
}
