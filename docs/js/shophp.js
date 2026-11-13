// 店のHPの読み（タイプ2・3で共有）。管理画面の「読み取る」で作り、このブラウザに "reShopHP" として置く。
// 読みがなければ、見本サイト「遠見不動産」の読みを使う。
const SHOP_HP_SAMPLE = {
  url:"https://taskboard.asuscomm.com/RealEstate/", sample:true, name:"遠見不動産",
  what:"売却ありきで始めず、残す・貸す・売る・隣と合わせるを並べて持ち主と考える店",
  good:"古い家・空き家、遠方に住む持ち主、旗竿地など売りにくい土地、隣の土地と合わせると変わる土地",
  team:"司法書士、土地家屋調査士、税理士、一級建築士事務所、地域の工務店・解体業者",
  fit:"売るか残すか決めていない空き家、隣の土地と合わせると変わる土地", unfit:"",
  strong:"敷地の外（隣の土地・通り・町の向き）まで見て、道を3つ以上並べること", lic:"",
  why:{}, unread:["担当している地域の地名（「事務所から2.5km」とだけある）", "買取をどんなときにするか", "宅建の免許番号"] };
// 店のこと：HPから読んだ欄（下書き。店が直せる）と、HPにないので店が書く欄（空白から）。タイプ2・3で同じ欄
// [キー, 名前, 空欄の書き方の例, HPのどこから読むか]
const SHOP_KNOW = [
  ["name", "店の呼び名", "例：遠見不動産", "HPの店名から"],
  ["what", "何をしている店か（一文）", "例：売却ありきで始めず、残す・貸す・売るを並べて持ち主と考える店", "トップ・会社概要から"],
  ["stance", "誰の味方か・その理由", "例：売主だけを支援します。買主からも手数料を取る両手仲介をしないためです", "方針・ごあいさつから"],
  ["voice", "代表の言葉（相談をどう受け止めるか）", "例：売れない理由を並べず、どうすれば売れるかを一緒に考えます", "代表あいさつから。AIの話し方の芯になります"],
  ["good", "よく受けている相談の種類", "例：相続した実家、空き家、旗竿地、隣の土地との境目", "業務内容・事例から"],
  ["worries", "お客さんがよく口にする悩み", "例：何から始めればいいのか、査定額が安すぎないか、家族で話が進まない", "よくある質問・コラムの題から"],
  ["team", "組んでいる専門家", "例：司法書士、税理士、土地家屋調査士、地域の工務店", "提携先の記載から"],
  ["fit", "この店に向く相談", "例：売るか残すか決めていない空き家", "HP全体から"],
  ["unfit", "この店では受けにくい相談", "例：賃貸の部屋探し", "HP全体から"],
  ["strong", "事例から言える強み", "例：旗竿地の通路を測り直し、建築会社に先に見せて売った", "事例・仕組みから（宣伝文句は使いません）"],
  ["area", "対応している地域", "例：岐阜市と周辺の市町", "会社概要から"]];
const SHOP_EXTRA = [
  ["way", "相談を受けたら、最初にすること", "例：買取ならいくら、仲介で時間をかけたらいくらを並べてお見せし、そこから一緒に決めます", "締めの「店の一手」になります。どの店でも言える言葉が、この店の言葉に変わります"],
  ["take", "引き受けること", "例：現地を見るのは無料。連絡から3日以内に、宅建士が伺います", "締めの「現地で確かめます」が具体になります。書いたことは約束になります"],
  ["case", "よく受ける相談の実例", "例：遠方に住む相続人の旗竿地。通路の幅を測り直し、建築会社に先に見てもらって売れた（金額は書かなくて構いません）", "AIが「似たご相談がありました」と話せます"],
  ["local", "この辺りの土地勘", "例：長良地区で30年。昔は田んぼだった所、水が出やすい所を知っています", "公開データにない一言が言えます（地域を悪く言う言い方はAIがしません）"],
  ["contact", "連絡の受け方", "例：平日9〜18時は電話、夜はメール。代表の〇〇が出ます", "電話の後の不安を減らします"],
  ["unreadAns", "HPから読めなかったことへの答え", "", "聞かれたときに、AIが答えられるようになります"],
  ["ng", "AIに言ってほしくないこと", "例：買取の話は、お客さんから出るまでしない", "AIはこれに触れません"]];
// 店が直した欄（own）と書いた欄（extra）。このブラウザに "reShopKnow" として置き、タイプ2・3で共有する
function shopKnow() { try { const k = JSON.parse(localStorage.getItem("reShopKnow")); if (k) return { own:k.own || {}, extra:k.extra || {} }; } catch (e) {} return { own:{}, extra:{} }; }
function setShopKnow(k) { try { localStorage.setItem("reShopKnow", JSON.stringify({ own:k.own || {}, extra:k.extra || {} })); } catch (e) {} }
// AIへ渡す「弊社のこと」（社員として話すとき。タイプ3と、タイプ2の社員目線）。直した欄はHPの読みより優先し、空欄は渡さない
function shopKnowText(hp, know) {
  const v = k => String((know.own[k] ?? hp[k]) || "").trim(), x = k => String(know.extra[k] || "").trim(), why = hp.why || {};
  const line = (l, k) => v(k) ? `\n・${l}：${v(k)}` + (why[k] && know.own[k] == null ? `（HPの根拠：${why[k]}）` : "") : "";
  let c = line("どんな会社か", "what") + line("立場と理由", "stance") + line("店の考え（話し方の芯にします）", "voice") + line("よく受けている相談", "good")
    + line("よくあるお客さんの悩み", "worries") + line("弊社に合う相談", "fit") + line("弊社に合いにくい相談", "unfit") + line("弊社の強み", "strong")
    + line("連携している専門家", "team") + line("対応している地域", "area");
  for (const [k, l] of SHOP_EXTRA) if (x(k)) c += `\n・${k === "ng" ? "言ってほしくないこと（触れません）" : k === "take" ? "弊社が引き受けること（約束してよいのはここに書かれた範囲だけ）" : l}：${x(k)}`;
  if (!x("take")) c += "\n・弊社が引き受けること：書かれていません。現地を見る・調べる以上の約束（値段・日程・費用）はしません。";
  const un = (hp.unread || []).filter(Boolean);
  if (un.length && !x("unreadAns")) c += "\n・ホームページから分からないこと：" + un.join("、") + "。聞かれたら「担当からお答えします」と伝え、推測で答えません。";
  return c;
}
function shopHP() { try { const h = JSON.parse(localStorage.getItem("reShopHP")); if (h && (h.name || h.unreadable)) return h; } catch (e) {} return SHOP_HP_SAMPLE; }
function setShopHP(h) { try { localStorage.setItem("reShopHP", JSON.stringify(h)); } catch (e) {} }
// 読み取り中は画面を暗くし、経過秒と段階を出す（終わるまで操作させない）
function readingCover(url) {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;cursor:wait";
  el.innerHTML = `<style>@keyframes reSpin{to{transform:rotate(360deg)}}</style>
    <div style="background:#fff;color:#222;border-radius:10px;padding:22px 26px;max-width:min(420px,calc(100vw - 32px));text-align:center;font-size:14px;line-height:1.7;box-shadow:0 8px 30px rgba(0,0,0,.3)">
      <div style="width:36px;height:36px;margin:0 auto 12px;border:4px solid #ddd;border-top-color:#2a6fdb;border-radius:50%;animation:reSpin 1s linear infinite"></div>
      <div style="font-weight:bold">HPを読み取っています</div>
      <div data-url style="font-size:12px;color:#666;word-break:break-all"></div>
      <div data-stage style="margin-top:8px"></div>
      <div data-sec style="font-size:12px;color:#666"></div>
    </div>`;
  el.querySelector("[data-url]").textContent = url;
  document.body.appendChild(el);
  const t0 = Date.now(), tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    el.querySelector("[data-stage]").textContent = s < 8 ? "ページを取りに行っています…" : s < 40 ? "AIが店の姿をまとめています…" : "もう少しかかっています…";
    el.querySelector("[data-sec]").textContent = `${s}秒（ふつう30秒ほど。最長85秒で諦めます）`;
  };
  tick(); const id = setInterval(tick, 1000);
  return () => { clearInterval(id); el.remove(); };
}
// サーバーに読ませる。返り値：{ hp, msg, err }
async function readShopHP(url) {
  const close = readingCover(url);
  try { return await readShopHP0(url); } finally { close(); }
}
let READ_LAST_CACHED = ""; // 同じ日の結果を使ったURL。もう一度押すと読み直す
async function readShopHP0(url) {
  const by = new URLSearchParams(location.search).get("by") || "visitor", force = READ_LAST_CACHED === url;
  const r = await fetch("../api/shopread", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ url, by, force }), signal:AbortSignal.timeout(150000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { err:true, msg:{ daily_cap:"今日の費用の上限に達しています。", rate_limited:"続けて押されています。少し待ってください。", busy:"混み合っています。少し待ってください。", disabled:"いまAIは止めてあります。", no_key:"APIの鍵が設定されていません。" }[j.error] || "読み取れませんでした（" + (j.detail || j.error || r.status) + "）" };
  const s = j.site || {}, p = s.picked || {};
  if (!j.shop) {
    const why = s.js_only ? "このHPは外から読み取りにくい作りです（画面をJavaScriptで作っていて、本文がほとんど読めません）。検索やAIにも読まれにくい作りなので、HPの作り直しの候補です。"
      : s.error === "blocked" ? "このURLには取りに行けません（社内のネットワークなど）。" : "HPを読めませんでした（" + (s.error || "形が読み取れない") + "）。";
    return { err:true, msg:why, hp:{ url, name:s.title || "", lic:(p.lic || []).join("、"), why:{}, unread:[], unreadable:why } };
  }
  const sh = j.shop, join = a => Array.isArray(a) ? a.filter(Boolean).join("、") : String(a || "");
  const hp = { url:s.final || url, name:sh.name || s.title || "", shogo:sh.shogo || "", form:sh.form || "", what:sh.what || "", good:join(sh.good), team:join(sh.team),
    fit:join(sh.fit), unfit:join(sh.unfit), strong:sh.strong || "", area:sh.area || "", stance:sh.stance || "", voice:sh.voice || "", worries:join(sh.worries), lic:(p.lic || []).join("、"), tel:(p.tel || [])[0] || "",
    why:{ name:"ページ名と著作権表記" + (sh.shogo && sh.shogo !== sh.name ? `（商号：${sh.shogo}）` : ""), ...(sh.why || {}) }, unread:sh.unread || [], ads:sh.ads || [], readAt:new Date().toISOString() };
  const pages = (s.pages || []).filter(x => !x.error).map(x => ({ top:"トップ", profile:"会社概要", case:"事例" }[x.kind] || x.kind));
  READ_LAST_CACHED = j.cached ? url : "";
  if (j.cached) return { hp, msg:`今日 ${new Date(j.cached).toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" })} に読み取った結果を使いました（費用0）。HPを直したときは、もう一度押すと読み直します。` };
  return { hp, msg:`読み取りました：${pages.join("・")}（${pages.length}ページ）。` + (hp.form && hp.form !== "店自身" ? `HPの形：${hp.form}。` : "") + (j.costUsdEstimate ? `費用の目安 約${Math.max(1, Math.round(j.costUsdEstimate * 155))}円。` : "") };
}
