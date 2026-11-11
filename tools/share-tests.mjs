// テストの記録を GitHub へ渡す（Claude.ai が読めるように）。
// 使い方（Windows の PowerShell から）：ssh -t tb1 ~/docker-templates/RealEstate_app/tools/share-tests.sh
//   1. 今日（日付を付ければその日。例：share-tests.sh 2026-11-12）のAIを使ったセッションが番号付きで並ぶ
//   2. 渡す番号を選ぶ（例：1,3 ／ 全部なら a ／ やめるなら空のまま Enter）
//   3. 一言の感想を書く（なくてもよい）
//   4. _works/ に「日付_ユーザー_テスト記録_タイプ_時刻.txt」で置き、commit・push する
// 中身は開発利用状況の「テキストで書き出す」と同じ（条件・会話・AIへ渡したもの・AIのメモ）。
// 一般の訪問者のセッションも並ぶので、自分のテストだけを選ぶこと（訪問者の言葉を GitHub に上げない）。
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const API = "http://127.0.0.1:8110/api/admin";
const pw = fs.readFileSync(path.join(ROOT, "secrets/admin_password.txt"), "utf8").trim();
const auth = "Basic " + Buffer.from("admin:" + pw).toString("base64");
const get = async (p) => { const r = await fetch(API + p, { headers: { Authorization: auth } }); if (!r.ok) throw new Error(p + " " + r.status); return r; };
const jst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString(); // 日本時間の文字列（末尾の Z は無視）

const args = process.argv.slice(2), showAll = args.includes("--all"); // --all：Claude Code のテスト（claudecode）も並べる
const day = args.find((a) => /^\d{4}-\d\d-\d\d$/.test(a)) || jst(new Date().toISOString()).slice(0, 10);
const sum = await (await get("/summary")).json();
const list = (sum.sessions || [])
  .filter((s) => s.rounds > 0 && s.screen !== "read" && (showAll || !/^claude/.test(s.by)) && s.started && jst(s.started).slice(0, 10) === day)
  .sort((a, b) => a.started.localeCompare(b.started));
if (!list.length) { console.log(`${day} にAIを使ったセッションはありません。`); process.exit(0); }

console.log(`\n${day} のセッション（AIを使ったもの）`);
list.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${jst(s.started).slice(11, 16)}〜${jst(s.last).slice(11, 16)}  タイプ${s.screen === "talk" ? "2" : "3"}  ${s.by.padEnd(10)} ${s.rounds}往復  ${(s.first || "").replace(/\s+/g, " ").slice(0, 40)}`));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ans = (await rl.question("\n渡す番号（例：1,3 ／ 全部 a ／ やめる Enter）> ")).trim();
if (!ans) { console.log("やめました。"); rl.close(); process.exit(0); }
const pick = ans === "a" ? list : ans.split(/[,\s、]+/).map((n) => list[+n - 1]).filter(Boolean);
if (!pick.length) { console.log("番号が読めませんでした。"); rl.close(); process.exit(1); }
const note = (await rl.question("一言の感想（なくてもよい）> ")).trim();
rl.close();

const files = [];
for (const s of pick) {
  const text = (await (await get("/export?sid=" + encodeURIComponent(s.sid))).text()).replace(/^﻿/, "");
  const name = `${day}_ユーザー_テスト記録_Type${s.screen === "talk" ? "2" : "3"}_${jst(s.started).slice(11, 16).replace(":", "")}.txt`;
  fs.writeFileSync(path.join(ROOT, "_works", name), (note ? `感想：${note}\n\n` : "") + text);
  files.push("_works/" + name);
  console.log("書き出し：" + name);
}
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { stdio: "inherit" });
git("add", ...files);
git("commit", "-q", "-m", `テスト記録（${day}・${files.length}件）`);
git("push", "-q");
console.log(`\nGitHub に上げました（${files.length}件）。Claude.ai には「_works/${day}_ユーザー_テスト記録_… を読んで」と伝えてください。`);
