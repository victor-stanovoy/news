// SparkNews: hands out LiveKit access tokens. Deploy as a Supabase Edge Function named "livekit-token"
// with "Verify JWT" switched OFF (this function checks who is asking itself). See README, "Live radio and TV".
//
// Secrets needed (Edge Functions > Secrets): LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
// The LiveKit secret never leaves this function. Browsers only ever receive short-lived tokens:
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
  const lkUrl = env("LIVEKIT_URL"), lkKey = env("LIVEKIT_API_KEY"), lkSecret = env("LIVEKIT_API_SECRET");
  const dbUrl = env("SUPABASE_URL").replace(/\/+$/, "");
  if (!lkUrl || !lkKey || !lkSecret) return reply({ error: "LiveKit is not configured: add the LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET secrets." }, 500);

  let input: { kind?: string; mode?: string };
  try { input = await req.json(); } catch { return reply({ error: "Bad request" }, 400); }
  const kind = input.kind, mode = input.mode;
  if (kind !== "radio" && kind !== "tv") return reply({ error: "Unknown channel" }, 400);
  if (mode !== "publish" && mode !== "watch") return reply({ error: "Unknown mode" }, 400);

  const apikey = req.headers.get("apikey") ?? "";
  const room = `sparknews-${kind}`;

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
