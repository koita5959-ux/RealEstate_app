// タイプ1の見返し試験（AIなし・費用0）：docs/data/type1_test_urls.csv の全URLを読み、③（HPの見出し→小分類）を控えて、前回と違う店だけ書き出す。
// 使い方（サーバーで）：node tools/type1_check.mjs [控えの名前]   控えは data/type1_check/<名前>.json（既定は日時）。前回＝その前の控え
import fs from "fs";
import path from "path";
import vm from "vm";
import { menu } from "../server/shop/read.js";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const docs = path.join(root, "docs");
// 画面と同じ type1.js を、ファイルを読む fetch で動かす
const ctx = vm.createContext({ console, fetch: async (u) => { const t = fs.readFileSync(path.join(docs, u), "utf8"); return { text: async () => t, json: async () => JSON.parse(t) }; }, localStorage: { getItem: () => null } });
vm.runInContext(fs.readFileSync(path.join(docs, "js/type1.js"), "utf8") + "\n;globalThis.t1Load=t1Load;globalThis.t1Default=t1Default;globalThis.t1Kids=t1Kids;", ctx);
await ctx.t1Load();
const csv = vm.runInContext("t1Csv", ctx)(fs.readFileSync(path.join(docs, "data/type1_test_urls.csv"), "utf8"));
const dir = path.join(root, "data/type1_check"); fs.mkdirSync(dir, { recursive: true });
const name = process.argv[2] || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, "");
const prevFile = fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== name + ".json").sort().pop();
const prev = prevFile ? JSON.parse(fs.readFileSync(path.join(dir, prevFile), "utf8")) : {};
const out = {};
for (const r of csv.rows) {
  const m = await menu(r.URL).catch(e => ({ error: String(e.message || e), items: [] }));
  const top = m.error ? [] : ctx.t1Default(m.items).top;
  out[r.URL] = { 社名: r.社名, 回: r.回, error: m.error || "", items: (m.items || []).map(i => i.label), third: top.map(n => n.label + "＝" + n.cats.join("+")),
    fourth: top.map(n => n.label + "→" + ctx.t1Kids(n, null, [n]).map(k => k.label).join("・")) };
  const o = out[r.URL], p = prev[r.URL];
  const mark = !p ? "新" : JSON.stringify(p.third) === JSON.stringify(o.third) && JSON.stringify(p.fourth) === JSON.stringify(o.fourth) ? "　" : "差";
  console.log(`${mark} [${r.回}] ${r.社名}  ③${o.third.length}${o.error ? " ×" + o.error : ""}`);
  if (mark === "差") {
    const a = new Set(p.third), b = new Set(o.third);
    for (const x of p.third) if (!b.has(x)) console.log("     − " + x);
    for (const x of o.third) if (!a.has(x)) console.log("     ＋ " + x);
    if (JSON.stringify(p.fourth) !== JSON.stringify(o.fourth)) for (const x of o.fourth) if (!p.fourth.includes(x)) console.log("     ④ " + x);
  }
}
fs.writeFileSync(path.join(dir, name + ".json"), JSON.stringify(out, null, 1));
console.log(`控え：data/type1_check/${name}.json（前回：${prevFile || "なし"}）`);
