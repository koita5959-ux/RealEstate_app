// ユーザーのテスト（?by=owner で開いたセッション）を、自動で GitHub へ渡す（Claude.ai が読めるように）。
// サーバー機の crontab で5分ごとに動く（tools/sync-owner.cron の1行）。手で動かしてもよい：node tools/sync-owner.mjs
// ・対象は by が owner のセッションだけ。一般の訪問者の会話は上げない（リポジトリは公開のため）
// ・最後の動きから10分たったもの（終わったセッション）を書き出す。あとで続きがあれば、同じファイルを書き直す
// ・中身は開発利用状況の「テキストで書き出す」と同じ。置き場所は _works/日付_ユーザー_テスト記録_タイプ_時刻.txt
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OWNER = process.env.SYNC_BY || "owner", QUIET_MS = process.env.SYNC_NOW ? 0 : 10 * 60_000, // SYNC_NOW：待たずに今すぐ（「今すぐ渡す」ファイルから）
  DAYS = 3, LIMIT = +process.env.SYNC_LIMIT || Infinity; // SYNC_BY・SYNC_LIMIT は動作確認用
const API = "http://127.0.0.1:8110/api/admin";
const pw = fs.readFileSync(path.join(ROOT, "secrets/admin_password.txt"), "utf8").trim();
const auth = "Basic " + Buffer.from("admin:" + pw).toString("base64");
const get = async (p) => { const r = await fetch(API + p, { headers: { Authorization: auth } }); if (!r.ok) throw new Error(p + " " + r.status); return r; };
const jst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" });

const now = Date.now();
const sum = await (await get("/summary")).json();
const list = (sum.sessions || []).filter((s) => s.by === OWNER && s.rounds > 0 && s.screen !== "read" && s.started && s.last
  && now - new Date(s.last).getTime() > QUIET_MS && now - new Date(s.started).getTime() < DAYS * 86400_000);

const changed = [];
for (const s of list.slice(0, LIMIT)) {
  const text = (await (await get("/export?sid=" + encodeURIComponent(s.sid))).text()).replace(/^﻿/, "");
  const name = `${jst(s.started).slice(0, 10)}_ユーザー_テスト記録_Type${s.screen === "talk" ? "2" : "3"}_${jst(s.started).slice(11, 16).replace(":", "")}_${s.sid.slice(0, 6)}.txt`;
  const file = path.join(ROOT, "_works", name);
  let old = ""; try { old = fs.readFileSync(file, "utf8"); } catch { /* 新しい */ }
  if (old === text) continue;
  fs.writeFileSync(file, text);
  changed.push("_works/" + name);
}
if (!changed.length) process.exit(0);

git("add", "--", ...changed);
git("commit", "-q", "-m", `テスト記録（自動・${changed.length}件）`, "--", ...changed);
try { git("pull", "-q", "--rebase", "--autostash"); } catch (e) { console.error(new Date().toISOString(), "pull:", e.message); }
git("push", "-q");
console.log(new Date().toISOString(), "上げた：", changed.join(" "));
