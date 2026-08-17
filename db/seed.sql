-- 分類マスタ・初期スロット・スコア重み

-- ---------- theme ----------
insert into taxonomy (dimension, value, label_ja, description, target_share, sort_order) values
 ('theme','acquisition','集客','新規顧客をどう増やすか', 0.40, 1),
 ('theme','retention','リピート','再来店率・関係維持',      0.25, 2),
 ('theme','revenue','売上・経営数字','単価/利益/資金繰り/KPI', 0.15, 3),
 ('theme','ai','AI・業務効率化','ChatGPT等の実務活用',      0.10, 4),
 ('theme','honest','経営者の本音・失敗談','弱さ・遠回り・実感', 0.10, 5)
on conflict (dimension, value) do nothing;

-- ---------- format (12種) ----------
insert into taxonomy (dimension, value, label_ja, description, sort_order) values
 ('format','paradox','逆説型','常識の逆を提示する', 1),
 ('format','diagnostic','診断型','当てはまるか読者に自己判定させる', 2),
 ('format','question','質問型','問いかけで始め、問いで終える', 3),
 ('format','number','数字型','具体的な数値を軸に語る', 4),
 ('format','failure','失敗談型','自分の失敗を開示する', 5),
 ('format','experience','実体験型','現場で見た事実を語る', 6),
 ('format','howto','ノウハウ型','手順・型を渡す', 7),
 ('format','problem','問題提起型','見落とされている構造を指摘', 8),
 ('format','before_after','Before/After型','変化の前後を対比', 9),
 ('format','ai_use','AI活用型','AIの具体的な使い方', 10),
 ('format','owner_relatable','経営者あるある型','共感の刺し方', 11),
 ('format','strong_opinion','強い意見型','はっきり立場を取る', 12)
on conflict (dimension, value) do nothing;

-- ---------- hook_type ----------
insert into taxonomy (dimension, value, label_ja, description, sort_order) values
 ('hook_type','contrarian','逆張り','「〜はやめた方がいい」', 1),
 ('hook_type','empathy','共感','「これ、ずっとしんどかった」', 2),
 ('hook_type','number_shock','数字インパクト','「3ヶ月で新規が0になった」', 3),
 ('hook_type','question_open','問いかけ','「なぜ〜だと思いますか」', 4),
 ('hook_type','confession','告白','「正直に言うと」', 5),
 ('hook_type','callout','名指し','「これやってる人、危ないです」', 6),
 ('hook_type','scene','情景','「23時、電卓を叩いていた」', 7),
 ('hook_type','warning','警告','「来年これが効かなくなります」', 8)
on conflict (dimension, value) do nothing;

-- ---------- cta_type ----------
insert into taxonomy (dimension, value, label_ja, description, sort_order) values
 ('cta_type','none','なし','CTAを置かない', 1),
 ('cta_type','question','質問で終える','返信ハードルが最も低い', 2),
 ('cta_type','reply_prompt','返信誘導','「どっちですか？」', 3),
 ('cta_type','profile','プロフィール誘導','余白でプロフへ', 4),
 ('cta_type','link','リンク','LINE/LPへ', 5),
 ('cta_type','dm','DM誘導','個別相談へ', 6)
on conflict (dimension, value) do nothing;

-- ---------- slot (初期6枠。正解ではなく初期事前分布) ----------
insert into taxonomy (dimension, value, label_ja, sort_order) values
 ('slot','06:30','朝イチ', 1),
 ('slot','08:30','出勤前', 2),
 ('slot','10:30','午前中', 3),
 ('slot','12:30','昼休み', 4),
 ('slot','15:30','午後の谷', 5),
 ('slot','21:30','夜', 6)
on conflict (dimension, value) do nothing;

-- ---------- length_bucket ----------
insert into taxonomy (dimension, value, label_ja, description, sort_order) values
 ('length_bucket','s','〜80字','短文', 1),
 ('length_bucket','m','81〜150字','中', 2),
 ('length_bucket','l','151〜300字','長め', 3),
 ('length_bucket','xl','301字〜','長文', 4)
on conflict (dimension, value) do nothing;

-- ---------- score weights ----------
insert into score_weights (version, weights, note, active) values
 ('v1_api_only',
  '{"reply_rate":30,"link_ctr":20,"repost_rate":20,"engagement_rate":20,"like_rate":10}'::jsonb,
  'Threads APIが投稿単位で返す指標＋自前計測のLink CTRのみで構成。運用初期の既定。',
  true),
 ('v2_full',
  '{"reply_rate":25,"profile_visit_rate":25,"follow_conversion_rate":20,"engagement_rate":15,"repost_rate":10,"link_ctr":5}'::jsonb,
  'プロフィール閲覧/フォローが投稿単位で埋まったら切替。相談への距離で重み付け。',
  false)
on conflict (version) do nothing;

-- ---------- 初期仮説 ----------
insert into hypotheses (statement, dimension, target_value, status, source) values
 ('逆説型Hookは共感型HookよりEngagement Rateが高い','hook_type','contrarian','untested','manual'),
 ('質問型フォーマットはReply Rateを押し上げる','format','question','untested','manual'),
 ('150字以下の投稿は長文より総合スコアが高い','length_bucket','m','untested','manual'),
 ('リピートテーマは表示回数は平均的だがプロフィール訪問率が高い','theme','retention','untested','manual'),
 ('21:30は表示回数が低いがReply Rateが高い','slot','21:30','untested','manual')
on conflict do nothing;
