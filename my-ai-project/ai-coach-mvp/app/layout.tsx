import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Repot AI",
  description: "AI 문서 작성/편집 워크스페이스",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
