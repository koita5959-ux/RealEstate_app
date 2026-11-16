#!/usr/bin/env python3
"""タイプ1 初期設定（defaults.json）の点検と、紙の上の試し。Claude.AI 2026-11-16
使い方: python3 tryout.py            点検＋見本の土地3つ × 業務内容の組み合わせを表示
        python3 tryout.py --check    点検だけ
AIも通信も使わない。組み立ての決まり（企画書7-3）を、そのまま関数にしてある。
"""
import json, re, sys, pathlib

D = json.loads((pathlib.Path(__file__).parent / "defaults.json").read_text(encoding="utf-8"))
O, R = D["options"], D["rules"]
HOLE = re.compile(r"\{([^}]+)\}")


def check():
    errs = []
    for b, sets in D["sets"].items():
        if b not in D["businesses"]: errs.append(f"sets: 知らない業務内容 {b}")
        for k, ids in sets.items():
            if k not in D["categories"]: errs.append(f"sets[{b}]: 知らないカテゴリー {k}")
            if len(ids) > R["max"]: errs.append(f"sets[{b}][{k}]: {len(ids)}個（上限{R['max']}）")
            for i in ids:
                if i not in O: errs.append(f"sets[{b}][{k}]: 知らない選択肢 {i}")
                elif b not in O[i]["uke"]: errs.append(f"{i}: 業務内容 {b} の受けがない")
    for i, o in O.items():
        texts = [o["sub"], o["num"], o["ask"], *o["uke"].values(), *o.get("subWhen", {}).values()] + [n["reply"] for n in o["next"]]
        for t in texts:
            for h in HOLE.findall(t):
                if h not in D["holes"]: errs.append(f"{i}: 知らない穴 {{{h}}}")
        for f in o["facts"] + [g["tag"] for g in o.get("grey", [])] + list(o.get("subWhen", {})):
            if f not in D["tags"]: errs.append(f"{i}: 知らない条件札 {f}")
        for g in o.get("grey", []):
            if g["goto"] not in O: errs.append(f"{i}: 薄く出すときの行き先 {g['goto']} がない")
        if len(o["next"]) < 2: errs.append(f"{i}: 次の選択が2つ未満")
        if HOLE.search(o.get("subPlain", "{")): errs.append(f"{i}: 穴のない一行（subPlain）がない")
        if not o.get("plain") and all(HOLE.search(x) for x in re.findall(r"[^。]+。?", o["num"])): errs.append(f"{i}: データがないと返事の中身が空になる")
        for n in o["next"]:
            if all(HOLE.search(x) for x in re.findall(r"[^。]+。?", n["reply"])): errs.append(f"{i}／{n['label']}: データがないと返事が空になる")
        if not any(b in o["uke"] for b in D["businesses"]): errs.append(f"{i}: どの業務内容からも来ない")
    for r in R["tagBrings"] + R["firstMark"]:
        if r["tag"] not in D["tags"] or r["option"] not in O: errs.append(f"rules: {r}")
    for r in R["tagBrings"]:
        if "_" not in O[r["option"]]["uke"]: errs.append(f"{r['option']}: 条件札が連れてくるのに、業務内容によらない受け（_）がない")
    for r in R["firstMark"]:
        if not r.get("why"): errs.append(f"rules.firstMark {r['option']}: 理由がない")
    for t in D["tagFacts"]:
        if t not in D["tags"]: errs.append(f"tagFacts: 知らない条件札 {t}")
    return errs


def fill(text, land):
    """穴に値を入れる。値のない穴を含む文は、その一文ごと落とす（「現地で確認」には差し替えない）。"""
    out = []
    for s in re.findall(r"[^。]+。?", text):
        if all(land["data"].get(h) for h in HOLE.findall(s)):
            out.append(HOLE.sub(lambda m: str(land["data"][m.group(1)]), s))
    return "".join(out)


def compose(land, biz):
    """④の顔ぶれ。biz は重視する業務内容（順番つき）。"""
    ids, origin = [], {}
    for b in biz:                                   # 1番から埋め、重なりは一つに
        for i in D["sets"][b][land["cat"]]:
            if i not in origin: ids.append(i); origin[i] = b
    for r in R["tagBrings"]:                        # 条件札が連れてくる選択肢
        if r["tag"] in land["tags"] and r["option"] not in origin:
            ids.append(r["option"]); origin[r["option"]] = "札"
    ids = [i for i in ids if all(land["data"].get(h) for h in O[i].get("needs", []))]  # 材料のない選択肢は出さない
    grey = {i: g for i in ids for g in O[i].get("grey", []) if g["tag"] in land["tags"]}
    live = [i for i in ids if i not in grey]
    hit = next((r for r in R["firstMark"] if r["tag"] in land["tags"] and r["option"] in live and land["cat"] in r.get("cats", [land["cat"]])), None)
    first = (hit["option"], hit["why"]) if hit else None   # 決まりが当たったときだけ印。当たらなければ並び順だけ
    if first: live.remove(first[0]); live.insert(0, first[0])
    order = live + list(grey)                              # 薄く出すものは後ろへ
    return order[:R["max"]], order[R["max"]:], origin, first, grey


def show(land, biz):
    main, more, origin, first, grey = compose(land, biz)
    name = "＋".join(D["businesses"][b]["sub"] for b in biz)
    print(f"\n■ {land['name']}（{D['categories'][land['cat']]}）× 重視：{name}")
    for i in main:
        o = O[i]
        tag = f"［{D['businesses'][origin[i]]['sub']}］" if origin[i] in D["businesses"] else "［条件札］"
        if i in grey:
            print(f"   （薄く）{o['label']} ― {grey[i]['reason']} → 「{O[grey[i]['goto']]['label']}」を見る  {tag}")
            continue
        sub = next((v for t, v in o.get("subWhen", {}).items() if t in land["tags"]), o["sub"])
        mark = f"【{R['firstMarkLabel']}（{first[1]}）】" if first and i == first[0] else ""
        print(f"   {mark}{o['label']} ― {fill(sub, land) or o['subPlain']}  {tag}")
    if more: print(f"   {R['moreLabel']} → " + "、".join(O[i]["label"] for i in more))
    print(f"   {R['always'][0]}")
    return main, (first[0] if first else main[0]), origin


def reply(land, biz, i, origin):
    o = O[i]
    uke = o["uke"].get(origin[i]) or next((o["uke"][b] for b in biz if b in o["uke"]), o["uke"].get("_"))
    facts = "".join(fill(D["tagFacts"][t], land) for t in o["facts"] if t in land["tags"])[:200]
    print(f"\n   ▶「{o['label']}」を選んだときの返事")
    print(f"     受け　：{uke}")
    if facts: print(f"     土地　：{facts}")
    print(f"     中身　：{fill(o['num'], land) or o['plain']}")
    print(f"     問い　：{o['ask']}　" + " / ".join(n["label"] for n in o["next"]) + f" / {R['inquiryLabel']} / {R['always'][0]}")
    n = o["next"][0]
    print(f"     ▶「{n['label']}」→ {fill(n['reply'], land)}")
    print(f"       → ［{R['finalLabel']}］　{R['close']}")


LANDS = [
    {"name": "見本A 通路の狭い空き家", "cat": "K2", "tags": ["norebuild", "border"],
     "data": {"地域": "鷺山", "面積": "40坪（132㎡）", "単価": "6万2,000円", "変動": "−0.8％", "目安額": "570万円", "足し引き": "通路2m未満 −30％",
              "用途地域": "第一種住居地域", "容積率": "200％", "延べ床上限": "264㎡", "駅": "岐阜駅", "駅距離": "約3.4km", "台数": 5}},
    {"name": "見本B 角地の更地", "cat": "K3", "tags": ["corner", "shoparea"],
     "data": {"地域": "長良", "面積": "60坪（198㎡）", "単価": "8万5,000円", "変動": "＋0.6％", "目安額": "1,750万円", "足し引き": "角地 +4％",
              "用途地域": "第二種中高層住居専用地域", "容積率": "200％", "延べ床上限": "396㎡", "駅": "岐阜駅", "駅距離": "約4.1km", "台数": 7, "店の地区": "長良学区"}},
    {"name": "見本C 住んでいる家（公開データなし）", "cat": "K1", "tags": ["unsure"],
     "data": {"地域": "山あいの町", "面積": "120坪（397㎡）"}},
]

if __name__ == "__main__":
    errs = check()
    print("点検：" + ("問題なし" if not errs else f"{len(errs)}件"))
    for e in errs: print("  -", e)
    if "--check" in sys.argv or errs: sys.exit(1 if errs else 0)
    for land, biz in [(LANDS[0], ["b3"]), (LANDS[0], ["b1", "b4"]), (LANDS[1], ["b3"]), (LANDS[1], ["b2", "b3"]), (LANDS[2], ["b3"]), (LANDS[2], ["b1"])]:
        main, first, origin = show(land, biz)
        if first: reply(land, biz, first, origin)
