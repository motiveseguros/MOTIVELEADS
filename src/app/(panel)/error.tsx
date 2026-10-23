"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="panel empty" role="alert">
      <h2>Não foi possível carregar os dados.</h2>
      <p>Tente novamente. Se o problema continuar, procure o administrador.</p>
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
