import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OposAI",
  description: "Test rápido",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}