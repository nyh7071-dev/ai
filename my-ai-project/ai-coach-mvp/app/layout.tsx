import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      {/* 아래처럼 body 태그에 suppressHydrationWarning={true} 를 추가하세요 */}
      <body 
        className="antialiased" 
        suppressHydrationWarning={true} 
      >
        {children}
      </body>
    </html>
  );
}
