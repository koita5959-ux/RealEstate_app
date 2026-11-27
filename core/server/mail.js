// 問い合わせのメール送信（試験は MailHog が受け止めて外に出さない。画面 http://サーバー:8042/）。
// 宛先・差出人は docker-compose.yml の環境変数。本番に移すときは SMTP_HOST などを本物に替える（認証・TLS はそのとき足す）。
import net from "node:net";

const HOST = process.env.SMTP_HOST || "", PORT = +process.env.SMTP_PORT || 25;
const FROM = process.env.MAIL_FROM || "bot@example.test", TO = process.env.MAIL_TO || "shop@example.test";
export const mailReady = () => !!HOST;

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const head = (s) => `=?UTF-8?B?${b64(s)}?=`;
const addrOk = (a) => /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(a || "");

// 1通送る。to は配列。本文はプレーンテキスト
export function sendMail({ to = [TO], subject, text, replyTo, fromName = "AIボット不動産" }) {
  to = to.filter(addrOk);
  if (!HOST) return Promise.reject(new Error("no_smtp"));
  if (!to.length) return Promise.reject(new Error("no_to"));
  const body = b64(text).replace(/.{76}/g, "$&\r\n");
  const msg = [`From: ${head(fromName)} <${FROM}>`, `To: ${to.join(", ")}`, `Subject: ${head(subject)}`,
    ...(addrOk(replyTo) ? [`Reply-To: ${replyTo}`] : []), `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
  const steps = ["EHLO realestate-app", `MAIL FROM:<${FROM}>`, ...to.map((a) => `RCPT TO:<${a}>`), "DATA", msg + "\r\n.", "QUIT"];
  return new Promise((ok, ng) => {
    const s = net.connect(PORT, HOST); let buf = "", i = -1;
    s.setTimeout(10000, () => { s.destroy(); ng(new Error("smtp_timeout")); });
    s.on("error", ng);
    s.on("data", (d) => {
      buf += d.toString("utf8");
      const lines = buf.split("\r\n"); const last = lines[lines.length - 2];
      if (!last || /^\d{3}-/.test(last)) return; // 続きの行を待つ
      buf = "";
      if (!/^[23]/.test(last)) { s.destroy(); return ng(new Error("smtp: " + last)); }
      if (++i < steps.length) s.write(steps[i] + "\r\n"); else { s.end(); ok(); }
    });
    s.on("close", () => { if (i >= steps.length - 1) ok(); });
  });
}
export const MAIL_TO = TO;
