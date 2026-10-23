import type { ReactNode, ComponentProps } from "react";
import { Input } from "./ui/input";
export function Field({
  label,
  name,
  ...props
}: ComponentProps<"input"> & { label: string; name: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <Input name={name} {...props} />
    </label>
  );
}
export function SelectField({
  label,
  name,
  children,
  ...props
}: ComponentProps<"select"> & {
  label: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} {...props}>
        {children}
      </select>
    </label>
  );
}
