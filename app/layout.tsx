import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "우리집 관리비 | 월별 정산 도우미",
  description: "수도요금, 주차비, 관리비를 쉽고 정확하게 정산하는 개인용 계산기",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "우리집 관리비",
    description: "월별 정산을 한 번에",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
