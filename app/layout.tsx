import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Capy vs Capy: two capybaras haggle, PayPal holds the money",
  description:
    "Local secondhand deals where the buyer's agent and the seller's agent haggle for you. PayPal holds the buyer's money until the handoff.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbf5ea",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
