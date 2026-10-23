"use client";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import type { ActionState } from "@/domain/validation";
import { Button } from "./ui/button";
export type FormAction = (
  state: ActionState,
  form: FormData,
) => Promise<ActionState>;
function Submit({
  label,
  destructive,
}: {
  label: string;
  destructive?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      variant={destructive ? "destructive" : "default"}
    >
      {pending && <LoaderCircle className="animate-spin" />}
      {pending ? "Salvando…" : label}
    </Button>
  );
}
export function ActionForm({
  action,
  children,
  label = "Salvar",
  className = "",
  destructive = false,
}: {
  action: FormAction;
  children: ReactNode;
  label?: string;
  className?: string;
  destructive?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={"space-y-4 " + className}>
      {children}
      <div aria-live="polite">
        {state.error && (
          <p role="alert" className="notice error">
            {state.error}
          </p>
        )}
        {state.success && (
          <p role="status" className="notice success">
            {state.success}
          </p>
        )}
      </div>
      <Submit label={label} destructive={destructive} />
    </form>
  );
}
