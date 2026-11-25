// ---- 査定スキル（建物の簡易の見立て）。3タイプ共通のオプション、初期ON・店がOFFにすると今までと同じ ----
// 仕様：_works/2026-11-24_ClaudeAI_査定スキル仕様書.md、返事 _works/2026-11-24_ClaudeCode_査定スキル仕様書への返事.md
// 設問（建物の種類・つくり・年数・広さ・手入れ）を「いまの使われ方」の下に足す。TYPE2・3は建物の値を計算してAIへ渡す（AIは値を話すだけ）。TYPE1は答えを記録するだけ。
// OFF のときは何も足さない（設問・データシート・AIへ送る中身とも、dev と同じ）。
// 設定はこのブラウザの reSatei（{ on, demolish }）。管理画面・お試し設定の「査定スキル」の欄で変える。

const SATEI = (() => { try { return { on:true, demolish:"", ...JSON.parse(localStorage.getItem("reSatei") || "{}") }; } catch (e) { return { on:true, demolish:"" }; } })();
const SATEI_T = /\/1_select_/.test(location.pathname) ? 1 : 2; // TYPE1 は記録だけ、TYPE2・3 は計算する

// 表A：建て直したらいくらかの単価（千円/㎡）。国税庁「建物の標準的な建築価額表」令和5年（年に一度、手で差し替える）
// 表B：年数の見方。木造は 取引の慣行20年（下の端）〜国の指針30年（上の端、既存住宅価格査定マニュアルの基礎・躯体 ランクC）。鉄骨・鉄筋コンクリートは税の法定耐用年数で割った1つの値
const SATEI_TABLE = {
  year: "令和5年", src: "国税庁「建物の標準的な建築価額表」",
  kinds: {
    "木造":             { unit:204.1, low:20, high:30, tax:22, name:"木造・木骨モルタル造" },
    "鉄骨":             { unit:281.1, tax:34, name:"鉄骨造", note:"鉄骨の法定耐用年数は骨格材の厚さで変わる（34年は4mm超の場合）" },
    "鉄筋コンクリート": { unit:314.3, tax:47, name:"鉄筋コンクリート造" },
  },
  floor: { "〜80㎡（2LDKほど）":70, "80〜120㎡（3〜4LDK）":100, "120㎡以上":130 },
  age:   { "10年まで":5, "11〜20年":15, "21〜30年":25, "31年以上":35 },
};
const SATEI_HOUSE = ["一戸建て", "アパート・店舗など"];

if (SATEI.on && typeof SURVEY !== "undefined") {
  SURVEY.groups.push(
    { g:"K", extra:true, title:"建物の種類", hint:"1つ", one:true, when:["住んでいる家がある", "空き家・古い家がある"], opts:["一戸建て", "アパート・店舗など", "マンションの一室"] },
    { g:"S", extra:true, title:"つくり", hint:"1つ", one:true, when:SATEI_HOUSE, opts:["木造", "鉄骨", "鉄筋コンクリート", "分からない"] },
    { g:"Y", extra:true, title:"建ってからの年数", hint:"1つ", one:true, when:SATEI_HOUSE, opts:["10年まで", "11〜20年", "21〜30年", "31年以上", "分からない"] },
    { g:"F", extra:true, title:"広さ（間取りの目安）", hint:"1つ", one:true, when:SATEI_HOUSE, opts:["〜80㎡（2LDKほど）", "80〜120㎡（3〜4LDK）", "120㎡以上", "分からない"] },
    { g:"R", extra:true, title:"手入れ", hint:"1つ", one:true, when:SATEI_HOUSE, opts:["水回りや屋根・外壁を直したことがある", "直したことはない", "分からない"] },
  );
  Object.assign(SURVEY.facts, {
    "一戸建て": "一戸建ては、土地の値に建物の値を足して見る。建物の値は、つくりと年数で決まる。",
    "アパート・店舗など": "アパート・店舗は、土地の値に建物の値を足して見る。貸しているなら、家賃の入り方でも見られる。",
    "マンションの一室": "マンションは、同じ建物や近くの取引の値段で見る（土地の値×広さでは見ない）。",
    "木造": "木造は、取引の慣行では築20〜25年で建物の値をみなくなるが、国の指針の見方では基礎・躯体を30年以上で見る。",
    "鉄骨": "鉄骨の建物は、木造より長い年数で見られる。",
    "鉄筋コンクリート": "鉄筋コンクリートの建物は、いちばん長い年数で見られる。",
    "10年まで": "建物の値がまだ大きく残る年数。", "11〜20年": "建物の値が残っている年数。",
    "21〜30年": "見方によって建物の値が大きく分かれる年数（取引の慣行では評価がつきにくく、国の指針の見方では残る）。",
    "31年以上": "建物の値はつきにくく、取り壊す前提で見られることもある年数。",
    "〜80㎡（2LDKほど）": "建物の値は、広さに比例する。", "80〜120㎡（3〜4LDK）": "建物の値は、広さに比例する。", "120㎡以上": "建物の値は、広さに比例する。",
    "水回りや屋根・外壁を直したことがある": "直した記録があれば、建物を長く使える年数で見てもらえる見込みがある。",
    "直したことはない": "建物の値は、つくりと年数の基本で見る。",
    "分からない": "分からない所は、担当が建物を見ればすぐ分かる。",
  });
  ["分からない"].forEach(x => UNSURE.add(x));
  SET_KEYS.push("reSatei"); // 再表示で戻す設定に入れる
  if (typeof DATA_ROWS !== "undefined") {
    const at = DATA_ROWS.findIndex(r => r.length === 1 && r[0] === "最寄りの標準地（近くの別の土地の公的な値）");
    DATA_ROWS.splice(at < 0 ? DATA_ROWS.length : at, 0, ["建物", "建物", "未定（下の②で伺います）"]);
    if (SATEI_T === 2) DATA_ROWS.push(["建物（簡易の計算）", "建物の目安"], ["土地＋建物", "土地と建物の目安"]);
  }

  const man = n => Math.round(n / 1e5) * 10; // 円 → 万円（10万円単位）
  const manS = n => man(n).toLocaleString() + "万円";
  // 建物の値（円）。返すのは { low, high, one, mansion, lines }
  window.sateiCalc = s => {
    if (s.K === "マンションの一室") return { mansion:true };
    if (!SATEI_HOUSE.includes(s.K)) return null;
    const kindKey = SATEI_TABLE.kinds[s.S] ? s.S : "木造", k = SATEI_TABLE.kinds[kindKey];
    const fl = SATEI_TABLE.floor[s.F] || 100, ag = SATEI_TABLE.age[s.Y];
    const rebuild = k.unit * 1000 * fl;
    const left = (life, a) => rebuild * Math.max(0, 1 - a / life);
    let low, high, one = null;
    if (k.low) { low = ag == null ? 0 : left(k.low, ag); high = left(k.high, ag == null ? 5 : ag); }
    else { one = left(k.tax, ag == null ? 5 : ag); low = high = one; }
    return { kindKey, k, fl, ag, rebuild, low, high, one, flGuess:!SATEI_TABLE.floor[s.F], kindGuess:!SATEI_TABLE.kinds[s.S] };
  };
  function sateiApply() {
    if (!S || !S.sheet || !S.satei) return;
    const sh = S.sheet, s = S.satei, Y = "（お答えより）";
    sh.建物 = s.K ? [s.K, s.S, s.Y && "築" + s.Y, s.F && "延床" + s.F, s.R].filter(Boolean).join("・") + Y : null;
    sh.建物の目安 = sh.土地と建物の目安 = sh.建物の計算 = null;
    if (SATEI_T !== 2) return;
    const c = sateiCalc(s); S.sateiCalc = c;
    if (!c) return;
    if (c.mansion) { sh.建物の目安 = "マンションは同じ建物や近くの取引の値段で見るため、ここでは計算しません"; return; }
    const ageT = c.ag == null ? "築年数は分からない（0年〜築5年として計算）" : "築" + c.ag + "年ほど";
    const head = `${c.k.name}・${ageT}・延床${c.fl}㎡${c.flGuess ? "（仮に）" : "ほど"}`;
    sh.建物の目安 = c.one != null
      ? `約${manS(c.one)}（${head}。税の年数${c.k.tax}年で単純に割った場合）`
      : c.high <= 0 ? `評価がつきにくい（${head}。取り壊す前提で見られることがあります）`
      : `取引の慣行では${c.low > 0 ? "約" + manS(c.low) : "評価がつきにくい"}／国の指針の見方では約${manS(c.high)}（${head}）`;
    const dm = Number(String(SATEI.demolish || "").replace(/[^\d]/g, ""));
    if (dm && c.high <= 0) sh.建物の目安 += `。解体は弊社の目安で約${manS(dm * c.fl / 3.3058)}`;
    if (S.landYen) sh.土地と建物の目安 = c.low === c.high ? `約${manS(S.landYen + c.low)}（土地の単純計算に建物を足したもの）`
      : `約${manS(S.landYen + c.low)}〜約${manS(S.landYen + c.high)}（土地の単純計算に建物を足したもの。幅は建物の年数の見方の違い）`;
    // 店へのデータシート（プロの言葉）。画面の表には出さず、メールとAIへ
    sh.建物の計算 = `簡易の原価法（再調達単価×延床×残りの年数の割合、部位別ではない）。再調達単価 ${c.k.unit}千円/㎡（${SATEI_TABLE.src} ${SATEI_TABLE.year}・${c.k.name}${c.kindGuess ? "、構造不明のため木造で計算" : ""}）×延床${c.fl}㎡${c.flGuess ? "（不明のため仮の値）" : "（区分の中ほど）"}＝${manS(c.rebuild)}。`
      + (c.one != null ? `法定耐用年数${c.k.tax}年で単純に割った値 ${manS(c.one)}（幅なし）。${c.k.note || ""}`
        : `取引の慣行20年の値 ${manS(c.low)}／指針（基礎・躯体ランクC）30年の値 ${manS(c.high)}。`)
      + `税：法定耐用年数${c.k.tax}年・経過${c.ag == null ? "不明" : "約" + c.ag + "年"}（参考。値段の計算には使わない）。`
      + (dm ? `解体の坪単価（店の設定）${dm.toLocaleString()}円/坪。` : "")
      + (s.R ? `手入れ：${s.R}。` : "");
  }
  applySurvey = (f => (s, t) => {
    S.satei = s.K ? { K:s.K, S:s.S, Y:s.Y, F:s.F, R:s.R } : null;
    f(s, t); sateiApply(); renderData();
  })(applySurvey);
  if (typeof fillLand === "function") fillLand = (f => (sh, r, area) => {
    f(sh, r, area);
    const unit = Number(String((r && r.point && r.point.price) || "").replace(/[^\d]/g, ""));
    if (S && S.sheet === sh) { S.landYen = unit && area ? unit * area : 0; sateiApply(); }
  })(fillLand);

  // AIへ渡す決まり（TYPE2・3、建物の答えがあるときだけ）
  if (SATEI_T === 2 && typeof aiContext === "function") aiContext = (f => (n, ask) => {
    let c = f(n, ask);
    const x = S && S.sateiCalc;
    if (!x) return c;
    c += "\n\n【査定スキル：建物の見立て】";
    if (x.mansion) return c + "\nマンションの一室です。土地の値×広さの枠には乗りません。数字は出さず、「マンションは同じ建物や近くの取引の値段で見るので、担当が事例を調べてお伝えします」とつなげます。";
    c += "\n建物の見立て（プログラムが計算した値。この値だけを使う）：" + plain(String(S.sheet.建物の目安 || ""))
      + (S.sheet.土地と建物の目安 ? "\n土地＋建物：" + plain(String(S.sheet.土地と建物の目安)) : "")
      + (n === 0 ? "\n- この返事で、建物の見立てを必ず使います。教えてもらった答えで、こう絞れた、と分かる形にします。"
        : "\n- 土地・建物の数字は前の返事で伝え済みです。繰り返さず、利用者が書いたこと（事情・迷い・問い）に先に答えます。数字は、聞かれたときか、比べる話で要るときだけ一度使います。")
      + "\n- 一つの数字を言い切ります（例：「国の指針の見方では、建物は約◯万円残る計算です」）。幅の両端を並べて終えません。"
      + "\n- 同じ建物が、取引の慣行では評価がつきにくく、国の指針の見方では値が残る——見方で値が変わることを、利用者が初めて聞く話として一言で言います（木造で両方の値があるとき）。"
      + "\n- 年数を言うときは、どの見方かを必ず言います（取引の慣行／国の指針の見方／帳簿（税）の上では）。税の年数で値段を語りません（「築22年なので建物の価値はありません」は禁止）。"
      + "\n- 「査定」「鑑定」「評価額」は使わず、「国のデータでの目安」「簡易の計算では」と言います。"
      + "\n- この計算はAIの一つの見方で、正しいとは言い切れません。それを問い合わせる理由として言います（例：「この値で見てもらえるかは、担当が確かめます」）。「調査しないと分かりません」とは言いません。"
      + (S.satei && /直した/.test(S.satei.R || "") && !/ない/.test(S.satei.R) ? "\n- 直した記録（リフォームの記録・長期優良住宅の認定・住宅金融公庫の融資の記録など）があれば、建物を長く使える年数で見てもらえる見込みがあります。お手元にあれば用意を、と一言。" : "")
      + "\n- 弊社のこと（物件・扱う地区）にこのあたりがあれば、「このあたりは弊社でも扱っています」と一言つなげます。なければ言いません。"
      + "\n- 時期の話は、答えに当てはまるものだけ事実として言います（築年数→建物の評価は年数とともにつきにくくなる、空き家→傷みが進むほど評価が下がる）。急がせません。"
      + "\n- 利用者が税金・手取り・貸したい・アパート・投資と言ったときだけ、建物の分は税の上では年数で目減りした扱いになる（売る人）、古い建物は税の上では短い年数で経費にできる（貸す・買う人）と一言。税額は出しません。";
    return c;
  })(aiContext);
}

// 管理画面・お試し設定：査定スキルの欄（書いたそばに保存。メイン画面は開き直すと効く）
if (/_(admin|try)\.html$/.test(location.pathname)) document.addEventListener("DOMContentLoaded", () => {
  const box = document.createElement("div");
  box.className = "satei-box";
  box.style.cssText = "margin:8px 16px;padding:8px 12px;border:1px solid #d6dde5;border-radius:6px;background:#fff;font-size:13px;";
  box.innerHTML = `<b>査定スキル</b>（建物の簡易の見立て・3タイプ共通）　<label><input type="checkbox" id="sateiOn"> 使う</label>　<span class="hint">外すと今までと同じ動きです。</span>`
    + `<div style="margin-top:4px">木造の解体の目安 <input id="sateiDm" inputmode="numeric" placeholder="空欄のまま" style="width:8em"> 円/坪 <span class="hint">（入れると、古い建物のとき「弊社の目安では」と出します。メイン画面は開き直すと効きます）</span></div>`;
  const at = document.querySelector(".noticebar") || document.querySelector("main");
  at.parentNode.insertBefore(box, at.nextSibling === null ? null : (at.classList.contains("noticebar") ? at.nextSibling : at));
  const on = box.querySelector("#sateiOn"), dm = box.querySelector("#sateiDm");
  on.checked = SATEI.on; dm.value = SATEI.demolish || "";
  const save = () => { try { localStorage.setItem("reSatei", JSON.stringify({ on:on.checked, demolish:dm.value.replace(/[^\d]/g, "") })); } catch (e) { /* 保存できなくても画面は使える */ } };
  on.onchange = save; dm.oninput = save;
});
