import type { Metadata } from 'next';
import { Pedido } from './Pedido';

/**
 * O pedido de quem comprou (RF035, fase 2).
 *
 * `noindex`: é o acompanhamento de uma compra, alcançado por link
 * direto. O id do pedido é um uuid — é ele que faz as vezes de senha,
 * como o código do ingresso.
 *
 * A casca é servidor; o miolo é cliente, porque precisa perguntar de
 * quatro em quatro segundos se o pagamento caiu.
 */
export const metadata: Metadata = {
  title: 'Seu pedido',
  robots: { index: false, follow: false },
};

export default async function PaginaDoPedido({
  params,
}: {
  params: Promise<{ pedidoId: string }>;
}) {
  const { pedidoId } = await params;

  return (
    <main>
      <header className="faixa">
        <div className="miolo">
          <span className="pill">Pedido</span>
          <h1 style={{ fontSize: 22, marginTop: 6 }}>Acompanhe sua compra</h1>
        </div>
      </header>

      <div className="miolo" style={{ paddingBottom: 40 }}>
        <Pedido pedidoId={pedidoId} />
      </div>

      <footer style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
        Compra processada pela plataforma <b>ApitoFut</b>
      </footer>
    </main>
  );
}
