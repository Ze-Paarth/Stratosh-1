import "./globals.css";
import { Manrope } from "next/font/google";

const sans = Manrope({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = { title: "Stratosh", description: "AI business and market decision advisor" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
