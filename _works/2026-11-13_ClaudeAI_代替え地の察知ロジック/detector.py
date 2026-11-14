"""
代替え提案 察知ロジック（API不使用・ルールのみ） 試作 v0.1

目的:
  客の発話の流れから「今の土地を手放して、郊外で広い土地を」という
  代替え提案を出してよい局面かを、Claude API に投げずにプログラムだけで判定する。

判定の三層:
  1. 適格ゲート   … 物件が「土地評価が基本」か（土地のみ／築20年超／建物にこだわらない発言）
  2. 兆しの積算   … 手放す系・広さ系・郊外容認系を加点、逆向き（駅近・離れたくない）を減点
  3. 発動判定     … 発動 / 保留 / 不発。発動は会話中1回だけ
"""

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------
# 兆しの辞書（正規表現）。カテゴリ → [(パターン, 目的タグ or None)]
# ---------------------------------------------------------------
SIGNALS = {
    # 手放す・売る系
    "RELEASE": [
        (r"売(る|れ|り|却|っ|ろう)", None),
        (r"手放", None),
        (r"住み替え|買い替え|住みかえ|買いかえ", None),
        (r"相続(した|する|で)", None),
        (r"いくら(で|に)?(売|な)", None),
        (r"査定", None),
        (r"引っ越(す|し|そう)", None),
    ],
    # 広さを求める系（目的タグ付き）
    "SPACE": [
        (r"(手狭|狭(い|く|すぎ))", "住宅地_広さ"),
        (r"広い(土地|家|庭|ところ)|もっと広", "住宅地_広さ"),
        (r"庭(が|を|で|の|付き)|ガーデニング", "住宅地_庭"),
        (r"家庭菜園", "住宅地_庭"),
        (r"(畑|農業|農地|田んぼ)", "農地"),
        (r"二世帯|親と(住|同居)|同居", "住宅地_二世帯"),
        (r"車(が|を)?\s*(\d|二|三|もう)\s*台|駐車(場|スペース)", "住宅地_広さ"),
        (r"部屋が足り|在宅(勤務|ワーク)の部屋|子ども部屋", "住宅地_広さ"),
        (r"資材置|倉庫|作業場", "事業用"),
    ],
    # 郊外を受け入れる系
    "SUBURB_OK": [
        (r"郊外", None),
        (r"田舎", None),
        (r"(少し|多少|ちょっと)(離れ|遠)", None),
        (r"静かな(ところ|場所|環境)", None),
        (r"自然(が|の)(多い|ある|豊か)", None),
        (r"車(が|さえ)?あれば", None),
        (r"駅から遠くても", None),
    ],
    # 逆向き（代替えを出すべきでない）
    "BLOCK": [
        (r"駅(近|から近)", None),
        (r"通勤.{0,6}(優先|大事|譲れ|一番)", None),
        (r"(ここ|今の場所|この辺|地元).{0,8}(離れたくない|動きたくない|住み続け)", None),
        (r"学区.{0,6}(変えたくない|変わりたくない|このまま)", None),
    ],
    # 建物にこだわらない（築浅でも適格にする）
    "HOUSE_NOT_ATTACHED": [
        (r"(家|建物).{0,6}(古い|ボロ|解体|取り壊|こだわらない|どうでもいい)", None),
        (r"建て替え", None),
    ],
}

# 否定表現：一致箇所の直後に続いたら、その一致を打ち消す。
# v0.1 では「直後8文字以内の"ない"」にしたところ「庭を広くできないかな」まで打ち消してしまったため、
# 意思の否定（つもり／気／予定＋ない）に絞り、手放す系・郊外系にだけ適用する。
NEGATION = re.compile(r"^.{0,2}(つもり|気|予定)?(は|も)?(ない|たくない|ません)")
NEGATABLE = {"RELEASE", "SUBURB_OK"}

WEIGHTS = {"RELEASE": 2, "SPACE": 2, "SUBURB_OK": 1, "BLOCK": -4}

# 発動条件
FIRE_SCORE = 4          # 合計点
HOUSE_AGE_LAND_BASIS = 20  # 築年数がこれを超えれば土地評価が基本


@dataclass
class Property:
    land_only: bool = True          # 土地のみか
    house_age: int | None = None    # 建物ありなら築年数


@dataclass
class Result:
    decision: str                   # "発動" / "保留" / "不発" / "対象外" / "提示済み"
    score: int
    hits: dict = field(default_factory=dict)
    purposes: list = field(default_factory=list)
    reason: str = ""


def _match(text: str, category: str):
    """カテゴリの兆しを拾う。否定が直後に続くものは除外。"""
    found = []
    for pat, tag in SIGNALS[category]:
        for m in re.finditer(pat, text):
            tail = text[m.end():]
            if category in NEGATABLE and NEGATION.match(tail):
                continue  # 「売るつもりはない」等
            found.append((m.group(0), tag))
    return found


def detect(utterances: list[str], prop: Property, already_offered: bool = False) -> Result:
    if already_offered:
        return Result("提示済み", 0, reason="代替え提案は会話中1回だけ")

    text = "\n".join(utterances)
    hits = {c: _match(text, c) for c in SIGNALS}

    # 1. 適格ゲート
    eligible = prop.land_only or (prop.house_age is not None and prop.house_age > HOUSE_AGE_LAND_BASIS)
    if not eligible and hits["HOUSE_NOT_ATTACHED"]:
        eligible = True
    if not eligible:
        return Result("対象外", 0, {k: v for k, v in hits.items() if v},
                      reason=f"築{prop.house_age}年の建物あり・建物へのこだわりを否定する発言なし")

    # 2. 兆しの積算（カテゴリごとに最大2件まで数える＝同じ話の繰り返しで膨らませない）
    score = 0
    for cat, w in WEIGHTS.items():
        score += w * min(len(hits[cat]), 2)

    purposes = sorted({tag for _, tag in hits["SPACE"] if tag})

    # 3. 発動判定
    has_release = bool(hits["RELEASE"])
    has_want = bool(hits["SPACE"]) or bool(hits["SUBURB_OK"])
    has_block = bool(hits["BLOCK"])

    if has_block:
        decision, reason = "不発", "逆向きの兆し（駅近・地元志向など）あり"
    elif has_release and has_want and score >= FIRE_SCORE:
        decision, reason = "発動", "手放す系＋広さ/郊外系がそろった"
    elif has_release or has_want:
        decision, reason = "保留", "片側の兆しのみ。会話の続きを待つ"
    else:
        decision, reason = "不発", "兆しなし"

    return Result(decision, score, {k: v for k, v in hits.items() if v}, purposes, reason)
