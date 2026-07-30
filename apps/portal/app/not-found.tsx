export default function NaoEncontrada() {
  return (
    <main className="miolo" style={{ padding: '64px 16px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 22 }}>Competição não encontrada</h1>
      <p style={{ color: 'var(--tinta2)', marginTop: 8, fontSize: 14 }}>
        O endereço pode estar errado — ou a competição ainda não foi publicada
        pelo organizador.
      </p>
    </main>
  );
}
