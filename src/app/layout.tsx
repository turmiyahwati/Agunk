import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "PT Sontoloyo";
const SUFFIX = process.env.NEXT_PUBLIC_BRAND_SUFFIX || "Monitor";
const AUTHOR = process.env.NEXT_PUBLIC_AUTHOR || "Pakde Xresx Digital Store";

export const metadata: Metadata = {
  title: `${BRAND} ${SUFFIX} — VPN / Xray Realtime`,
  description: `${BRAND} ${SUFFIX} — premium realtime VPN & Xray server monitoring panel oleh ${AUTHOR}.`,
  authors: [{ name: AUTHOR }],
  applicationName: `${BRAND} ${SUFFIX}`,
  generator: BRAND,
  keywords: ["vpn monitoring", "xray monitoring", "server status", "realtime panel"],
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: `${BRAND} ${SUFFIX}`,
    description: "Realtime VPN/Xray monitoring panel",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
