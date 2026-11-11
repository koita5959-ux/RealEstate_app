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
function shopHP() { try { const h = JSON.parse(localStorage.getItem("reShopHP")); if (h && (h.name || h.unreadable)) return h; } catch (e) {} return SHOP_HP_SAMPLE; }
function setShopHP(h) { try { localStorage.setItem("reShopHP", JSON.stringify(h)); } catch (e) {} }
// サーバーに読ませる。返り値：{ hp, msg, err }
async function readShopHP(url) {
  const r = await fetch("../api/shopread", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ url }), signal:AbortSignal.timeout(85000) });
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
    fit:join(sh.fit), unfit:join(sh.unfit), strong:sh.strong || "", area:sh.area || "", lic:(p.lic || []).join("、"), tel:(p.tel || [])[0] || "",
    why:{ name:"ページ名と著作権表記" + (sh.shogo && sh.shogo !== sh.name ? `（商号：${sh.shogo}）` : ""), ...(sh.why || {}) }, unread:sh.unread || [], ads:sh.ads || [], readAt:new Date().toISOString() };
  const pages = (s.pages || []).filter(x => !x.error).map(x => ({ top:"トップ", profile:"会社概要", case:"事例" }[x.kind] || x.kind));
  return { hp, msg:`読み取りました：${pages.join("・")}（${pages.length}ページ）。` + (hp.form && hp.form !== "店自身" ? `HPの形：${hp.form}。` : "") + (j.costUsdEstimate ? `費用の目安 約${Math.max(1, Math.round(j.costUsdEstimate * 155))}円。` : "") };
}
