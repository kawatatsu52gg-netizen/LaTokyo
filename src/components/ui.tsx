import Link from "next/link";
import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  right,
  children,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel p-4">
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 mb-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide">{title}</h2>}
            {subtitle && <p className="muted text-xs mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const color =
    tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--text)";
  return (
    <div className="panel p-3">
      <div className="muted text-xs">{label}</div>
      <div className="text-2xl mt-1 tabular-nums" style={{ color }}>
        {value}
      </div>
      {hint && <div className="muted text-xs mt-1">{hint}</div>}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  PLANNED: "#6b7280",
  DRAFTING: "#8b5cf6",
  APPROVED: "#3ecf8e",
  SCHEDULED: "#3ecf8e",
  PUBLISHING: "#5b9dff",
  PUBLISHED: "#5b9dff",
  COLLECTING: "#5b9dff",
  EVALUATED: "#3ecf8e",
  NEEDS_HUMAN: "#f2b33d",
  REJECTED: "#f2685c",
  FAILED: "#f2685c",
};

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_TONE[status] ?? "#6b7280";
  return (
    <span
      className="text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap"
      style={{ color: c, borderColor: c, background: `${c}18` }}
    >
      {status}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--panel-2)] border border-[var(--line)] whitespace-nowrap">
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted text-sm py-6 text-center">{children}</p>;
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function PostLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link href={`/posts/${id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
      {children}
    </Link>
  );
}
