export default function Home() {
  return (
    <main className="miolo" style={{ padding: '64px 16px' }}>
      <h1 style={{ fontSize: 28 }}>⚽ ApitoFut</h1>
      <p style={{ color: 'var(--tinta2)', marginTop: 8 }}>
        Cada competição vive no seu próprio endereço: <code>/{'{slug}'}</code>.
      </p>
    </main>
  );
}
