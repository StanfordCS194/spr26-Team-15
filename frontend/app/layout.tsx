import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CS194W Legal Discovery",
  description: "AI-powered legal discovery and case strategy prototype",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
