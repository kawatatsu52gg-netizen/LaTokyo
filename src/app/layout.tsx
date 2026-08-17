import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { isAuthed } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Threads Auto-Optimization",
  description: "個人サロン経営者向けThreads運用の自動最適化システム",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/posts", label: "投稿" },
  { href: "/heatmap", label: "ヒートマップ" },
  { href: "/patterns", label: "勝ちパターン" },
  { href: "/debates", label: "議論ログ" },
  { href: "/insights", label: "週次レポート" },
  { href: "/settings", label: "設定" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let authed = false;
  try {
    authed = await isAuthed();
  } catch {
    // env not configured yet — render the shell so /login is reachable
  }

  return (
    <html lang="ja">
      <body className="min-h-screen">
        {authed && (
          <nav className="border-b border-[var(--line)] sticky top-0 z-10 bg-[var(--bg)]/95 backdrop-blur">
            <div className="max-w-[1400px] mx-auto px-4 flex items-center gap-1 h-12 overflow-x-auto">
              <span className="text-xs font-semibold mr-3 whitespace-nowrap">Threads AO</span>
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="text-[13px] px-3 py-1.5 rounded hover:bg-[var(--panel-2)] whitespace-nowrap"
                >
                  {n.label}
                </Link>
              ))}
              <form action="/api/auth/logout" method="post" className="ml-auto">
                <button className="text-xs">ログアウト</button>
              </form>
            </div>
          </nav>
        )}
        <main className="max-w-[1400px] mx-auto p-4">{children}</main>
      </body>
    </html>
  );
}
