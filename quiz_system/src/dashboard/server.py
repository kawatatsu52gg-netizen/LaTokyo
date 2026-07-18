"""
ローカル Dashboard サーバ（Python標準ライブラリのみ）。

一般ユーザーはブラウザのDashboardだけで操作する。APIは内部で既存CLIを呼ぶ。
起動: python -m src.pipeline dashboard [port]   （既定 8765）
"""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from . import stats, search, actions

STATIC = Path(__file__).resolve().parent / "static"


class Handler(BaseHTTPRequestHandler):
    server_version = "MedContentOS/1.0"

    def _send(self, obj, status=200, ctype="application/json"):
        if ctype == "application/json":
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        else:
            body = obj if isinstance(obj, bytes) else str(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if "json" in ctype or "html" in ctype or "text" in ctype else ""))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length", 0) or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def log_message(self, *a):  # 静かに
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html"):
                html = (STATIC / "index.html").read_text(encoding="utf-8")
                return self._send(html, ctype="text/html")
            if u.path in ("/game", "/game.html"):
                html = (STATIC / "game.html").read_text(encoding="utf-8")
                return self._send(html, ctype="text/html")
            if u.path == "/api/game":
                from ..content.beginner import build_course
                return self._send(build_course())
            if u.path == "/api/summary":
                return self._send(stats.dashboard_summary())
            if u.path == "/api/topics":
                return self._send(stats.topics())
            if u.path == "/api/daily":
                return self._send(stats.daily_report())
            if u.path == "/api/search":
                return self._send(search.search(q.get("q", [""])[0]))
            if u.path == "/api/review":
                return self._send(actions.review_items(q.get("kind", ["quiz"])[0]))
            if u.path == "/api/content":
                return self._send({"content": actions.get_content(q.get("path", [""])[0])})
            if u.path == "/api/research":
                from ..research import team
                return self._send(team.run_daily())
            if u.path == "/api/goals":
                from ..content.goals import audit
                return self._send(audit())
            return self._send({"error": "not found"}, 404)
        except Exception as e:
            return self._send({"error": str(e)}, 500)

    def do_POST(self):
        u = urlparse(self.path)
        b = self._body()
        try:
            if u.path == "/api/workflow":
                return self._send(actions.run_full_workflow())
            if u.path == "/api/approve":
                return self._send(actions.approve_quiz(b.get("id", "")))
            if u.path == "/api/reject":
                return self._send(actions.reject_quiz(b.get("id", "")))
            if u.path == "/api/edit":
                return self._send(actions.edit_quiz(b.get("id", ""), b.get("updates", {})))
            if u.path == "/api/design":
                from ..research.designer import design
                logs = []
                r = design(b.get("subject", ""), log=lambda m: logs.append(m))
                r["log"] = logs
                return self._send(r)
            return self._send({"error": "not found"}, 404)
        except Exception as e:
            return self._send({"error": str(e)}, 500)


def serve(port: int = 8765):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"医学コンテンツ制作OS Dashboard: http://127.0.0.1:{port}/  (Ctrl+Cで停止)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました。")
        httpd.shutdown()
