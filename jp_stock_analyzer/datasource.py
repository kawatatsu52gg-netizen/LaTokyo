"""
datasource.py
-------------
IRBANK を主データ源とし、取得できない項目は Yahoo!ファイナンス / 株探 で補完して
1銘柄分のファンダメンタルズを返すモジュール。

方針:
  * HTML 構造の細かな変更に強いよう、セレクタ決め打ちではなく
    「年度っぽいヘッダ行」+「ラベルに一致する行」を全テーブルから総当たりで探す。
  * どのサイトも取れなければ例外を投げ、呼び出し側(analyze.py)がスキップして
    エラー一覧に記録する。

返り値 StockData の各フィールドは取得できなければ None のまま。
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/122.0 Safari/537.36"),
    "Accept-Language": "ja,en;q=0.8",
}

# EPS / 各指標のラベル別名(サイトごとの表記ゆれを吸収)
LABELS = {
    "eps":          ["EPS", "1株益", "一株益", "1株利益", "一株利益", "1株当たり利益"],
    "roe":          ["ROE", "自己資本利益率"],
    "op_margin":    ["営業利益率"],
    "equity_ratio": ["自己資本比率"],
    "ocf":          ["営業CF", "営業キャッシュフロー", "営業活動によるキャッシュ", "営業活動CF"],
    "per":          ["PER", "株価収益率"],
    "pbr":          ["PBR", "株価純資産倍率"],
    "div_yield":    ["配当利回り", "利回り"],
}

_YEAR_RE = re.compile(r"(19|20)\d{2}\s*[/.\-年]?\s*\d{0,2}")
_NUM_RE = re.compile(r"-?[\d,]+(?:\.\d+)?")


@dataclass
class StockData:
    code: str
    name: Optional[str] = None
    eps_series: list[Optional[float]] = field(default_factory=list)  # 古い→新しい
    eps_forecast: Optional[float] = None
    per: Optional[float] = None
    pbr: Optional[float] = None
    roe: Optional[float] = None
    div_yield: Optional[float] = None
    op_margin: Optional[float] = None
    equity_ratio: Optional[float] = None
    ocf_latest: Optional[float] = None
    ocf_positive_years: Optional[int] = None
    ocf_total_years: Optional[int] = None
    sources: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 低レベル: 取得ユーティリティ
# ---------------------------------------------------------------------------
def _get(url: str, session: requests.Session, retries: int = 3,
         timeout: int = 20) -> Optional[BeautifulSoup]:
    """GET してパース。失敗時はバックオフして再試行、最終的に None。"""
    for attempt in range(retries):
        try:
            r = session.get(url, headers=HEADERS, timeout=timeout)
            if r.status_code == 200 and r.text:
                return BeautifulSoup(r.text, "lxml")
        except requests.RequestException:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def _to_float(s: str) -> Optional[float]:
    if s is None:
        return None
    s = s.strip().replace(",", "").replace("円", "").replace("%", "").replace("倍", "")
    if s in ("", "-", "―", "--", "N/A", "－"):
        return None
    m = _NUM_RE.search(s)
    if not m:
        return None
    # 三角記号(▲/△)や括弧はマイナス
    neg = ("▲" in s) or ("△" in s) or ("(" in s and ")" in s) or s.strip().startswith("-")
    try:
        val = float(m.group().replace(",", ""))
    except ValueError:
        return None
    return -abs(val) if neg else val


def _label_matches(text: str, aliases: list[str]) -> bool:
    t = text.replace(" ", "")
    return any(a.replace(" ", "") in t for a in aliases)


# ---------------------------------------------------------------------------
# 汎用テーブル解析: 年度ヘッダ行 + ラベル行 → {label: [値...]}
# ---------------------------------------------------------------------------
def _extract_row_series(soup: BeautifulSoup, aliases: list[str]) -> list[float]:
    """
    全テーブルを走査し、先頭セルが aliases に一致する行を見つけ、
    その行の数値セル列を古い→新しい順で返す。複数見つかれば最長を採用。
    """
    best: list[float] = []
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            head = cells[0].get_text(strip=True)
            if not _label_matches(head, aliases):
                continue
            nums = []
            for c in cells[1:]:
                v = _to_float(c.get_text(strip=True))
                if v is not None:
                    nums.append(v)
            if len(nums) > len(best):
                best = nums
    return best


def _extract_single(soup: BeautifulSoup, aliases: list[str]) -> Optional[float]:
    """
    「ラベル : 値」形式(定義リストやサマリーテーブル)から単一値を探す。
    """
    # dt/dd, th/td の隣接ペアを総当たり
    for tag in soup.find_all(["th", "dt", "td"]):
        txt = tag.get_text(strip=True)
        if not _label_matches(txt, aliases):
            continue
        nxt = tag.find_next_sibling(["td", "dd"])
        if nxt is not None:
            v = _to_float(nxt.get_text(strip=True))
            if v is not None:
                return v
    return None


# ---------------------------------------------------------------------------
# IRBANK
# ---------------------------------------------------------------------------
def fetch_irbank(code: str, session: requests.Session) -> StockData:
    data = StockData(code=code)
    base = f"https://irbank.net/{code}"

    top = _get(base, session)
    if top is not None:
        title = top.find("title")
        if title:
            # 例: "INPEX（1605）の株式情報 | IRBANK"
            m = re.match(r"\s*(.+?)[（(]", title.get_text())
            if m:
                data.name = m.group(1).strip()
        # サマリーから PER/PBR/利回り/ROE を拾う
        data.per = _extract_single(top, LABELS["per"])
        data.pbr = _extract_single(top, LABELS["pbr"])
        data.roe = _extract_single(top, LABELS["roe"])
        data.div_yield = _extract_single(top, LABELS["div_yield"])
        data.sources.append(base)

    # 決算まとめ(業績・EPS・営業利益率・自己資本比率・営業CF)
    results = _get(f"{base}/results", session)
    if results is not None:
        eps = _extract_row_series(results, LABELS["eps"])
        if eps:
            data.eps_series = eps
        om = _extract_row_series(results, LABELS["op_margin"])
        if om:
            data.op_margin = om[-1]
        eq = _extract_row_series(results, LABELS["equity_ratio"])
        if eq:
            data.equity_ratio = eq[-1]
        ocf = _extract_row_series(results, LABELS["ocf"])
        if ocf:
            data.ocf_latest = ocf[-1]
            data.ocf_positive_years = sum(1 for x in ocf if x > 0)
            data.ocf_total_years = len(ocf)
        if data.roe is None:
            roe = _extract_row_series(results, LABELS["roe"])
            if roe:
                data.roe = roe[-1]
        data.sources.append(f"{base}/results")

    return data


# ---------------------------------------------------------------------------
# Yahoo!ファイナンス(補完用)
# ---------------------------------------------------------------------------
def fetch_yahoo(code: str, session: requests.Session, data: StockData) -> None:
    soup = _get(f"https://finance.yahoo.co.jp/quote/{code}.T", session)
    if soup is None:
        return
    if data.name is None:
        h1 = soup.find("h1")
        if h1:
            data.name = re.sub(r"[（(].*", "", h1.get_text(strip=True)).strip() or None
    if data.per is None:
        data.per = _extract_single(soup, LABELS["per"])
    if data.pbr is None:
        data.pbr = _extract_single(soup, LABELS["pbr"])
    if data.div_yield is None:
        data.div_yield = _extract_single(soup, LABELS["div_yield"])
    data.sources.append(f"yahoo:{code}")


# ---------------------------------------------------------------------------
# 株探(補完用: EPS 予想など)
# ---------------------------------------------------------------------------
def fetch_kabutan(code: str, session: requests.Session, data: StockData) -> None:
    soup = _get(f"https://kabutan.jp/stock/finance?code={code}", session)
    if soup is None:
        return
    if not data.eps_series:
        eps = _extract_row_series(soup, LABELS["eps"])
        if eps:
            data.eps_series = eps
    if data.eps_forecast is None and data.eps_series:
        # 株探の予想行(「予」を含む行)を拾えれば forecast に
        for table in soup.find_all("table"):
            for tr in table.find_all("tr"):
                cells = tr.find_all(["th", "td"])
                if cells and "予" in cells[0].get_text():
                    for c in cells:
                        v = _to_float(c.get_text(strip=True))
                        if v is not None:
                            data.eps_forecast = v
    data.sources.append(f"kabutan:{code}")


# ---------------------------------------------------------------------------
# 公開エントリポイント
# ---------------------------------------------------------------------------
def fetch_stock(code: str, session: Optional[requests.Session] = None,
                use_yahoo: bool = True, use_kabutan: bool = True) -> StockData:
    """
    1銘柄分を取得。IRBANK を主に、欠損は Yahoo / 株探 で補完。
    どうしても核心データ(EPS系列)が空なら ValueError を送出。
    """
    own = session is None
    session = session or requests.Session()
    try:
        data = fetch_irbank(code, session)
        if use_kabutan and (not data.eps_series or data.eps_forecast is None):
            fetch_kabutan(code, session, data)
        if use_yahoo and (data.per is None or data.pbr is None
                          or data.div_yield is None or data.name is None):
            fetch_yahoo(code, session, data)
    finally:
        if own:
            session.close()

    if not data.eps_series:
        raise ValueError(f"{code}: EPS系列を取得できませんでした")
    return data
