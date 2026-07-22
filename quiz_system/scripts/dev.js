#!/usr/bin/env node
/*
 * 医学コンテンツ制作OS 開発ランチャー
 *
 * `npm run dev` で:
 *   1) Python(バックエンド)を自動検出（python3 / python / py -3）
 *   2) 初回データを用意（kb.db / quiz.db が無ければ ingest→KB構築→クイズ生成）
 *   3) 空いているポートを選び、Dashboardサーバを起動
 *
 * バックエンドは Python 標準ライブラリのみで動くため npm 依存パッケージは不要。
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');            // quiz_system/
const WANT_PORT = parseInt(process.env.PORT || '8765', 10);
const KB_DB = path.join(ROOT, 'data', 'database', 'kb.db');
const QUIZ_DB = path.join(ROOT, 'data', 'database', 'quiz.db');
const bootstrapOnly = process.argv.includes('--bootstrap-only');

function step(m) { console.log(`\x1b[36m▸ ${m}\x1b[0m`); }
function warn(m) { console.log(`\x1b[33m! ${m}\x1b[0m`); }
function fail(m) { console.error(`\x1b[31m✗ ${m}\x1b[0m`); process.exit(1); }

// --- 1) Python を自動検出（OS差を吸収） ---
function resolvePython() {
  if (process.env.PYTHON) return { cmd: process.env.PYTHON, pre: [] };
  const cands = [
    { cmd: 'python3', pre: [] },
    { cmd: 'python', pre: [] },
    { cmd: 'py', pre: ['-3'] },
  ];
  for (const c of cands) {
    try {
      const r = spawnSync(c.cmd, [...c.pre, '--version'], { encoding: 'utf-8' });
      if (r.status === 0) return c;
    } catch (e) { /* try next */ }
  }
  return null;
}

const PY = resolvePython();
if (!PY) {
  fail('Python が見つかりません（python3 / python / py を試しました）。\n' +
       '  Python 3.10 以上をインストールするか、環境変数 PYTHON で実行パスを指定してください。\n' +
       '  例) PYTHON=/usr/bin/python3 npm run dev');
}
function pipeline(args, opts = {}) {
  return spawnSync(PY.cmd, [...PY.pre, '-m', 'src.pipeline', ...args],
    { cwd: ROOT, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf-8' });
}
const ver = spawnSync(PY.cmd, [...PY.pre, '--version'], { encoding: 'utf-8' });
step(`バックエンド: ${(ver.stdout || ver.stderr || '').trim()} （${PY.cmd}）`);

// --- 2) 初回データ用意（冪等） ---
if (!fs.existsSync(QUIZ_DB) || !fs.existsSync(KB_DB) || bootstrapOnly) {
  step('初回データを準備します（サンプル取り込み→検証反映→クイズ生成→KB構築）…');
  pipeline(['run-all']);
  pipeline(['kb-build']);
  pipeline(['kb-generate', 'A']);
  step('データ準備が完了しました。');
} else {
  step('既存の Knowledge Base を使用します（再準備は npm run bootstrap）。');
}
if (bootstrapOnly) { step('bootstrap のみ実行しました。'); process.exit(0); }

// --- 3) 空きポートを探して起動 ---
function findFreePort(start, tries = 15) {
  return new Promise((resolve, reject) => {
    let port = start, attempts = 0;
    const tryPort = () => {
      const srv = net.createServer();
      srv.once('error', () => {
        srv.close();
        if (++attempts >= tries) return reject(new Error('空きポートが見つかりません'));
        port += 1; tryPort();
      });
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

findFreePort(WANT_PORT).then((port) => {
  if (port !== WANT_PORT) warn(`ポート ${WANT_PORT} は使用中のため ${port} で起動します。`);
  step(`Dashboard を起動します → http://127.0.0.1:${port}/`);
  console.log(`  Lesson1（教材）: http://127.0.0.1:${port}/lesson1`);
  console.log('  停止するには Ctrl+C を押してください。\n');
  const srv = spawn(PY.cmd, [...PY.pre, '-m', 'src.pipeline', 'dashboard', String(port)],
    { cwd: ROOT, stdio: 'inherit' });
  const stop = () => { try { srv.kill('SIGINT'); } catch (e) {} };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  srv.on('exit', (code) => process.exit(code || 0));
}).catch((e) => fail(String(e.message || e)));
