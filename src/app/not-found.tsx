import Link from "next/link";
export default function NotFound() {
  return (
    <main className="empty">
      <h1>Registro não encontrado</h1>
      <p>Ele pode não existir ou estar fora do seu acesso.</p>
      <Link className="text-link" href="/">
        Voltar ao dashboard
      </Link>
    </main>
  );
}
