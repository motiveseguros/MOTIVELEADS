import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "MOTIVE LEADS", template: "%s · MOTIVE LEADS" },
  description: "Central interna de leads da Motive Corretora",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
