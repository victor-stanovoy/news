// SparkNews: hands out LiveKit access tokens. Deploy as a Supabase Edge Function named "livekit-token"
// with "Verify JWT" switched OFF (this function checks who is asking itself). See README, "Live radio and TV".
//
// The LiveKit URL, key and secret are read from the database table app_secrets (saved by an admin in the editor's
// Settings tab; supabase/settings.sql creates it). If that is empty, the Edge Function secrets LIVEKIT_URL,
// LIVEKIT_API_KEY and LIVEKIT_API_SECRET are used instead. The LiveKit secret never leaves this function. Browsers only ever receive short-lived tokens:
//   publish: only signed-in admins and editors
//   watch:   anyone, but only while that channel is on air

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const b64url = (bytes: Uint8Array | string) => {
  const u8 = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = ""; u8.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export async function signToken(key: string, secret: string, claims: Record<string, unknown>, ttlSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: key, nbf: now - 10, exp: now + ttlSeconds, ...claims }));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  const env = (n: string) => Deno.env.get(n) ?? "";
  const dbUrl = env("SUPABASE_URL").replace(/\/+$/, "");
  const saved: Record<string, string> = {};
  const svc = env("SUPABASE_SERVICE_ROLE_KEY");
  if (dbUrl && svc) {
    try {
      const r = await fetch(`${dbUrl}/rest/v1/app_secrets?select=key,value&key=in.(livekit_url,livekit_api_key,livekit_api_secret)`,
        { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
      if (r.ok) for (const row of await r.json()) saved[row.key] = row.value;
    } catch { /* fall back to the Edge Function secrets */ }
  }
  const lkUrl = saved.livekit_url || env("LIVEKIT_URL"), lkKey = saved.livekit_api_key || env("LIVEKIT_API_KEY"),
    lkSecret = saved.livekit_api_secret || env("LIVEKIT_API_SECRET");
  const needsLiveKit = !(lkUrl && lkKey && lkSecret);

  let input: { kind?: string; mode?: string };
  try { input = await req.json(); } catch { return reply({ error: "Bad request" }, 400); }
  const kind = input.kind, mode = input.mode;
  if (mode !== "check" && kind !== "radio" && kind !== "tv") return reply({ error: "Unknown channel" }, 400);
  if (mode !== "publish" && mode !== "watch" && mode !== "check") return reply({ error: "Unknown mode" }, 400);

  const apikey = req.headers.get("apikey") ?? "";
  const room = `sparknews-${kind}`;

  if (needsLiveKit) return reply({ error: "LiveKit is not set up yet: open the editor's Settings tab and enter the LiveKit address, API key and API secret." }, 500);

  if (mode === "check") {                                   // admins: "Test connection" button in Settings
    const auth = req.headers.get("authorization") ?? "";
    if (!/^Bearer eyJ/.test(auth)) return reply({ error: "Please sign in again." }, 401);
    const rr = await fetch(`${dbUrl}/rest/v1/rpc/editor_role`, { method: "POST", headers: { apikey, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
    if ((rr.ok ? await rr.json() : null) !== "admin") return reply({ error: "Only admins can test the connection." }, 403);
    const host = lkUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
    const adminToken = await signToken(lkKey, lkSecret, { sub: "sparknews-check", video: { roomList: true } }, 60);
    try {
      const lr = await fetch(`${host}/twirp/livekit.RoomService/ListRooms`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: "{}" });
      if (lr.status === 401 || lr.status === 403) return reply({ ok: false, error: "LiveKit rejected the API key or secret." });
      if (!lr.ok) return reply({ ok: false, error: `LiveKit answered with error ${lr.status}. Check the address.` });
      const j = await lr.json().catch(() => ({}));
      return reply({ ok: true, rooms: Array.isArray(j.rooms) ? j.rooms.length : 0 });
    } catch { return reply({ ok: false, error: "Could not reach LiveKit. Check the address (it looks like wss://yourproject.livekit.cloud)." }); }
  }

  if (mode === "publish") {
    const auth = req.headers.get("authorization") ?? "";
    if (!/^Bearer eyJ/.test(auth)) return reply({ error: "Please sign in again." }, 401);
    const r = await fetch(`${dbUrl}/rest/v1/rpc/editor_role`, {
      method: "POST", headers: { apikey, Authorization: auth, "Content-Type": "application/json" }, body: "{}",
    });
    const role = r.ok ? await r.json() : null;
    if (role !== "admin" && role !== "editor") return reply({ error: "Only editors and admins can go live." }, 403);
    const token = await signToken(lkKey, lkSecret, {
      sub: `host-${crypto.randomUUID().slice(0, 8)}`, name: "SparkNews",
      video: { room, roomJoin: true, canPublish: true, canSubscribe: false, canPublishData: false },
    }, 6 * 3600);
    return reply({ token, url: lkUrl, room });
  }

  const r = await fetch(`${dbUrl}/rest/v1/live_now?kind=eq.${kind}&select=kind`, { headers: { apikey, Authorization: `Bearer ${apikey}` } });
  const live = r.ok ? await r.json() : [];
  if (!Array.isArray(live) || live.length === 0) return reply({ error: "Not on air right now." }, 409);
  const token = await signToken(lkKey, lkSecret, {
    sub: `viewer-${crypto.randomUUID()}`,
    video: { room, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false },
  }, 2 * 3600);
  return reply({ token, url: lkUrl, room });
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve && !(globalThis as any).__SPARK_TEST__) Deno.serve(handle);
