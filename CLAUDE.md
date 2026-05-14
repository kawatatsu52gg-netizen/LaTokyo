# LaTokyo Daikanyama — Reservation Page

Single-file reservation flow for the LaTokyo Daikanyama restaurant. The
entire app currently lives in `latokyo_reservation.html`: HTML structure,
inline CSS (CSS variables for the cream/gold/dark palette), and inline
JavaScript for the multi-step booking flow.

## Conventions

- Copy is in Japanese (`lang="ja"`). Preserve Japanese UI strings; do not
  silently translate them.
- Visual system uses CSS variables in `:root` (`--cream`, `--dark`,
  `--gold`, `--muted`, `--light-line`, `--card-bg`, `--selected`). Use
  these instead of hard-coded colors.
- Typography: `Cormorant Garamond` for Latin headings, `Noto Serif JP`
  for body. Don't introduce new font families without a reason.
- Keep the page a single self-contained file unless the task explicitly
  asks to split it.

## AI team

Project sub-agents live in `.claude/agents/`. See `ai-team/README.md`
for what each one is for and when to invoke it.
