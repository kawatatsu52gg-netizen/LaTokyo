#!/usr/bin/env node
/*
 * 医学コンテンツ制作OS 開発ランチャー
 *
 * `npm run dev` で:
 *   1) Python(バックエンド)の存在を確認
 *   2) 初回データを用意（kb.db / quiz.db が無ければ ingest→KB構築→クイズ生成）
 *   3) ブラウザ用Dashboardサーバを起動
 *
 * バックエンドは Python 標準ライブラリのみで動くため npm 依存パッケージは不要
 * （npm install はオフラインでも一瞬で完了する）。
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');          // quiz_system/
const PY = process.env.PYTHON || 'python3';
const PORT = process.env.PORT || '8765';
const KB_DB = path.join(ROOT, 'data', 'database', 'kb.db');
const QUIZ_DB = path.join(ROOT, 'data', 'database', 'quiz.db');
const bootstrapOnly = process.argv.includes('--bootstrap-only');

function step(msg) { console.log(`\x1b[36m▸ ${msg}\x1b[0m`); }
function fail(msg) { console.error(`\x1b[31m✗ ${msg}\x1b[0m`); process.exit(1); }

function pipeline(args, opts = {}) {
  return spawnSync(PY, ['-m', 'src.pipeline', ...args], {
    cwd: ROOT, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf-8',
  });
}

// --- 1) Python 確認 ---
const ver = spawnSync(PY, ['--version'], { encoding: 'utf-8' });
if (ver.status !== 0) {
  fail(`Python が見つかりません（${PY}）。Python 3.10+ を入れるか PYTHON 環境変数で指定してください。`);
}
step(`バックエンド: ${ver.stdout.trim() || ver.stderr.trim()}`);

// --- 2) 初回データ用意（冪等）---
const needQuiz = !fs.existsSync(QUIZ_DB);
const needKb = !fs.existsSync(KB_DB);
if (needQuiz || needKb || bootstrapOnly) {
  step('初回データを準備します（NotebookLMサンプル→取り込み→検証反映→クイズ生成→KB構築）…');
  // 取り込み〜手書きクイズ生成〜集計（quiz.db を作る）
  pipeline(['run-all']);
  // Knowledge Base を構築（kb.db を作る）
  pipeline(['kb-build']);
  // ナレッジグラフから Evidence A のクイズを自動生成（Review Centerの材料）
  pipeline(['kb-generate', 'A']);
  step('データ準備が完了しました。');
} else {
  step('既存の Knowledge Base を使用します（再準備は npm run bootstrap）。');
}

if (bootstrapOnly) {
  step('bootstrap のみ実行しました。');
  process.exit(0);
}

// --- 3) Dashboard 起動 ---
step(`Dashboard を起動します → http://127.0.0.1:${PORT}/`);
console.log('  停止するには Ctrl+C を押してください。\n');
const srv = spawn(PY, ['-m', 'src.pipeline', 'dashboard', PORT], {
  cwd: ROOT, stdio: 'inherit',
});
const stop = () => { try { srv.kill('SIGINT'); } catch (e) {} };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
srv.on('exit', (code) => process.exit(code || 0));
