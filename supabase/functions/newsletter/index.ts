// SparkNews newsletter function. Deploy as a Supabase Edge Function named "newsletter" with "Verify JWT" switched OFF
// (it checks who is asking itself). The Brevo API key is read from the database (Settings tab in the editor).
//
// Public:  subscribe (sends a confirmation email), confirm, unsubscribe
// Staff:   test (send one test email), send (send to all confirmed subscribers, in chunks), check (admin: test the Brevo key)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]{2,}$/;
const CHUNK = 120;       // recipients handled per call; the editor keeps calling until nobody is left
const BATCH = 40;        // recipients per Brevo request

/** Defense in depth: mail programs already ignore scripts, but nothing active should ever leave here. */
export function cleanEmailHtml(html: string): string {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed|applet|form)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|iframe|object|embed|applet|form|base|meta|link|input|button|textarea|select)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(href|src|action|background)\s*=\s*(["'])\s*(javascript|vbscript|data\s*:\s*text\/html)[^"']*\2/gi, "$1=$2#$2")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "x(");
}

export function toText(html: string): string {
  return String(html || "")
    .replace(/<(style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, u, t) => {
      const label = String(t).replace(/<[^>]+>/g, "").trim();
      return !label || label === u ? u : `${label} (${u})`;
    })
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function fill(html: string, v: Record<string, string>): string {
  return html.replace(/\{\{\s*(unsubscribe_url|name|email)\s*\}\}/g, (_m, k) => (k === "name" ? esc(v.name) : k === "email" ? esc(v.email) : esc(v.unsubscribe_url).replace(/&amp;/g, "&")));
}

function withUnsubscribe(html: string, siteName: string, address: string): string {
  if (/\{\{\s*unsubscribe_url\s*\}\}/.test(html)) return html;
  const note = `<div style="max-width:600px;margin:24px auto;padding:0 16px;font:12px/1.6 Arial,Helvetica,sans-serif;color:#6b7280;text-align:center">` +
    `You are receiving this email because you subscribed to ${esc(siteName)}.${address ? "<br>" + esc(address) : ""}<br>` +
    `<a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a></div>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, note + "</body>") : html + note;
}

function simpleMail(site: string, d: Record<string, string>, title: string, body: string, btnText = "", btnUrl = ""): string {
  const brand = /^#[0-9a-f]{6}$/i.test(d.brand || "") ? d.brand : "#d9400a";
  const head = /^#[0-9a-f]{6}$/i.test(d.header_bg || "") ? d.header_bg : "#0e1116";
  const btn = btnUrl ? `<p style="margin:24px 0"><a href="${esc(btnUrl)}" style="background:${brand};color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:6px;display:inline-block">${esc(btnText)}</a></p>` +
    `<p style="margin:0;color:#6b7280;font-size:13px">Or copy this link into your browser:<br>${esc(btnUrl)}</p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f5f7"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1f2933">` +
    `<tr><td bgcolor="${head}" style="background:${head};color:#ffffff;padding:20px 28px;font-size:22px;font-weight:bold">${esc(site)}</td></tr>` +
    `<tr><td style="padding:28px;font-size:16px;line-height:1.6"><h1 style="margin:0 0 12px;font-size:22px">${esc(title)}</h1>${body}${btn}</td></tr></table></td></tr></table></body></html>`;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const env = (n: string) => Deno.env.get(n) ?? "";
  const dbUrl = env("SUPABASE_URL").replace(/\/+$/, ""), svc = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!dbUrl || !svc) return reply({ error: "The function has no database access." }, 500);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return reply({ error: "Bad request" }, 400); }
  const mode = String(input.mode || "");
  const apikey = req.headers.get("apikey") ?? "";

  const db = async (path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) => {
    const r = await fetch(`${dbUrl}/rest/v1/${path}`, {
      method: init.method || "GET",
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await r.text();
    let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { ok: r.ok, status: r.status, data: data as any };
  };

  // ---- settings and keys (saved by an admin in the editor)
  const sec: Record<string, string> = {};
  const sr = await db("app_secrets?select=key,value&key=eq.brevo_api_key");
  if (sr.ok && Array.isArray(sr.data)) for (const x of sr.data) sec[x.key] = x.value;
  const brevoKey = sec.brevo_api_key || env("BREVO_API_KEY");
  const st = await db("site_settings?select=data&id=eq.1");
  const settings = (st.ok && Array.isArray(st.data) && st.data[0] && st.data[0].data) || {};
  const nl = settings.newsletter || {};
  const siteName = String(settings.site_name || env("SITE_NAME") || "SparkNews");
  const base = String(settings.base_url || env("SITE_URL") || (/^https:\/\//.test(req.headers.get("origin") ?? "") ? req.headers.get("origin") : "")).replace(/\/+$/, "");

  const brevo = async (path: string, body?: unknown) => {
    const r = await fetch(`https://api.brevo.com/v3/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "api-key": brevoKey, accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { ok: r.ok, status: r.status, data };
  };
  const brevoError = (r: { status: number; data: any }) =>
    r.status === 401 ? "Brevo rejected the API key. Check it in Settings." :
    r.status === 403 ? "Brevo refused the request. Is the sender address verified in Brevo (Senders & IP)?" :
    `Brevo error ${r.status}${r.data && r.data.message ? ": " + r.data.message : ""}`;
  const sender = () => {
    const email = String(nl.from_email || "").trim(), name = String(nl.from_name || siteName).trim();
    return EMAIL.test(email) ? { name, email } : null;
  };

  // ======================= public modes
  if (mode === "subscribe") {
    if (input.hp) return reply({ ok: true });                                  // honeypot: bots fill the hidden field
    const email = String(input.email || "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return reply({ error: "Please enter a valid email address." }, 400);
    const name = String(input.name || "").trim().slice(0, 80) || null;
    if (!brevoKey || !sender() || !base) return reply({ error: "The newsletter is not set up yet." }, 503);
    const ex = await db(`subscribers?select=id,status,token,last_confirm_sent&email=eq.${encodeURIComponent(email)}`);
    let sub = Array.isArray(ex.data) ? ex.data[0] : null;
    if (sub && sub.status === "confirmed") return reply({ ok: true });         // same answer for everyone: no way to probe who is subscribed
    if (sub && sub.last_confirm_sent && Date.now() - Date.parse(sub.last_confirm_sent) < 5 * 60 * 1000) return reply({ ok: true });
    if (!sub) {
      const ins = await db("subscribers", { method: "POST", prefer: "return=representation", body: { email, name, status: "pending", source: "website" } });
      if (!ins.ok || !Array.isArray(ins.data)) return reply({ error: "Could not sign you up. Please try again." }, 500);
      sub = ins.data[0];
    } else {
      await db(`subscribers?id=eq.${sub.id}`, { method: "PATCH", body: { status: "pending", ...(name ? { name } : {}) } });
    }
    const link = `${base}/newsletter/?confirm=${sub.token}`;
    const m = await brevo("smtp/email", {
      sender: sender(), to: [{ email, ...(name ? { name } : {}) }], subject: `Please confirm your subscription to ${siteName}`,
      htmlContent: simpleMail(siteName, { brand: nl.brand, header_bg: nl.header_bg }, "Confirm your subscription",
        `<p style="margin:0">Thanks for signing up to the ${esc(siteName)} newsletter. Please confirm your email address so we can send it to you.</p>`, "Confirm my subscription", link),
      textContent: `Confirm your subscription to ${siteName}: ${link}\n\nIf you did not sign up, ignore this email.`,
    });
    if (!m.ok) return reply({ error: "We could not send the confirmation email. Please try again later." }, 502);
    await db(`subscribers?id=eq.${sub.id}`, { method: "PATCH", body: { last_confirm_sent: new Date().toISOString() } });
    return reply({ ok: true });
  }

  if (mode === "confirm" || mode === "unsubscribe") {
    const token = String(input.token || "");
    if (!/^[0-9a-f]{32,64}$/.test(token)) return reply({ error: "This link is not valid." }, 400);
    const r = await db(`subscribers?token=eq.${token}`, { method: "PATCH", prefer: "return=representation",
      body: mode === "confirm" ? { status: "confirmed", confirmed_at: new Date().toISOString(), unsubscribed_at: null } : { status: "unsubscribed", unsubscribed_at: new Date().toISOString() } });
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) return reply({ error: "This link is not valid or has expired." }, 404);
    return reply({ ok: true, site: siteName });
  }

  // ======================= staff modes
  if (mode !== "test" && mode !== "send" && mode !== "check") return reply({ error: "Unknown mode" }, 400);
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer eyJ/.test(auth)) return reply({ error: "Please sign in again." }, 401);
  const rr = await fetch(`${dbUrl}/rest/v1/rpc/editor_role`, { method: "POST", headers: { apikey, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  const role = rr.ok ? await rr.json() : null;
  if (role !== "admin" && role !== "editor") return reply({ error: "Only editors and admins can use the newsletter." }, 403);
  if (!brevoKey) return reply({ error: "Brevo is not set up: paste the Brevo API key in the editor's Settings tab." }, 503);

  if (mode === "check") {
    if (role !== "admin") return reply({ error: "Only admins can test the connection." }, 403);
    const r = await brevo("account");
    if (!r.ok) return reply({ ok: false, error: brevoError(r) });
    const credits = Array.isArray(r.data && r.data.plan) ? r.data.plan.find((p: any) => p.type === "free" || p.credits !== undefined) : null;
    return reply({ ok: true, account: r.data && r.data.email, credits: credits ? credits.credits : null, sender_ok: !!sender() });
  }

  const from = sender();
  if (!from) return reply({ error: "Set the sender name and email in Newsletter > Design first. The email must be verified in Brevo." }, 400);
  const subject = String(input.subject || "").trim().slice(0, 200);
  let html = String(input.html || "");
  if (!subject) return reply({ error: "The email needs a subject line." }, 400);
  if (html.length < 20) return reply({ error: "The email is empty." }, 400);
  if (html.length > 400_000) return reply({ error: "The email is too large (over 400 KB). Remove some content or images." }, 400);
  html = withUnsubscribe(cleanEmailHtml(html), siteName, String(nl.address || ""));
  const replyTo = EMAIL.test(String(nl.reply_to || "")) ? { email: String(nl.reply_to) } : undefined;

  if (mode === "test") {
    const to = String(input.to || "").trim().toLowerCase();
    if (!EMAIL.test(to)) return reply({ error: "Enter a valid address for the test email." }, 400);
    const v = { name: "Test reader", email: to, unsubscribe_url: `${base || "https://example.com"}/newsletter/?unsubscribe=test` };
    const body = fill(html, v);
    const r = await brevo("smtp/email", { sender: from, ...(replyTo ? { replyTo } : {}), to: [{ email: to }], subject: `[TEST] ${subject}`, htmlContent: body, textContent: toText(body) });
    return r.ok ? reply({ ok: true }) : reply({ error: brevoError(r) }, 502);
  }

  // ---- send to subscribers, one chunk per call
  const nid = String(input.newsletter_id || "");
  if (!/^[0-9a-f-]{36}$/.test(nid)) return reply({ error: "Save the newsletter first." }, 400);
  if (!base) return reply({ error: "The website address is missing: open Settings and press Save once." }, 400);
  const nr = await db(`newsletters?select=id,status&id=eq.${nid}`);
  const row = Array.isArray(nr.data) ? nr.data[0] : null;
  if (!row) return reply({ error: "Newsletter not found." }, 404);
  if (row.status === "sent") return reply({ error: "This newsletter has already been sent." }, 409);

  const subs: any[] = [];
  for (let from_ = 0; ; from_ += 1000) {
    const r = await db(`subscribers?select=id,email,name,token&status=eq.confirmed&order=created_at.asc&limit=1000&offset=${from_}`);
    if (!r.ok || !Array.isArray(r.data)) return reply({ error: "Could not read the subscribers." }, 500);
    subs.push(...r.data); if (r.data.length < 1000) break;
  }
  const done = new Set<string>();
  for (let from_ = 0; ; from_ += 1000) {
    const r = await db(`newsletter_sends?select=subscriber_id&newsletter_id=eq.${nid}&limit=1000&offset=${from_}`);
    if (!r.ok || !Array.isArray(r.data)) return reply({ error: "Could not read the send log." }, 500);
    r.data.forEach((x: any) => done.add(x.subscriber_id)); if (r.data.length < 1000) break;
  }
  const todo = subs.filter((s) => !done.has(s.id));
  let sentNow = 0, error = "";
  await db(`newsletters?id=eq.${nid}`, { method: "PATCH", body: { status: "sending", subject, preheader: input.preheader ? String(input.preheader).slice(0, 200) : null, html } });
  {
    const part = todo.slice(0, CHUNK);
    for (let i = 0; i < part.length; i += BATCH) {
      const group = part.slice(i, i + BATCH);
      const versions = group.map((s) => {
        const body = fill(html, { name: s.name || "", email: s.email, unsubscribe_url: `${base}/newsletter/?unsubscribe=${s.token}` });
        return { to: [{ email: s.email, ...(s.name ? { name: s.name } : {}) }], htmlContent: body, textContent: toText(body) };
      });
      const r = await brevo("smtp/email", { sender: from, ...(replyTo ? { replyTo } : {}), subject, htmlContent: versions[0].htmlContent, messageVersions: versions });
      if (!r.ok) { error = brevoError(r); break; }
      await db("newsletter_sends", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: group.map((s) => ({ newsletter_id: nid, subscriber_id: s.id })) });
      sentNow += group.length;
    }
  }
  const remaining = todo.length - sentNow;
  const total = done.size + sentNow;
  if (!error && remaining === 0) await db(`newsletters?id=eq.${nid}`, { method: "PATCH", body: { status: "sent", sent_at: new Date().toISOString(), sent_count: total } });
  else await db(`newsletters?id=eq.${nid}`, { method: "PATCH", body: { sent_count: total } });
  return reply({ ok: !error, sent_now: sentNow, total_sent: total, remaining, error: error || undefined });
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve && !(globalThis as any).__SPARK_TEST__) Deno.serve(handle);
