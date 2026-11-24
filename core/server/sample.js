// サンプルHP（RealEstate_Site）を ?r=地区ID で地区名を差し込んで返す。開いた記録は sample-日付.jsonl へ（r・k だけ）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SITE = "/site/index.html";
const SITE_KANTEI = "/site-kantei/index.html"; // 鑑定士版のサンプルHP「AIボット鑑定」（11-24）
const PR = "/site/pr/index.html"; // 広告ページ（不動産向けチャットボットのセールス概要）
const CONF = "/site/site.json";   // 開発元の表記など（一か所で直す）
const REGIONS = "/regions/地区一覧.csv";
let regions = null;

function loadRegions() {
  if (regions) return regions;
  regions = new Map();
  try {
    const lines = fs.readFileSync(REGIONS, "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1);
    for (const l of lines) { const c = l.split(","); if (c[1] && c[3]) regions.set(c[1], c[3]); } // 地区ID → 代表の市
  } catch (e) { console.error("regions load failed:", e.message); }
  return regions;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

function conf() { try { return JSON.parse(fs.readFileSync(CONF, "utf8")); } catch { return {}; } }

// page：空＝サンプルHP、"pr"＝広告ページ、"kantei"＝鑑定士版のサンプルHP（広告ページはまだない）。どちらも ?r= を引き継いで行き来する
export function renderSample(r, page) {
  const c = conf(), dev = esc(c.developer || "開発元（準備中）");
  const rq = loadRegions().has(r) ? `?r=${encodeURIComponent(r)}` : "";
  if (page === "pr") {
    const top = "../" + rq;
    return fs.readFileSync(PR, "utf8").replaceAll("{{DEVELOPER}}", dev).replaceAll("{{SAMPLE_URL}}", top + "#bot").replaceAll("{{CONTACT_URL}}", top + "#contact");
  }
  let html = fs.readFileSync(page === "kantei" ? SITE_KANTEI : SITE, "utf8").replaceAll("{{DEVELOPER}}", dev).replaceAll("{{PR_URL}}", "pr/" + rq);
  const name = loadRegions().get(r);
  if (name) return html.replaceAll("{{REGION}}", esc(name));
  // 地区の指定がない・一覧にないとき（監修書 2-1）
  html = html.replace(/<span class="region" data-region-line>[^<]*<\/span>/, "");
  html = html.replace(/<td>\{\{REGION\}\}内（サンプルのため架空）<\/td>/, "<td>（サンプルのため架空）</td>");
  return html.replaceAll("{{REGION}}", "地域");
}

export function logSample(dataDir, req, r, k, by, known, page) {
  const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
  const who = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const row = { ts: new Date().toISOString(), who, by: by || "visitor", r: r || null, known, k: k || null, ...(page ? { page } : {}) };
  try { fs.appendFileSync(path.join(dataDir, `sample-${day}.jsonl`), JSON.stringify(row) + "\n", { mode: 0o600 }); }
  catch (e) { console.error("sample log failed:", e.message); }
}

export const regionKnown = (r) => loadRegions().has(r);
