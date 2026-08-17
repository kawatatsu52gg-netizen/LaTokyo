import { Tag } from "./ui";

export interface DebateRow {
  round: number;
  step: number;
  agent: string;
  provider: string;
  model: string;
  output: unknown;
  cost_usd: number;
  latency_ms: number | null;
  error: string | null;
}

const AGENT_LABEL: Record<string, string> = {
  strategist: "① GPT Strategist — 一次案",
  critic: "② Claude Critic — 批判",
  integrator: "③ GPT Integrator — 採否判断と改稿",
  challenger: "④ Claude Challenger — 最終反証",
  judge: "⑤ Judge AI — 独立採点",
};

const AGENT_COLOR: Record<string, string> = {
  strategist: "#3ecf8e",
  critic: "#f2685c",
  integrator: "#5b9dff",
  challenger: "#f2b33d",
  judge: "#a78bfa",
};

/** Renders each agent's structured output in a shape a human can actually read
 *  — the raw JSON is kept behind a disclosure for when it matters. */
export function DebateThread({ rows }: { rows: DebateRow[] }) {
  const rounds = [...new Set(rows.map((r) => r.round))].sort();
  return (
    <div className="space-y-5">
      {rounds.map((round) => (
        <div key={round}>
          <h3 className="text-xs muted mb-2">ROUND {round}</h3>
          <div className="space-y-2">
            {rows
              .filter((r) => r.round === round)
              .sort((a, b) => a.step - b.step)
              .map((r, i) => (
                <article
                  key={i}
                  className="border-l-2 pl-3 py-1"
                  style={{ borderColor: AGENT_COLOR[r.agent] ?? "var(--line)" }}
                >
                  <header className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium" style={{ color: AGENT_COLOR[r.agent] }}>
                      {AGENT_LABEL[r.agent] ?? r.agent}
                    </span>
                    <Tag>{r.model}</Tag>
                    <span className="muted text-[11px]">
                      ${Number(r.cost_usd).toFixed(4)}
                      {r.latency_ms ? ` · ${(r.latency_ms / 1000).toFixed(1)}s` : ""}
                    </span>
                  </header>
                  {r.error ? (
                    <p className="text-xs" style={{ color: "var(--bad)" }}>
                      {r.error}
                    </p>
                  ) : (
                    <AgentOutput agent={r.agent} output={r.output} />
                  )}
                </article>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentOutput({ agent, output }: { agent: string; output: unknown }) {
  const o = (output ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);

  return (
    <div className="text-sm space-y-1.5">
      {agent === "strategist" && (
        <>
          <Body text={s("post_text")} />
          <Kv label="狙い" value={s("target_problem")} />
          <Kv label="仮説" value={s("hypothesis")} />
          <Kv label="理由" value={s("reason")} />
        </>
      )}

      {agent === "critic" && (
        <>
          <Kv label="全体所見" value={s("overall_read")} />
          {arr("critical_issues").length > 0 && (
            <IssueList label="致命的" items={arr("critical_issues")} color="var(--bad)" />
          )}
          {arr("minor_issues").length > 0 && (
            <IssueList label="軽微" items={arr("minor_issues")} color="var(--warn)" />
          )}
          <Kv label="Hook代案" value={s("alternative_hook")} />
          {s("duplicate_of_post_id") && (
            <Kv label="重複警告" value={`過去投稿 ${s("duplicate_of_post_id")} と重複`} />
          )}
        </>
      )}

      {agent === "integrator" && (
        <>
          {arr("decisions").length > 0 && (
            <ul className="text-xs space-y-0.5">
              {arr("decisions").map((d, i) => {
                const x = d as { issue_ref?: string; verdict?: string; reason?: string };
                const color =
                  x.verdict === "ACCEPT"
                    ? "var(--good)"
                    : x.verdict === "REJECT"
                      ? "var(--bad)"
                      : "var(--warn)";
                return (
                  <li key={i}>
                    <span style={{ color }}>{x.verdict}</span>{" "}
                    <span className="muted">{x.issue_ref}</span> — {x.reason}
                  </li>
                );
              })}
            </ul>
          )}
          <Body text={s("post_text")} />
        </>
      )}

      {agent === "challenger" && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            <Tag>判定: {s("verdict") ?? "—"}</Tag>
            <Tag>返信ハードル: {s("reply_barrier") ?? "—"}</Tag>
            <Tag>CTA: {s("cta_naturalness") ?? "—"}</Tag>
            <Tag>プロフ誘引: {s("profile_pull") ?? "—"}</Tag>
            {o.sales_smell === true && <Tag>営業臭あり</Tag>}
            {o.expert_posturing === true && <Tag>専門家ぶり</Tag>}
          </div>
          {arr("remaining_concerns").length > 0 && (
            <ul className="text-xs muted list-disc pl-4">
              {arr("remaining_concerns").map((c, i) => (
                <li key={i}>{String(c)}</li>
              ))}
            </ul>
          )}
          {s("stronger_hook_candidate") && (
            <Kv label="より強いHook案" value={s("stronger_hook_candidate")} />
          )}
        </>
      )}

      {agent === "judge" && (
        <>
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="text-lg tabular-nums">{String(o.total_score ?? "—")}</span>
            <span className="muted text-xs">/100</span>
            <Tag>{o.approved ? "PASS" : "FAIL"}</Tag>
            {o.major_issue === true && <Tag>major issue</Tag>}
            <Tag>確信度 {String(o.confidence ?? "—")}</Tag>
          </div>
          <Kv label="根拠" value={s("rationale")} />
          {arr("unresolved_issues").length > 0 && (
            <ul className="text-xs muted list-disc pl-4">
              {arr("unresolved_issues").map((c, i) => (
                <li key={i}>{String(c)}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <details className="mt-1">
        <summary className="muted text-[11px] cursor-pointer">raw JSON</summary>
        <pre className="text-[11px] muted overflow-x-auto mt-1 whitespace-pre-wrap">
          {JSON.stringify(output, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Body({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <pre className="body text-sm bg-[var(--panel-2)] rounded p-2.5 border border-[var(--line)]">
      {text}
    </pre>
  );
}

function Kv({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="text-xs">
      <span className="muted">{label}: </span>
      {value}
    </p>
  );
}

function IssueList({ label, items, color }: { label: string; items: unknown[]; color: string }) {
  return (
    <div className="text-xs">
      <span style={{ color }}>{label}</span>
      <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
        {items.map((it, i) => {
          const x = it as { id?: string; axis?: string; issue?: string; why_it_matters?: string };
          return (
            <li key={i}>
              <span className="muted">
                [{x.id}/{x.axis}]
              </span>{" "}
              {x.issue}
              {x.why_it_matters && <span className="muted"> — {x.why_it_matters}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
