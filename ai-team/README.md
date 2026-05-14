# AI team

Project-scoped Claude Code sub-agents for the LaTokyo Daikanyama
reservation page. Definitions live in `.claude/agents/`; this file is
the index — what each agent is for and when to invoke it.

## Roster

| Agent | When to use |
| --- | --- |
| `frontend-reviewer` | After any edit to `latokyo_reservation.html`. Catches hard-coded colors, font drift, broken step-flow state, and accidental architecture changes. |
| `ja-copy-editor` | When adding or editing Japanese UI strings (labels, buttons, errors, confirmations). Checks tone, keigo, and term consistency. |
| `a11y-auditor` | Before shipping changes that touch form controls, focus, or the step indicator. Contrast, keyboard nav, ARIA. |

## Invoking

From the Claude Code CLI in this repo:

```
> use the frontend-reviewer agent to review my changes
> ask ja-copy-editor to check the new confirmation screen copy
> have a11y-auditor audit the date-picker step
```

Claude Code will pick up the agent definitions from `.claude/agents/`
automatically.

## Adding a new agent

1. Create `.claude/agents/<name>.md` with YAML frontmatter
   (`name`, `description`, `tools`).
2. Keep the body focused: what to check, in what order, and what shape
   the output should take.
3. Add a row to the roster table above.

## Settings

`.claude/settings.json` holds the shared permission allowlist for this
repo (read-only git inspection, file edits). Destructive git commands
(`push --force`, `reset --hard`, `rm -rf`) are denied — override
locally in `.claude/settings.local.json` if you really need them.
