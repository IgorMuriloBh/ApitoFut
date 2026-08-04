'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brasao } from './Brasao';
import { type AvisoDeFaixa, type Chamar, ErroDaApi, enviarImagem } from './cliente';
import {
  type AtletaDaBase,
  type AtletaDoElenco,
  type CampoDaFicha,
  type CategoriaDaEquipe,
  CHAVE_DO_CAMPO,
  DATA_MINIMA,
  type Ficha,
  hoje,
} from './tipos';

/**
 * Cadastro do atleta — o formulário sai da configuração da categoria.
 *
 * O organizador liga campo a campo em "Configuração › Ficha do atleta"
 * (RF005 · 2.4); aqui a tela desenha exatamente o que veio em
 * `categoria.campos`, na ordem em que veio, marcando os obrigatórios. Era
 * o buraco da tela antiga: ela pedia nome, número e nascimento fixos, e
 * quem tinha configurado foto nunca via o campo de foto.
 *
 * Também é onde a base única entra (RF008): antes de digitar, dá para
 * procurar o atleta em outras competições da mesma equipe.
 */

interface Props {
  slug: string;
  codigo: string;
  categoria: CategoriaDaEquipe;
  equipe: { nome: string; escudoUrl: string | null };
  /** Preenchido = edição; ausente = inscrição nova. */
  atleta?: AtletaDoElenco;
  chamar: Chamar;
  aoFechar: () => void;
  aoConcluir: () => Promise<void> | void;
}

export default function FormularioDeAtleta({
  slug,
  codigo,
  categoria,
  equipe,
  atleta,
  chamar,
  aoFechar,
  aoConcluir,
}: Props) {
  const editando = !!atleta;
  const [nome, setNome] = useState(atleta?.nome ?? '');
  const [ficha, setFicha] = useState<Ficha>({ ...(atleta?.ficha ?? {}) });
  const [numero, setNumero] = useState(
    atleta?.numero == null ? '' : String(atleta.numero),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AvisoDeFaixa[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  // base única — só na inclusão: editando, o atleta já está escolhido
  const [daBase, setDaBase] = useState<AtletaDaBase | null>(null);
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<AtletaDaBase[] | null>(null);

  const campoNumero = categoria.campos.find((c) => c.campo === 'numero_camisa');
  const campos = categoria.campos.filter((c) => c.campo !== 'numero_camisa');

  const definir = (chave: string, valor: unknown) =>
    setFicha((f) => ({ ...f, [chave]: valor }));

  const procurar = useCallback(async () => {
    setErro(null);
    try {
      const r = (await chamar(
        `/equipe/base?categoriaId=${categoria.id}&busca=${encodeURIComponent(busca)}`,
        { codigo },
      )) as { atletas: AtletaDaBase[] };
      setAchados(r.atletas);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível buscar.');
    }
  }, [busca, categoria.id, chamar, codigo]);

  // primeira abertura já lista quem existe: quase sempre é o elenco do ano
  // passado, e obrigar a digitar para descobrir isso esconde o recurso
  useEffect(() => {
    if (!editando) void procurar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Devolve a URL em vez de gravar: quem chamou decide onde ela entra. */
  async function subirImagem(arquivo: File): Promise<string | null> {
    setErro(null);
    setEnviandoFoto(true);
    try {
      return await enviarImagem(slug, codigo, arquivo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enviar a imagem.');
      return null;
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function salvar(confirmandoFaixa = false) {
    setErro(null);
    setOcupado(true);
    try {
      const corpo = {
        categoriaId: categoria.id,
        nome,
        ...(daBase && { atletaId: daBase.id }),
        numeroCamisa: numero.trim() === '' ? null : Number(numero),
        confirmarFaixaEtaria: confirmandoFaixa,
        ficha: { ...ficha, nome },
      };

      if (editando) {
        await chamar(`/equipe/atletas/${atleta.inscricaoId}`, {
          metodo: 'PATCH',
          codigo,
          corpo,
        });
      } else {
        await chamar('/equipe/atletas', { metodo: 'POST', codigo, corpo });
      }
      await aoConcluir();
      aoFechar();
    } catch (e) {
      // faixa etária é AVISO: a API devolve 409 e a tela pede a segunda
      // confirmação, como o protótipo faz dentro do próprio modal
      if (e instanceof ErroDaApi && e.dados?.erro === 'faixa_etaria') {
        setAvisos(e.dados.avisos ?? []);
      } else {
        setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
      }
    } finally {
      setOcupado(false);
    }
  }

  const bloqueado = ocupado || enviandoFoto || !nome.trim();

  return (
    <div className="cortina" role="dialog" aria-modal>
      <div className="modal">
        <header>
          <h3>{editando ? 'Editar atleta' : 'Inscrever atleta'}</h3>
          <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* escudo ao lado do nome da equipe: é a equipe em que este
                atleta está sendo cadastrado, e confundir isso com outra
                equipe custa uma inscrição errada */}
            <Brasao nome={equipe.nome} url={equipe.escudoUrl} tamanho={20} />
            {equipe.nome} · {categoria.nome}
            {categoria.anoEsperado && ` · nascidos em ${categoria.anoEsperado}`}
          </p>
        </header>

        <div className="corpo">
          {avisos && (
            <div className="alerta-caixa">
              <b>⚠️ Ano de nascimento fora da faixa da categoria</b>
              <ul style={{ margin: '6px 0 0 18px' }}>
                {avisos.map((a) => (
                  <li key={a.categoria}>
                    <b>{a.categoria}</b> — esperado nascidos em{' '}
                    <b>{a.anoEsperado}</b>; o atleta é de <b>{a.anoDoAtleta}</b>
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: 6 }}>
                Confira a data. Se estiver correta, confirme novamente para
                prosseguir.
              </p>
            </div>
          )}
          {erro && <p className="aviso">⚠️ {erro}</p>}

          {!editando && (
            <BuscaNaBase
              busca={busca}
              setBusca={setBusca}
              achados={achados}
              escolhido={daBase}
              aoProcurar={procurar}
              aoEscolher={(a) => {
                setDaBase(a);
                setNome(a.nome);
                // a ficha vem do cadastro global; só o que a categoria
                // pede continua editável abaixo
                setFicha({
                  ...ficha,
                  ...(a.dataNascimento && { dataNascimento: a.dataNascimento }),
                  ...(a.posicao && { posicao: a.posicao }),
                  ...(a.apelido && { apelido: a.apelido }),
                  ...(a.fotoUrl && { fotoUrl: a.fotoUrl }),
                });
              }}
              aoLimpar={() => {
                setDaBase(null);
                setNome('');
                setFicha({});
              }}
            />
          )}

          <label className="campo">
            <span>
              Nome completo <b className="req">*</b>
            </span>
            <input
              value={nome}
              readOnly={!!daBase}
              onChange={(e) => setNome(e.target.value)}
            />
          </label>

          {/* atleta da base já tem cadastro: a ficha dele não se
              redigita aqui. Deixar os campos abertos seria mentira — o
              servidor ignora o que vier junto de `atletaId`. Para
              corrigir algum dado, inscreve e usa "Editar". */}
          {daBase && (
            <p style={{ fontSize: 12.5, color: 'var(--tinta2)', marginBottom: 12 }}>
              A ficha vem do cadastro existente. Depois de inscrever, use
              <b> Editar</b> para ajustar algum dado.
            </p>
          )}

          <div className="grade2">
            {!daBase &&
              campos.map((c) => (
                <Campo
                  key={c.campo}
                  campo={c}
                  ficha={ficha}
                  definir={definir}
                  enviando={enviandoFoto}
                  enviarImagem={subirImagem}
                />
              ))}
            {campoNumero && (
              <label className="campo">
                <span>
                  {/* 3.5: era só "Nº", que na coluna estreita parecia ordem
                      da lista */}
                  Nº da Camisa {campoNumero.obrigatorio && <b className="req">*</b>}
                </span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                />
              </label>
            )}
          </div>

          {campos.length === 0 && !campoNumero && (
            <p style={{ fontSize: 12.5, color: 'var(--tinta2)' }}>
              Esta categoria pede apenas o nome do atleta.
            </p>
          )}
        </div>

        <footer>
          <button className="neutro" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button disabled={bloqueado} onClick={() => void salvar(!!avisos)}>
            {ocupado
              ? 'Salvando…'
              : avisos
                ? `${editando ? 'Salvar' : 'Inscrever'} mesmo assim`
                : editando
                  ? 'Salvar'
                  : 'Inscrever'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Um campo da ficha. O `tipo` decide o controle; o resto é igual. */
function Campo({
  campo,
  ficha,
  definir,
  enviando,
  enviarImagem: enviar,
}: {
  campo: CampoDaFicha;
  ficha: Ficha;
  definir: (chave: string, valor: unknown) => void;
  enviando: boolean;
  enviarImagem: (arquivo: File) => Promise<string | null>;
}) {
  const chave = CHAVE_DO_CAMPO[campo.campo];
  const valor = chave ? ((ficha[chave] as string | null) ?? '') : '';
  const rotulo = (
    <span>
      {campo.rotulo} {campo.obrigatorio && <b className="req">*</b>}
    </span>
  );

  if (campo.tipo === 'foto') {
    const url = ficha.fotoUrl as string | null;
    return (
      <label className="campo">
        {rotulo}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {url && (
            <img
              src={url}
              alt=""
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '1px solid var(--linha)',
              }}
            />
          )}
          <input
            type="file"
            accept="image/*"
            disabled={enviando}
            onChange={async (e) => {
              const arquivo = e.target.files?.[0];
              if (!arquivo) return;
              const url = await enviar(arquivo);
              if (url) definir('fotoUrl', url);
            }}
          />
        </div>
        {enviando && (
          <span style={{ fontSize: 12, color: 'var(--tinta2)' }}>Enviando…</span>
        )}
      </label>
    );
  }

  if (campo.tipo === 'anexos') {
    const documentos = (ficha.documentos as { url: string; tipo: string }[]) ?? [];
    return (
      <label className="campo" style={{ gridColumn: '1 / -1' }}>
        {rotulo}
        <input
          type="file"
          accept="image/*"
          disabled={enviando}
          onChange={async (e) => {
            const arquivo = e.target.files?.[0];
            if (!arquivo) return;
            const url = await enviar(arquivo);
            if (url) {
              definir('documentos', [...documentos, { tipo: arquivo.name, url }]);
            }
          }}
        />
        {documentos.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--tinta2)' }}>
            {documentos.length} anexo(s)
          </span>
        )}
      </label>
    );
  }

  if (campo.tipo === 'responsavel') {
    return (
      <>
        <label className="campo">
          <span>
            Responsável {campo.obrigatorio && <b className="req">*</b>}
          </span>
          <input
            value={(ficha.responsavelNome as string) ?? ''}
            onChange={(e) => definir('responsavelNome', e.target.value)}
          />
        </label>
        <label className="campo">
          <span>Contato do responsável</span>
          <input
            value={(ficha.responsavelContato as string) ?? ''}
            onChange={(e) => definir('responsavelContato', e.target.value)}
          />
        </label>
      </>
    );
  }

  if (campo.tipo === 'selecao') {
    return (
      <label className="campo">
        {rotulo}
        <select value={valor} onChange={(e) => definir(chave, e.target.value)}>
          <option value="">—</option>
          {(campo.opcoes ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }

  const tipoHtml =
    campo.tipo === 'data'
      ? 'date'
      : campo.tipo === 'email'
        ? 'email'
        : campo.tipo === 'tel'
          ? 'tel'
          : 'text';

  return (
    <label className="campo">
      {rotulo}
      <input
        type={tipoHtml}
        // 3.6: o campo de data recusa o ano 0218 antes de sair da tela
        {...(campo.tipo === 'data' && { min: DATA_MINIMA, max: hoje() })}
        value={valor}
        onChange={(e) => definir(chave, e.target.value)}
      />
    </label>
  );
}

/** Base única (RF008): reaproveita o atleta em vez de duplicá-lo. */
function BuscaNaBase({
  busca,
  setBusca,
  achados,
  escolhido,
  aoProcurar,
  aoEscolher,
  aoLimpar,
}: {
  busca: string;
  setBusca: (v: string) => void;
  achados: AtletaDaBase[] | null;
  escolhido: AtletaDaBase | null;
  aoProcurar: () => void;
  aoEscolher: (a: AtletaDaBase) => void;
  aoLimpar: () => void;
}) {
  if (escolhido) {
    return (
      <div className="alerta-caixa" style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534' }}>
        <b>Atleta da base:</b> {escolhido.nome}
        {escolhido.competicoes && ` — já inscrito em ${escolhido.competicoes}`}
        <div style={{ marginTop: 8 }}>
          <button className="neutro" onClick={aoLimpar}>
            Cadastrar outro atleta
          </button>
        </div>
      </div>
    );
  }

  return (
    <details style={{ marginBottom: 14 }} open={!!achados?.length}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
        🔎 Buscar na base de atletas da equipe
      </summary>
      <p style={{ fontSize: 12.5, color: 'var(--tinta2)', margin: '6px 0' }}>
        Atletas que já jogaram por <b>esta equipe</b> em outras competições.
        Reaproveitar evita redigitar a ficha e mantém o histórico do atleta.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={busca}
          placeholder="Nome do atleta"
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), aoProcurar())}
        />
        <button type="button" className="neutro" onClick={aoProcurar}>
          Buscar
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        {achados?.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--tinta2)' }}>
            Nenhum atleta encontrado — preencha a ficha abaixo.
          </p>
        )}
        {achados?.map((a) => (
          <button
            type="button"
            key={a.id}
            className="linha-base"
            onClick={() => aoEscolher(a)}
          >
            <Brasao nome={a.nome} url={a.fotoUrl} tamanho={30} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 13.5 }}>{a.nome}</b>
              <span
                style={{ display: 'block', fontSize: 11.5, color: 'var(--tinta2)' }}
              >
                {a.dataNascimento ?? 'sem data'}
                {a.competicoes && ` · ${a.competicoes}`}
              </span>
            </span>
            <span className="etiqueta ok">Usar</span>
          </button>
        ))}
      </div>
    </details>
  );
}
