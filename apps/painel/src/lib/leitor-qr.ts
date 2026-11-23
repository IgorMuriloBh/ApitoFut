/**
 * Leitura de QR pela câmera do aparelho (RF035).
 *
 * ── POR QUE DOIS DECODIFICADORES ─────────────────────────────────────
 * `BarcodeDetector` é nativo: no Android/Chrome usa o decodificador do
 * sistema, aguenta código torto, tela com brilho baixo e lente suja — que
 * é exatamente a condição de um portão à noite. Só que o Safari do iPhone
 * não o tem, e iPhone no portão não é hipótese remota no Brasil. Então:
 * nativo quando existe, `jsQR` quando não. Um caminho só deixaria metade
 * dos portões sem leitor, e o `jsQR` sozinho entregaria no Android uma
 * leitura pior do que a que o aparelho sabe fazer.
 *
 * ── O `jsQR` É CARREGADO SÓ QUANDO PRECISA ───────────────────────────
 * `import()` dinâmico, não estático: são ~45 kB que o painel inteiro
 * baixaria por causa de uma tela, e no Android — onde o detector nativo
 * existe — ninguém chega a usá-los.
 *
 * ── A CÂMERA EXIGE HTTPS ─────────────────────────────────────────────
 * `getUserMedia` só existe em origem segura (ou em localhost). Em produção
 * o painel é HTTPS, então funciona; num IP de rede local, não. É por isso
 * que a tela do portão **sempre** mantém a digitação manual visível: não é
 * plano B escondido, é o caminho que nunca falha.
 */

/** Resolução pedida à câmera. Maior que isto só custa CPU por quadro. */
const LARGURA = 1280;
const ALTURA = 720;

/** Quantos quadros por segundo analisar. 8 lê rápido sem fritar a bateria. */
const INTERVALO_MS = 125;

interface DetectorDeCodigo {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface JanelaComDetector {
  BarcodeDetector?: {
    new (opcoes: { formats: string[] }): DetectorDeCodigo;
    getSupportedFormats?: () => Promise<string[]>;
  };
}

/** O detector nativo, quando o navegador tiver um que leia QR. */
async function detectorNativo(): Promise<DetectorDeCodigo | null> {
  const Classe = (window as unknown as JanelaComDetector).BarcodeDetector;
  if (!Classe) return null;
  try {
    // o Chrome anuncia a classe e pode não ter o formato: perguntar antes
    // evita um detector que nunca encontra nada e some com a leitura
    const formatos = (await Classe.getSupportedFormats?.()) ?? ['qr_code'];
    if (!formatos.includes('qr_code')) return null;
    return new Classe({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

export interface LeitorDeQR {
  /** Desliga a câmera e para o laço. Idempotente. */
  parar(): void;
  /** Qual decodificador está em uso — a tela mostra em letra miúda. */
  readonly motor: 'nativo' | 'javascript';
}

/**
 * Liga a câmera no `<video>` e chama `aoLer` a cada QR reconhecido.
 *
 * Quem decide o que fazer com repetição é a tela: aqui todo quadro com
 * código vira uma chamada, inclusive o mesmo código em quadros seguidos.
 */
export async function iniciarLeitor(
  video: HTMLVideoElement,
  aoLer: (texto: string) => void,
): Promise<LeitorDeQR> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Este navegador não dá acesso à câmera. Digite o código do ingresso.',
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    // `environment`: a câmera de trás. Sem isso o celular abre a frontal e
    // o operador fica se filmando enquanto a fila espera
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: LARGURA },
      height: { ideal: ALTURA },
    },
    audio: false,
  });

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true'); // iOS: sem isto abre em tela cheia
  await video.play();

  const nativo = await detectorNativo();
  const tela = document.createElement('canvas');
  const pincel = tela.getContext('2d', { willReadFrequently: true });

  let vivo = true;
  let ocupado = false;

  const analisar = async () => {
    if (!vivo || ocupado) return;
    const l = video.videoWidth;
    const a = video.videoHeight;
    if (!l || !a || !pincel) return;

    ocupado = true;
    try {
      tela.width = l;
      tela.height = a;
      pincel.drawImage(video, 0, 0, l, a);

      if (nativo) {
        const achados = await nativo.detect(tela);
        if (achados[0]?.rawValue) aoLer(achados[0].rawValue);
      } else {
        const { default: jsQR } = await import('jsqr');
        const px = pincel.getImageData(0, 0, l, a);
        // `dontInvert`: o QR do ingresso é preto no branco, sempre. Tentar
        // os dois sentidos dobraria o custo de cada quadro por nada
        const achado = jsQR(px.data, l, a, { inversionAttempts: 'dontInvert' });
        if (achado?.data) aoLer(achado.data);
      }
    } catch {
      // quadro ruim: o próximo vem em 125 ms. Erro aqui não derruba a tela
    } finally {
      ocupado = false;
    }
  };

  const relogio = window.setInterval(() => void analisar(), INTERVALO_MS);

  return {
    motor: nativo ? 'nativo' : 'javascript',
    parar() {
      if (!vivo) return;
      vivo = false;
      window.clearInterval(relogio);
      for (const faixa of stream.getTracks()) faixa.stop();
      video.srcObject = null;
    },
  };
}
