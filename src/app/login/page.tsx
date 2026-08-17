export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="max-w-sm mx-auto mt-24">
      <div className="panel p-6">
        <h1 className="text-lg font-semibold mb-1">Threads Auto-Optimization</h1>
        <p className="muted text-xs mb-5">管理画面にログイン</p>
        <form action="/api/auth/login" method="post" className="space-y-3">
          <input
            type="password"
            name="password"
            placeholder="パスワード"
            autoFocus
            required
            autoComplete="current-password"
          />
          {error && (
            <p className="text-xs" style={{ color: "var(--bad)" }}>
              パスワードが違います
            </p>
          )}
          <button className="btn-primary w-full" type="submit">
            ログイン
          </button>
        </form>
      </div>
    </div>
  );
}
