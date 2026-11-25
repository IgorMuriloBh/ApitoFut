'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * A compra, na página do evento (RF035, fase 2).
 *
 * ── O PREÇO FINAL VEM DO SERVIDOR, SEMPRE ────────────────────────────
 * Esta tela não soma nada. A cada mudança de quantidade ela pergunta ao
 * `/preview` quanto fica — porque a parte fixa da taxa é por PEDIDO, não
 * por ingresso, e um total calculado aqui divergiria do que o banco
 * grava. Mostrar um valor e cobrar outro é o pior defeito possível numa
 * bilheteria.
 *
 * ── CARTÃO NÃO É DIGITADO AQUI ───────────────────────────────────────
 * Quem escolhe cartão é levado à página de cobrança do próprio Asaas.
 * Número de cartão não passa por este formulário nem por este servidor.
 */

interface Lote {
  id: string;
  especie: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  dia: string | null;
  maxPorPedido: number;
  grupo: string | null;
  imagemUrl: string | null;
}

interface Previa {
  subtotalCentavos: number;
  taxaCentavos: number;
  totalCentavos: number;
  taxaModelo: string;
  /** Menor valor que o meio de pagamento aceita cobrar. */
  minimoCentavos: number;
}

const moeda = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** `529.982.247-25` enquanto digita. */
function mascaraDocumento(bruto: string): string {
  const d = bruto.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function Comprar({ slug, lotes }: { slug: string; lotes: Lote[] }) {
  const router = useRouter();
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [metodo, setMetodo] = useState<'pix' | 'cartao'>('pix');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState({
    nome: '',
    email: '',
    documento: '',
    telefone: '',
  });

  const itens = useMemo(
    () =>
      Object.entries(quantidades)
        .filter(([, q]) => q > 0)
        .map(([loteId, quantidade]) => ({ loteId, quantidade })),
    [quantidades],
  );

  const total = itens.reduce((s, i) => s + i.quantidade, 0);

  /**
   * Entrada franca: não há o que cobrar, então a forma de pagamento sai
   * de cena. O CPF FICA: a base de quem entrou é do organizador, e
   * ingresso de cortesia conta tanto quanto o vendido.
   */
  const gratuito = previa !== null && previa.totalCentavos === 0;

  /**
   * Abaixo do mínimo do gateway. Com a regra de criação de lote isto
   * não deveria acontecer — mas lote criado antes dela continua no
   * banco, e é melhor avisar aqui do que deixar o comprador descobrir
   * no fim, com a vaga já reservada.
   */
  const abaixoDoMinimo =
    previa !== null &&
    previa.totalCentavos > 0 &&
    previa.totalCentavos < previa.minimoCentavos;

  /** Pergunta o preço ao servidor; nada é somado nesta tela. */
  const calcular = useCallback(async () => {
    if (itens.length === 0) {
      setPrevia(null);
      return;
    }
    setCalculando(true);
    try {
      const r = await fetch(`/api/eventos/${slug}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens }),
      });
      if (r.ok) setPrevia((await r.json()) as Previa);
    } catch {
      // rede instável: o total some em vez de mostrar valor velho
      setPrevia(null);
    } finally {
      setCalculando(false);
    }
  }, [itens, slug]);

  useEffect(() => {
    // espera a pessoa parar de clicar antes de perguntar o preço
    const t = setTimeout(() => void calcular(), 250);
    return () => clearTimeout(t);
  }, [calcular]);

  function mudar(loteId: string, delta: number, maximo: number) {
    setQuantidades((q) => {
      const atual = q[loteId] ?? 0;
      const novo = Math.min(Math.max(atual + delta, 0), maximo);
      return { ...q, [loteId]: novo };
    });
  }

  async function comprar() {
    setErro(null);
    setEnviando(true);
    try {
      const r = await fetch(`/api/eventos/${slug}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens,
          compradorNome: dados.nome,
          compradorEmail: dados.email,
          compradorDocumento: dados.documento,
          compradorTelefone: dados.telefone || null,
          metodo,
        }),
      });
      const corpo = await r.json();
      if (!r.ok) {
        // a mensagem exibida é a que a API devolveu: ela conhece a regra
        setErro(corpo?.message ?? 'Não foi possível concluir a compra.');
        return;
      }
      router.push(`/p/${corpo.pedidoId}`);
    } catch {
      setErro('Falha de conexão. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  const preenchido =
    dados.nome.trim().length > 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados.email) &&
    dados.documento.replace(/\D/g, '').length >= 11;

  return (
    <div className="cartao">
      <h2>Comprar ingresso</h2>

      {/* Entrada e consumo são duas decisões diferentes: uma é "eu vou
          ao evento", a outra é "eu vou beber lá". Misturadas na mesma
          lista, a pessoa some com a entrada no meio das cervejas. */}
      {(
        [
          ['ingresso', 'Entrada'],
          ['ficha', 'Consumo no local'],
        ] as const
      ).map(([especie, titulo]) => {
        const doTipo = lotes.filter((l) => l.especie === especie);
        if (doTipo.length === 0) return null;

        return (
          <div key={especie} style={{ marginBottom: 10 }}>
            <p
              style={{
                margin: '10px 0 2px',
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--tinta2)',
              }}
            >
              {titulo}
            </p>
            <table>
              <tbody>
                {doTipo.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {l.imagemUrl && (
                          <img
                            src={l.imagemUrl}
                            alt=""
                            width={44}
                            height={44}
                            style={{ borderRadius: 8, objectFit: 'cover' }}
                          />
                        )}
                        <div>
                          <b>{l.nome}</b>
                          {l.descricao && (
                            <span style={{ display: 'block', fontSize: 13, color: 'var(--tinta2)' }}>
                              {l.descricao}
                            </span>
                          )}
                          <span style={{ display: 'block', fontSize: 13, color: 'var(--tinta2)' }}>
                            {moeda(l.precoCentavos)}
                            {l.dia ? ` · ${l.dia.split('-').reverse().join('/')}` : ''}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        aria-label={`Tirar um ${l.nome}`}
                        onClick={() => mudar(l.id, -1, l.maxPorPedido)}
                        style={botaoPasso}
                      >
                        −
                      </button>
                      <span
                        style={{ display: 'inline-block', minWidth: 28, fontWeight: 700 }}
                      >
                        {quantidades[l.id] ?? 0}
                      </span>
                      <button
                        type="button"
                        aria-label={`Somar um ${l.nome}`}
                        onClick={() => mudar(l.id, 1, l.maxPorPedido)}
                        style={botaoPasso}
                      >
                        +
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {total > 0 && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 10,
            background: '#f8fafc',
            border: '1px solid var(--linha)',
          }}
        >
          {previa ? (
            <>
              <Linha rotulo={`${total} ingresso(s)`} valor={moeda(previa.subtotalCentavos)} />
              {/* a linha da taxa só existe quando é o comprador que a
                  paga; nos outros modelos ela não é assunto dele */}
              {previa.taxaModelo === 'comprador' && previa.taxaCentavos > 0 && (
                <Linha rotulo="Taxa de serviço" valor={moeda(previa.taxaCentavos)} />
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--linha)',
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                <span>Total</span>
                <span>{moeda(previa.totalCentavos)}</span>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: 'var(--tinta2)' }}>
              {calculando ? 'Calculando…' : 'Escolha a quantidade.'}
            </p>
          )}
        </div>
      )}

      {total > 0 && (
        <div style={{ marginTop: 16 }}>
          <Campo rotulo="Seu nome" obrigatorio>
            <input
              value={dados.nome}
              onChange={(e) => setDados({ ...dados, nome: e.target.value })}
              autoComplete="name"
            />
          </Campo>
          <Campo rotulo="E-mail" obrigatorio dica="É por onde o ingresso é reenviado se você perder o link.">
            <input
              type="email"
              value={dados.email}
              onChange={(e) => setDados({ ...dados, email: e.target.value })}
              autoComplete="email"
            />
          </Campo>
          <Campo
            rotulo="CPF"
            obrigatorio
            dica={
              gratuito
                ? 'Usado no cadastro de quem entra no evento.'
                : 'Exigido pelo meio de pagamento.'
            }
          >
            <input
              inputMode="numeric"
              value={dados.documento}
              onChange={(e) =>
                setDados({ ...dados, documento: mascaraDocumento(e.target.value) })
              }
            />
          </Campo>
          <Campo rotulo="Telefone">
            <input
              inputMode="tel"
              value={dados.telefone}
              onChange={(e) => setDados({ ...dados, telefone: e.target.value })}
              autoComplete="tel"
            />
          </Campo>

          {!gratuito && (
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              Como quer pagar?
            </legend>
            <label style={{ display: 'block', marginBottom: 6 }}>
              <input
                type="radio"
                checked={metodo === 'pix'}
                onChange={() => setMetodo('pix')}
              />{' '}
              <b>Pix</b> — o ingresso sai assim que o pagamento cair
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                checked={metodo === 'cartao'}
                onChange={() => setMetodo('cartao')}
              />{' '}
              <b>Cartão de crédito</b> — você é levado à página segura do Asaas
            </label>
          </fieldset>
          )}

          {abaixoDoMinimo && (
            <p className="aviso">
              O meio de pagamento não cobra menos de{' '}
              {moeda(previa.minimoCentavos)}. Leve mais ingressos ou fale com a
              organização.
            </p>
          )}

          {erro && <p className="aviso">{erro}</p>}

          <button
            type="button"
            onClick={comprar}
            disabled={enviando || !preenchido || !previa || abaixoDoMinimo}
            style={{
              width: '100%',
              padding: '14px 16px',
              fontSize: 16,
              fontWeight: 700,
              borderRadius: 10,
              border: 0,
              color: '#fff',
              background: 'var(--cor)',
              opacity: enviando || !preenchido || !previa || abaixoDoMinimo ? 0.5 : 1,
              cursor: enviando || !preenchido ? 'not-allowed' : 'pointer',
            }}
          >
            {enviando
              ? 'Gerando…'
              : gratuito
                ? 'Confirmar ingresso'
                : previa
                  ? `Pagar ${moeda(previa.totalCentavos)}`
                  : 'Pagar'}
          </button>

          <p style={{ fontSize: 12, color: 'var(--tinta2)', marginTop: 8 }}>
            {gratuito
              ? 'Entrada gratuita: o ingresso sai na hora, sem pagamento.'
              : 'Seu ingresso fica reservado por 30 minutos enquanto o pagamento não cai.'}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * O `button` do portal é verde com texto branco por padrão (globals.css).
 * Trocar só o fundo deixava `−` e `+` brancos sobre branco: botões
 * vazios, que foi exatamente o que apareceu na tela. A cor do texto
 * precisa vir junto.
 */
const botaoPasso: React.CSSProperties = {
  width: 36,
  height: 36,
  padding: 0,
  borderRadius: 8,
  border: '1px solid var(--linha)',
  background: '#fff',
  color: 'var(--tinta)',
  fontSize: 20,
  lineHeight: 1,
  fontWeight: 700,
  cursor: 'pointer',
  margin: '0 6px',
};

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
      <span style={{ color: 'var(--tinta2)' }}>{rotulo}</span>
      <span>{valor}</span>
    </div>
  );
}

function Campo({
  rotulo,
  obrigatorio,
  dica,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        {rotulo}
        {obrigatorio && <span style={{ color: '#dc2626' }}> *</span>}
      </span>
      {children}
      {dica && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--tinta2)', marginTop: 2 }}>
          {dica}
        </span>
      )}
    </label>
  );
}
