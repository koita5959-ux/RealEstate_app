// URLから店を判断する A「読む」（APIなし）。
// トップと「会社概要」などを一段だけたどり、決まった形のもの（免許番号・電話・住所）を拾う。
// 使い方（試験）：node server/shop/read.js <CSV> <出力JSON>
import fs from 'fs';
import dns from 'dns/promises';
import net from 'net';
import { pathToFileURL } from 'url';

const UA = 'Mozilla/5.0 (RealEstate_app siteread; +https://taskboard.asuscomm.com/RealEstate_app/)';
const PROFILE_WORDS = /会社概要|会社案内|会社情報|企業情報|事務所概要|事務所案内|店舗情報|店舗案内|アクセス|プロフィール|運営会社|運営者|私たちについて|当社について|company|profile|about|access|outline|gaiyou|gaiyo/i;
const CASE_WORDS = /事例|実績|お客様の声|お客さまの声|売却事例|解決事例|取扱物件|取引事例|case|works|voice/i; // 合う相談・合いにくい相談は事例の偏りから読む
const SERVICE_WORDS = /サポート|サービス|業務内容|事業内容|売却|売りたい|購入|買取|相続|空き家|管理|コンサル|ご相談|support|service|business/i; // 店が何をするかを書いたページ
const SKIP_WORDS = /一覧|検索|問い合わせ|査定依頼|依頼フォーム|form|メールマガジン|contact|プライバシー|privacy|個人情報|サイトマップ|sitemap|採用|recruit|ブログ|blog|お知らせ|news|\.(jpe?g|png|gif|pdf)$/i;
const TEXT_MAX = 8000;

// 管理画面から誰でもURLを渡せるので、サーバーの内側（LAN・自分自身）へは取りに行かない
function privateIp(a) {
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 10 || x === 127 || x === 0 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224;
  }
  const v = a.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || /^f[cd]/.test(v) || v.startsWith('fe80');
}
async function safeUrl(u) {
  let x; try { x = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(x.protocol) || (x.port && !['80', '443'].includes(x.port)) || x.username || x.password) return false;
  try { const as = await dns.lookup(x.hostname, { all: true }); return as.length > 0 && as.every(a => !privateIp(a.address)); }
  catch { return false; }
}

async function get(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    let r;
    for (let hop = 0; ; hop++) { // 転送は1段ずつ確かめてから追う（転送先がLANの内側なら止める）
      if (!(await safeUrl(url))) return { ok: false, status: 0, url, error: 'blocked' };
      r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }, redirect: 'manual', signal: ac.signal });
      const loc = r.headers.get('location');
      if (r.status < 300 || r.status >= 400 || !loc) break;
      if (hop >= 4) return { ok: false, status: r.status, url, error: 'too_many_redirects' };
      url = new URL(loc, url).href;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    let cs = (ct.match(/charset=([\w-]+)/i) || [])[1];
    if (!cs) cs = (buf.toString('latin1', 0, 4000).match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(cs.toLowerCase().replace('x-sjis', 'shift_jis')).decode(buf); }
    catch { html = buf.toString('utf8'); }
    return { ok: r.ok, status: r.status, url, html };
  } catch (e) {
    return { ok: false, status: 0, url, error: String(e.name === 'AbortError' ? 'timeout' : e.message || e) };
  } finally { clearTimeout(t); }
}

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&copy;/g, '©');

function parse(html, base) {
  const title = decode(((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim());
  const desc = decode((html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description/i) || [])[1] || '');
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(decode(m[1]), base);
      if (!/^https?:$/.test(u.protocol)) continue;
      const label = decode(m[2].replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, ' $1 ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      links.push({ url: u.href, label });
    } catch {}
  }
  const body = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
  const plain = decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  // 本文の画像の alt も材料にする（「［画像：…］」として本文に混ぜる）。飾りの短い alt は拾わない
  const imgs = body.match(/<img\b[^>]*>/gi) || [];
  const alts = imgs.map(t => decode((t.match(/\balt=["']([^"']*)["']/i) || [])[1] || '').trim());
  const text = decode(body.replace(/<img\b[^>]*\balt=["']([^"']{4,})["'][^>]*>/gi, ' ［画像：$1］ ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  // 画像の中に文字がありそうなページ：本文が画像の数に比べて少なく、alt もほぼない（雰囲気づくりの大きな画像が数枚だけのトップは出さない）
  const imgHeavy = imgs.length >= 8 && plain.length / imgs.length < 150 && alts.filter(a => a.length >= 4).length < imgs.length / 2;
  return { title, desc, links, text, imgs: imgs.length, imgHeavy };
}

// 決まった形のものを拾う
function pick(text) {
  const t = text.replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const lic = [...new Set((t.match(/(国土交通大臣|[^\s、。:：]{2,4}?[都道府県]知事)\s*(?:免許)?\s*\(\s*\d+\s*\)\s*第?\s*[\d-]+\s*号?/g) || []).map(s => s.replace(/\s+/g, '')))];
  const tel = [...new Set(t.match(/0\d{1,4}-\d{1,4}-\d{3,4}/g) || [])].slice(0, 5);
  const addr = [...new Set((t.match(/〒?\s?\d{3}-\d{4}\s*[^\s]{2,4}?[都道府県][^\s]{2,40}/g) || []).map(s => s.trim()))].slice(0, 3);
  const reg = [...new Set((t.match(/(税理士|司法書士|行政書士|弁護士|土地家屋調査士)[^。]{0,20}?登録番号\s*[^\s\d]{0,6}\s*第?\s*\d+号?/g) || []).map(s => s.replace(/\s+/g, ' ')))]; // 士業の登録番号（宅建の免許の代わり）
  const copy = (t.match(/(?:Copyright|©|\(c\))[^|]{0,80}/i) || [''])[0].trim();
  return { lic, reg, tel, addr, copy };
}

async function readPage(l) {
  const g = await get(l.url);
  if (!g.ok) return { url: l.url, kind: l.kind, error: g.error || `HTTP ${g.status}` };
  const q = parse(g.html, g.url);
  return { url: g.url, kind: l.kind, label: l.label, text: q.text.slice(0, TEXT_MAX), imgs: q.imgs, imgHeavy: q.imgHeavy };
}

// 読み直し用：1回目で読まなかった「店が何をするか」のページを、最大 n つ読む
async function readMore(r, n = 3) {
  const add = [];
  const texts = r.texts || new Set();
  for (const l of r.rest || []) {
    if (add.length >= n) break;
    await new Promise(res => setTimeout(res, 400));
    const pg = await readPage(l);
    if (!pg.text || texts.has(pg.text)) continue;
    texts.add(pg.text); add.push(pg);
  }
  return add;
}

async function read(url) {
  const out = { url, pages: [], picked: { lic: [], tel: [], addr: [], copy: '' } };
  const top = await get(url);
  if (!top.ok) { out.error = top.error || `HTTP ${top.status}`; return out; }
  const p = parse(top.html, top.url);
  out.final = top.url; out.title = p.title; out.desc = p.desc;
  out.pages.push({ url: top.url, kind: 'top', text: p.text.slice(0, TEXT_MAX), imgs: p.imgs, imgHeavy: p.imgHeavy });
  const host = new URL(top.url).host;
  const seen = new Set([top.url]);
  const cands = p.links.filter(l => PROFILE_WORDS.test(l.label + ' ' + l.url) && !seen.has(l.url)
    && (new URL(l.url).host === host || /about|company|profile/i.test(l.url)));
  let prof = [...new Map(cands.map(l => [l.url, { ...l, kind: 'profile' }])).values()];
  const notAccess = prof.filter(l => !/アクセス|access/i.test(l.label + ' ' + l.url));
  if (notAccess.length) prof = notAccess; // 会社概要があれば、アクセス（地図と住所だけ）は読まない
  const uniq = prof.slice(0, 2);
  const cases = p.links.filter(l => CASE_WORDS.test(l.label + ' ' + l.url) && !seen.has(l.url) && !uniq.some(u => u.url === l.url)
    && new URL(l.url).host === host);
  if (cases.length) uniq.push({ ...cases[0], kind: 'case' });
  // 店が何をするかのページ（売却サポート・業務内容など）。1回目は1つ、残りは読み直しの候補に取っておく
  const services = [...new Map(p.links.filter(l => SERVICE_WORDS.test(l.label + ' ' + l.url) && !SKIP_WORDS.test(l.label + ' ' + l.url)
    && !seen.has(l.url) && !uniq.some(u => u.url === l.url) && new URL(l.url).host === host).map(l => [l.url, { ...l, kind: 'service' }])).values()];
  const rank = l => { const s = l.label + ' ' + l.url; return /売却|売りたい/.test(s) ? 0 : /相続|空き家/.test(s) ? 1 : /業務|事業|サービス|service|business/i.test(s) ? 2 : 3; };
  services.sort((a, b) => rank(a) - rank(b)); // 売却 → 相続・空き家 → 業務内容 → そのほか
  if (services.length) uniq.push(services.shift());
  out.rest = services;
  const texts = new Set();
  for (const l of uniq) {
    await new Promise(r => setTimeout(r, 400));
    const pg = await readPage(l);
    if (pg.text && texts.has(pg.text)) continue; // 別のリンクから同じページ
    if (pg.text) texts.add(pg.text);
    out.pages.push(pg);
  }
  out.texts = texts;
  const all = out.pages.map(x => x.text || '').join(' ');
  out.picked = pick(all);
  out.js_only = p.text.length < 200;   // 本文がほぼない＝画面をJSで作るサイト
  return out;
}

// タイプ1の③：トップのリンクから「店が何をするか」の見出しを全部拾う（AIなし・ページは読まない）。
// 見出しの言葉で、初期設定の4業態（b1仲介・b2開発・b3総合・b4相続税）のどれかに寄せる（④⑤の初期値を借りるため）
const BIZ_OF = [[/相続|遺産|贈与|税|遺言|成年後見/, 'b4'], [/買取|買い取|開発|分譲|建築|新築|注文住宅|リフォーム|リノベ|造成/, 'b2'],
  [/仲介|売却|売りたい|購入|買いたい|物件|賃貸|貸したい|借りたい/, 'b1']];
const MENU_SKIP = /詳細|こちら|もっと見る|を見る|一覧|more|read|万円|㎡|坪|号室|\d{3,}|[０-９]{3,}|最近|お気に入り|おすすめ|オススメ|[！!☆★♪]|募集|値下げ|でました|まだまだ|限定/i; // 見出しでなく、飾りのリンク・個々の物件や宣伝（値段・面積・番号・！つき）
const MENU_WORDS = /物件|賃貸|売買|土地|マンション|戸建|住まい|管理|仲介/; // メニューでは、物件の種類・賃貸も業務の印として拾う
const BODY_HEAD = /(?:主な)?(?:業務内容|事業内容|営業品目|業務案内|取扱業務|営業内容)/; // 本文の業務一覧の見出し
async function menu(url) {
  const top = await get(url);
  if (!top.ok) return { url, error: top.error || `HTTP ${top.status}`, items: [] };
  const p = parse(top.html, top.url), host = new URL(top.url).host, seen = new Set(), items = [];
  for (const l of p.links) {
    const label = l.label.replace(/[>›»≫→▶▸►]+/g, ' ').replace(/^[A-Z][A-Z &]+\s+(?=[^\x00-\x7f])/, '').replace(/\s+/g, ' ').trim(); // 「SERVICE 事業内容」の英字の飾りは外す
    const outside = new URL(l.url).host !== host; // 物件検索は外のサービスに飛ぶ店が多い。外へのリンクは、短い物件の見出し（売買物件・賃貸物件）だけ拾う
    if (!label || label.length > 24 || seen.has(label) || MENU_SKIP.test(label) || (outside && !(label.length <= 8 && MENU_WORDS.test(label)))) continue;
    if (!(SERVICE_WORDS.test(label + ' ' + l.url) || MENU_WORDS.test(label)) || SKIP_WORDS.test(label + ' ' + l.url) || PROFILE_WORDS.test(label)) continue;
    seen.add(label);
    items.push({ label, url: l.url, biz: (BIZ_OF.find(([re]) => re.test(label)) || [, 'b3'])[1] });
  }
  // 本文の「主な業務内容」などの箇条（リンクでない業務の一覧）も拾う
  const m = p.text.match(BODY_HEAD);
  if (m) {
    const tail = p.text.slice(m.index + m[0].length, m.index + m[0].length + 300);
    for (const raw of tail.split(/[◎●○■□◆◇・※★☆]|[-－]{2,}|\s{2,}|】|【/)) {
      const label = raw.replace(/^[\s:：]+|[\s。、]+$/g, '').trim();
      if (label.length < 4 || label.length > 24 || seen.has(label) || MENU_SKIP.test(label)) continue;
      if (!(SERVICE_WORDS.test(label) || MENU_WORDS.test(label))) continue;
      seen.add(label); items.push({ label, url: top.url, from: 'text', biz: (BIZ_OF.find(([re]) => re.test(label)) || [, 'b3'])[1] });
    }
  }
  return { url, final: top.url, title: p.title, js_only: p.text.length < 200, items };
}

export { read, readMore, get, parse, menu };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [csv, dst] = process.argv.slice(2);
  const rows = fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1)
    .map(l => { const c = l.split(','); return { seq: c[0], tag: c[1], name: c[2], url: c[c.length - 1] }; });
  (async () => {
    const res = [];
    for (const r of rows) {
      const x = await read(r.url);
      res.push({ ...r, ...x });
      const k = x.error ? `× ${x.error}` : `免許${x.picked.lic.length ? '○' : '×'} 電話${x.picked.tel.length ? '○' : '×'} 住所${x.picked.addr.length ? '○' : '×'} 一段${x.pages.length - 1}`;
      console.log(r.seq.padStart(2), k);
    }
    fs.writeFileSync(dst, JSON.stringify(res, null, 1));
  })();
}
