"""
アーキタイプ別レンダラ。

Knowledge Bundle（KB由来の知識束）+ テンプレート仕様(spec) を受け取り、
各コンテンツ形式の Markdown を生成する。14形式は少数のアーキタイプに集約する:

  carousel / short_script / social_post / long_script / long_form /
  slide_deck / email_course / faq / chatbot

（quiz は既存のグラフ生成器に委譲するため generator 側で処理）

全レンダラは Bundle のみを入力とし、出典・エビデンス・安全注記を必ず付す。
"""
from __future__ import annotations

from ..kb.bundle import Bundle, source_citation


def _header(b: Bundle, spec: dict) -> list[str]:
    return [
        f"<!-- generated_from: Knowledge Base (Single Source of Truth) -->",
        f"<!-- subject={b.display_name} format={spec['format']} kb_version={b.kb_version} evidence={b.evidence_summary} -->",
        "",
    ]


def _sources_block(b: Bundle) -> list[str]:
    if not b.sources:
        return []
    out = ["", "### 出典（Knowledge Base より）"]
    for s in b.sources:
        out.append(f"- {source_citation(s)}")
    return out


def _safety_block(b: Bundle, short: bool = False) -> list[str]:
    if short:
        return ["", "⚠️ 個人差があります／対話と同意が前提／痛みが続けば受診を。"]
    return ["", "### 安全と配慮", *[f"- {n}" for n in b.safety_notes]]


def _facts(b: Bundle, n: int | None = None):
    fs = b.facts if n is None else b.facts[:n]
    return fs


# ---------------- carousel (Instagramカルーセル) ----------------
def render_carousel(b: Bundle, spec: dict) -> str:
    cfg = spec.get("config", {})
    max_slides = cfg.get("max_slides", 8)
    L = _header(b, spec)
    L += [f"# Instagramカルーセル：{b.display_name}", ""]
    L += [f"**スライド1（表紙）**", f"> {b.display_name}を正しく知る", "> 〜医学的に学ぶ女性の身体〜", ""]
    facts = _facts(b, max_slides - 3)
    for i, f in enumerate(facts, start=2):
        L += [f"**スライド{i}**",
              f"- {f.text}",
              f"  （根拠レベル{f.evidence}）", ""]
    L += [f"**スライド{len(facts)+2}（まとめ）**",
          "- 身体の理解は、対話と同意のための土台",
          "- 感じ方には大きな個人差があります", ""]
    L += [f"**スライド{len(facts)+3}（出典）**"]
    for s in b.sources:
        L.append(f"- {source_citation(s)}")
    L += _safety_block(b, short=True)
    tags = cfg.get("hashtags", [])
    if tags:
        L += ["", "**キャプション用ハッシュタグ**", " ".join(tags)]
    return "\n".join(L)


# ---------------- short_script (リール/ショート台本) ----------------
def render_short_script(b: Bundle, spec: dict) -> str:
    cfg = spec.get("config", {})
    L = _header(b, spec)
    L += [f"# {spec.get('label','ショート')}台本：{b.display_name}", "",
          f"想定尺: {cfg.get('seconds', 45)}秒 / 縦型", ""]
    L += ["**フック（0-3秒）**",
          f"「{b.display_name}、正しく説明できますか？」（画面テロップ）", ""]
    facts = _facts(b, cfg.get("points", 3))
    t = 3
    for i, f in enumerate(facts, start=1):
        L += [f"**ポイント{i}（{t}-{t+10}秒）**",
              f"ナレーション: {f.text}",
              f"テロップ: {f.text[:22]}…", ""]
        t += 10
    L += [f"**まとめ・CTA（{t}秒〜）**",
          "「大事なのは対話と同意。個人差があります」",
          "「詳しくはプロフィールのリンクへ」", ""]
    L += _safety_block(b, short=True)
    L += _sources_block(b)
    return "\n".join(L)


# ---------------- social_post (Threads / X) ----------------
def render_social_post(b: Bundle, spec: dict) -> str:
    cfg = spec.get("config", {})
    limit = cfg.get("max_chars", 280)
    L = _header(b, spec)
    L += [f"# {spec.get('label','投稿')}（{b.display_name}）／{limit}字目安・スレッド形式", ""]
    posts = []
    posts.append(f"{b.display_name}を医学的に。個人差が前提の話です🧵")
    for f in _facts(b, cfg.get("max_posts", 5)):
        txt = f.text
        if len(txt) > limit - 10:
            txt = txt[:limit - 11] + "…"
        posts.append(txt + f"（根拠{f.evidence}）")
    posts.append("痛みが続く時は受診を。対話と同意を大切に。")
    for i, p in enumerate(posts, start=1):
        flag = "⚠️" if len(p) > limit else ""
        L += [f"**{i}/{len(posts)}**（{len(p)}字{flag}）", p, ""]
    L += _sources_block(b)
    return "\n".join(L)


# ---------------- long_script (YouTube動画台本) ----------------
def render_long_script(b: Bundle, spec: dict) -> str:
    L = _header(b, spec)
    L += [f"# YouTube動画台本：{b.display_name}", "", "## 0. 導入（フック）",
          f"今日は「{b.display_name}」について、医学的な根拠に基づいて解説します。",
          "この動画は教育目的で、個人差と同意を大切にする立場でお話しします。", ""]
    for i, f in enumerate(_facts(b), start=1):
        L += [f"## {i}. {f.text[:24]}",
              f"- 解説: {f.text}",
              f"- 根拠レベル: {f.evidence}" + (f" / 出典: {', '.join(f.source_ids)}" if f.source_ids else ""),
              f"- B-roll/図解案: {b.display_name}の該当部位を図示", ""]
    L += ["## まとめ",
          "- 知識は相手を思いやる対話のためのもの",
          "- 感じ方は人により違う。正解を押し付けない", "",
          "## CTA", "チャンネル登録と、概要欄の参考文献もご覧ください。", ""]
    L += _safety_block(b)
    L += _sources_block(b)
    return "\n".join(L)


# ---------------- long_form (患者/整体師/ブログ) ----------------
def render_long_form(b: Bundle, spec: dict) -> str:
    aud = spec.get("audience", "一般")
    L = _header(b, spec)
    L += [f"# {b.display_name}について（{aud}向け）", "",
          f"※ この記事は Knowledge Base の検証済み情報（{b.evidence_summary}）から作成しています。", "",
          "## はじめに",
          f"{b.display_name}について、医学的な根拠に基づいてわかりやすく説明します。", "",
          "## ポイント"]
    for f in _facts(b):
        detail = "" if aud == "患者" else f"（根拠レベル{f.evidence}）"
        L.append(f"- {f.text}{detail}")
    if b.related:
        L += ["", "## 関連する用語"]
        for et, names in b.related.items():
            L.append(f"- {et}: {'、'.join(sorted(set(names)))}")
    L += ["", "## 個人差について",
          "- 形・大きさ・感じ方には大きな個人差があり、多くは正常の範囲です。"]
    L += ["", "## 受診の目安",
          "- 痛み・出血・持続する不快感がある場合は、我慢せず婦人科などへ相談してください。"]
    if aud in ("整体師", "医療従事者"):
        L += ["", "## 専門者向け補足",
              "- 徒手的介入で性機能障害を治療できると断定しないこと（医療と教育の区別）。",
              "- 骨盤底の評価は専門的トレーニングと適応判断のもとで行うこと。"]
    L += _safety_block(b)
    L += _sources_block(b)
    return "\n".join(L)


# ---------------- slide_deck (HALII Academyスライド) ----------------
def render_slide_deck(b: Bundle, spec: dict) -> str:
    L = _header(b, spec)
    L += [f"# HALII Academy スライド：{b.display_name}", "",
          "---", "## スライド1：タイトル",
          f"- {b.display_name}の医学的理解", "- HALII Academy 教育資料",
          "- 発表者ノート: 教育目的・個人差と同意の尊重を最初に明言", ""]
    for i, f in enumerate(_facts(b), start=2):
        L += ["---", f"## スライド{i}：{f.text[:24]}",
              f"- {f.text}",
              f"- 根拠レベル: {f.evidence}",
              f"- 発表者ノート: 出典 {', '.join(f.source_ids) or '—'} を口頭補足", ""]
    L += ["---", f"## スライド{len(_facts(b))+2}：まとめ",
          "- 知識は対話・同意・相互理解のための土台",
          "- 感じ方には個人差、正解を押し付けない", ""]
    L += ["---", f"## スライド{len(_facts(b))+3}：出典"]
    for s in b.sources:
        L.append(f"- {source_citation(s)}")
    return "\n".join(L)


# ---------------- email_course (メール講座) ----------------
def render_email_course(b: Bundle, spec: dict) -> str:
    cfg = spec.get("config", {})
    L = _header(b, spec)
    L += [f"# メール講座：{b.display_name}（全{min(len(_facts(b)), cfg.get('days',5))}回）", ""]
    facts = _facts(b, cfg.get("days", 5))
    for day, f in enumerate(facts, start=1):
        L += [f"## Day {day}",
              f"件名: 【{b.display_name}】{f.text[:18]}…",
              "本文:",
              f"こんにちは。今日のテーマは「{b.display_name}」の要点です。",
              f"- {f.text}（根拠レベル{f.evidence}）",
              "今日の一言: 感じ方には個人差があります。パートナーとの対話を大切に。",
              f"参考: {', '.join(f.source_ids) or 'Knowledge Base'}", ""]
    L += ["## 最終回：まとめ",
          "痛みや不安が続く場合は医療機関へ。学びは相互尊重のために。", ""]
    L += _sources_block(b)
    return "\n".join(L)


# ---------------- faq ----------------
def render_faq(b: Bundle, spec: dict) -> str:
    L = _header(b, spec)
    L += [f"# FAQ：{b.display_name}", ""]
    for i, f in enumerate(_facts(b), start=1):
        q = _to_question(f.text, b.display_name)
        L += [f"**Q{i}. {q}**",
              f"A. {f.text}（根拠レベル{f.evidence}／出典: {', '.join(f.source_ids) or 'KB'}）", ""]
    L += ["**Q. 痛みや違和感があるときは？**",
          "A. 我慢せず、婦人科などの医療機関に相談してください。個人差があり自己判断は禁物です。", ""]
    L += _sources_block(b)
    return "\n".join(L)


# ---------------- chatbot ----------------
def render_chatbot(b: Bundle, spec: dict) -> str:
    L = _header(b, spec)
    L += [f"# AIチャットボット回答テンプレート：{b.display_name}", "",
          "## 想定質問", f"「{b.display_name}について教えて」", "",
          "## 回答（KBのみを根拠に生成）",
          f"{b.display_name}について、医学的にわかっていることをお伝えします。"]
    for f in _facts(b, 5):
        L.append(f"- {f.text}")
    L += ["",
          "感じ方や反応には大きな個人差があります。特定のやり方が誰にでも当てはまるわけではありません。",
          "痛みや違和感が続く場合は、医療機関への相談をおすすめします。", "",
          "## 根拠・出典"]
    for s in b.sources:
        L.append(f"- {source_citation(s)}")
    L += ["", "## 安全フォールバック（KBに情報が無い/不確実な場合）",
          "「その点は確実な情報が確認できませんでした。医療者への相談をおすすめします。」"]
    return "\n".join(L)


def _to_question(statement: str, subject: str) -> str:
    s = statement.rstrip("。")
    return f"{s}って本当ですか？"


ARCHETYPES = {
    "carousel": render_carousel,
    "short_script": render_short_script,
    "social_post": render_social_post,
    "long_script": render_long_script,
    "long_form": render_long_form,
    "slide_deck": render_slide_deck,
    "email_course": render_email_course,
    "faq": render_faq,
    "chatbot": render_chatbot,
}
