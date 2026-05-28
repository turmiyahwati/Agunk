import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "PT SONTOLOYO — VPN / Xray Monitoring",
  description:
    "Premium real-time VPN & Xray server monitoring dashboard. Powered by PAKDE XRESX DIGITAL STORE.",
  applicationName: "PT SONTOLOYO Monitor",
  authors: [{ name: "PAKDE XRESX DIGITAL STORE" }],
  generator: "PT SONTOLOYO Monitor",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "PT SONTOLOYO — VPN / Xray Monitoring",
    description:
      "Realtime VPS health dashboard with futuristic glassmorphism UI.",
    siteName: "PT SONTOLOYO Monitor",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
