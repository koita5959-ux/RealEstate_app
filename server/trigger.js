// きっかけの察知（試験用・リリースでは外す）。2026-11-14
// 代替え地：客の言葉から「今の土地を手放して、郊外で広い土地を」の局面かを、ルールだけで判定する。
// 元は Claude.AI の試作 _works/2026-11-13_ClaudeAI_代替え地の察知ロジック/detector.py（v0.1）をそのまま移したもの。
// 返事や流れは変えない。発動したかを画面と記録で見えるようにするだけ。ほかのきっかけも TRIGGERS に同じ形で足す。

const SIGNALS = {
  // 手放す・売る系
  RELEASE: [/売(る|れ|り|却|っ|ろう)/g, /手放/g, /住み替え|買い替え|住みかえ|買いかえ/g, /相続(した|する|で)/g, /いくら(で|に)?(売|な)/g, /査定/g, /引っ越(す|し|そう)/g],
  // 広さを求める系（目的タグ付き）
  SPACE: [
    [/(手狭|狭(い|く|すぎ))/g, "住宅地_広さ"], [/広い(土地|家|庭|ところ)|もっと広/g, "住宅地_広さ"],
    [/庭(が|を|で|の|付き)|ガーデニング/g, "住宅地_庭"], [/家庭菜園/g, "住宅地_庭"], [/(畑|農業|農地|田んぼ)/g, "農地"],
    [/二世帯|親と(住|同居)|同居/g, "住宅地_二世帯"], [/車(が|を)?\s*(\d|二|三|もう)\s*台|駐車(場|スペース)/g, "住宅地_広さ"],
    [/部屋が足り|在宅(勤務|ワーク)の部屋|子ども部屋/g, "住宅地_広さ"], [/資材置|倉庫|作業場/g, "事業用"],
  ],
  // 郊外を受け入れる系
  SUBURB_OK: [/郊外/g, /田舎/g, /(少し|多少|ちょっと)(離れ|遠)/g, /静かな(ところ|場所|環境)/g, /自然(が|の)(多い|ある|豊か)/g, /車(が|さえ)?あれば/g, /駅から遠くても/g],
  // 逆向き（代替えを出すべきでない）
  BLOCK: [/駅(近|から近)/g, /通勤.{0,6}(優先|大事|譲れ|一番)/g, /(ここ|今の場所|この辺|地元).{0,8}(離れたくない|動きたくない|住み続け)/g, /学区.{0,6}(変えたくない|変わりたくない|このまま)/g],
  // 建物にこだわらない
  HOUSE_NOT_ATTACHED: [/(家|建物).{0,6}(古い|ボロ|解体|取り壊|こだわらない|どうでもいい)/g, /建て替え/g],
};
const LABEL = { RELEASE: "手放す", SPACE: "広さ", SUBURB_OK: "郊外でも", BLOCK: "逆向き", HOUSE_NOT_ATTACHED: "建物にこだわらない" };
// 意思の否定（つもり／気／予定＋ない）。手放す系・郊外系にだけ当てる
const NEGATION = /^.{0,2}(つもり|気|予定)?(は|も)?(ない|たくない|ません)/;
const NEGATABLE = new Set(["RELEASE", "SUBURB_OK"]);
const WEIGHTS = { RELEASE: 2, SPACE: 2, SUBURB_OK: 1, BLOCK: -4 };
const FIRE_SCORE = 4;

function match(text, cat) {
  const found = [];
  for (const p of SIGNALS[cat]) {
    const [re, tag] = Array.isArray(p) ? p : [p, null];
    for (const m of text.matchAll(re)) {
      if (NEGATABLE.has(cat) && NEGATION.test(text.slice(m.index + m[0].length))) continue; // 「売るつもりはない」等
      found.push({ word: m[0], tag, at: m.index });
    }
  }
  return found;
}

// utterances：客の発言（古い順）。land：土地評価が基本か（今は建物の情報を取っていないので、土地として扱う）
function altLand(utterances, land = { landOnly: true }) {
  const text = utterances.join("\n");
  const hits = Object.fromEntries(Object.keys(SIGNALS).map((c) => [c, match(text, c)]));
  // 効いた語の前後を少し添える（どの発言で効いたかを目で見るため）
  const near = (h) => text.slice(Math.max(0, h.at - 8), h.at + h.word.length + 8).replace(/\n/g, " ");
  const shown = Object.fromEntries(Object.entries(hits).filter(([, v]) => v.length).map(([c, v]) => [LABEL[c], v.map(near)]));

  const eligible = land.landOnly || (land.houseAge != null && land.houseAge > 20) || hits.HOUSE_NOT_ATTACHED.length > 0;
  if (!eligible) return { name: "代替え地", decision: "対象外", score: 0, hits: shown, purposes: [], reason: `築${land.houseAge}年の建物あり・建物へのこだわりを否定する発言なし` };

  let score = 0;
  for (const [c, w] of Object.entries(WEIGHTS)) score += w * Math.min(hits[c].length, 2); // 同じ話の繰り返しで膨らませない
  const purposes = [...new Set(hits.SPACE.map((h) => h.tag).filter(Boolean))].sort();
  const release = hits.RELEASE.length > 0, want = hits.SPACE.length > 0 || hits.SUBURB_OK.length > 0;
  let decision, reason;
  if (hits.BLOCK.length) [decision, reason] = ["不発", "逆向きの兆し（駅近・地元志向など）あり"];
  else if (release && want && score >= FIRE_SCORE) [decision, reason] = ["発動", "手放す系＋広さ/郊外系がそろった"];
  else if (release || want) [decision, reason] = ["保留", "片側の兆しのみ。会話の続きを待つ"];
  else [decision, reason] = ["不発", "兆しなし"];
  return { name: "代替え地", decision, score, hits: shown, purposes, reason };
}

const TRIGGERS = [altLand];

// messages：画面から届いた会話。客の発言だけを見る
export function detectTriggers(messages) {
  const utts = messages.filter((m) => m && m.role === "user" && typeof m.content === "string").map((m) => m.content);
  return TRIGGERS.map((f) => f(utts));
}
export { altLand };
