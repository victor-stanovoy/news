// SparkNews royalty-free music library. Deploy as a Supabase Edge Function named "music-library" with "Verify JWT"
// switched OFF (it checks who is asking itself). No account or key is needed: it searches Openverse (openverse.org),
// a free catalogue of openly licensed audio, and only ever offers tracks you may use commercially.
//
// Staff only (admins and editors):
//   search  { q, page }  -> list of tracks with license and credit
//   import  { id }       -> copies the track into your private audio library, with its license and credit
//
// The file address is never taken from the browser: import looks the track up at Openverse again by its id,
// so this function cannot be used to download arbitrary web addresses.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const API = "https://api.openverse.org/v1/audio/";
const LICENSES = ["cc0", "pdm", "by", "by-sa"];        // free for commercial use (no NonCommercial, no NoDerivatives)
const MAX_BYTES = 50 * 1048576;
const ID = /^[0-9a-f-]{8,64}$/i;
const UA = { "User-Agent": "SparkNews-music-library/1.0", Accept: "application/json" };

export function licenseName(lic: string, ver: string): string {
  const l = String(lic || "").toLowerCase();
  if (l === "cc0") return "CC0 (public domain)";
  if (l === "pdm") return "Public domain";
  return `CC ${l.toUpperCase()}${ver ? " " + ver : ""}`;
}

/** One Openverse result, reduced to what the editor needs. Returns null when it may not be offered. */
export function normalize(r: Record<string, unknown>) {
  const lic = String(r.license || "").toLowerCase();
  if (!LICENSES.includes(lic) || !r.id || !r.url || !/^https:\/\//i.test(String(r.url))) return null;
  const credit = String(r.attribution || "").trim() ||
    `"${r.title || "Untitled"}"${r.creator ? " by " + r.creator : ""} is licensed under ${licenseName(lic, String(r.license_version || ""))}.`;
  return {
    id: String(r.id), title: String(r.title || "Untitled").slice(0, 160), creator: String(r.creator || "").slice(0, 120),
    license: licenseName(lic, String(r.license_version || "")), license_url: String(r.license_url || ""),
    credit: credit.slice(0, 600), source_url: String(r.foreign_landing_url || ""), duration: Math.round(Number(r.duration || 0) / 1000),
    genre: Array.isArray(r.genres) ? (r.genres as unknown[]).map((g) => (typeof g === "string" ? g : (g as Record<string, string>)?.name)).filter(Boolean).slice(0, 3).join(", ") : "",
    preview: String(r.url), thumbnail: String(r.thumbnail || ""), filetype: String(r.filetype || ""), needs_credit: lic === "by" || lic === "by-sa",
  };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const env = (n: string) => Deno.env.get(n) ?? "";
  const dbUrl = env("SUPABASE_URL").replace(/\/+$/, ""), svc = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!dbUrl || !svc) return reply({ error: "The function has no database access." }, 500);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return reply({ error: "Bad request" }, 400); }

  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) return reply({ error: "Please sign in to the editor first." }, 401);
  const who = await fetch(`${dbUrl}/rest/v1/rpc/editor_role`, {
    method: "POST", headers: { apikey: req.headers.get("apikey") || svc, Authorization: auth, "Content-Type": "application/json" }, body: "{}",
  });
  const role = who.ok ? await who.json().catch(() => null) : null;
  if (role !== "admin" && role !== "editor") return reply({ error: "Only editors and admins can use the music library." }, 403);

  const mode = String(input.mode || "");
  if (mode === "search") {
    const q = String(input.q || "").trim().slice(0, 100);
    const page = Math.min(20, Math.max(1, Math.floor(Number(input.page) || 1)));
    const u = new URL(API);
    if (q) u.searchParams.set("q", q);
    u.searchParams.set("license", LICENSES.join(","));
    u.searchParams.set("page", String(page)); u.searchParams.set("page_size", "20");
    let res: Response;
    try { res = await fetch(u, { headers: UA }); } catch { return reply({ error: "Could not reach the music catalogue. Try again in a moment." }, 502); }
    if (!res.ok) return reply({ error: res.status === 429 ? "The free catalogue is busy. Wait a minute and try again." : `The music catalogue answered with an error (${res.status}).` }, 502);
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    const items = ((data.results as Record<string, unknown>[]) || []).map(normalize).filter(Boolean);
    return reply({ ok: true, items, page, pages: Math.min(20, Number(data.page_count) || 1) });
  }

  if (mode === "import") {
    const id = String(input.id || "");
    if (!ID.test(id)) return reply({ error: "Unknown track" }, 400);
    let meta: Record<string, unknown>;
    try {
      const res = await fetch(API + id + "/", { headers: UA });
      if (!res.ok) return reply({ error: "That track is no longer in the catalogue." }, 404);
      meta = await res.json();
    } catch { return reply({ error: "Could not reach the music catalogue. Try again in a moment." }, 502); }
    const t = normalize(meta);
    if (!t) return reply({ error: "This track's license does not allow use on a news site." }, 422);

    // already imported? (same source, same title) -> do not copy twice
    const dup = await fetch(`${dbUrl}/rest/v1/tracks?select=id&source_url=eq.${encodeURIComponent(t.source_url || "x:" + id)}&limit=1`, { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
    if (dup.ok && (await dup.json().catch(() => [])).length) return reply({ ok: true, already: true });

    let file: Response;
    try { file = await fetch(String(meta.url), { headers: { "User-Agent": UA["User-Agent"] }, redirect: "follow" }); } catch { return reply({ error: "Could not download the audio file." }, 502); }
    if (!file.ok) return reply({ error: `The audio file could not be downloaded (${file.status}).` }, 502);
    const len = Number(file.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return reply({ error: "That file is larger than 50 MB." }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return reply({ error: "That file is larger than 50 MB." }, 413);
    let type = (file.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^audio\//.test(type)) {
      const ext = String(meta.filetype || "").toLowerCase();
      type = ({ mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac" } as Record<string, string>)[ext] || "";
    }
    if (!type) return reply({ error: "That file is not an audio file." }, 415);
    const ext = ({ "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/webm": "webm" } as Record<string, string>)[type] || "mp3";
    const path = `${Date.now()}-openverse-${id.slice(0, 8)}.${ext}`;

    const up = await fetch(`${dbUrl}/storage/v1/object/audio/${path}`, {
      method: "POST", headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": type, "x-upsert": "false" }, body: bytes,
    });
    if (!up.ok) return reply({ error: "Could not save the file. Did you run supabase/music.sql?" }, 500);
    const ins = await fetch(`${dbUrl}/rest/v1/tracks`, {
      method: "POST", headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ title: t.title, path, kind: "music", size: bytes.byteLength, source: "openverse", license: t.license, credit: t.credit, source_url: t.source_url || "x:" + id, duration: t.duration || null }),
    });
    if (!ins.ok) {
      await fetch(`${dbUrl}/storage/v1/object/audio/${path}`, { method: "DELETE", headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
      return reply({ error: "Could not add the track to the library. Run supabase/music.sql again (it was updated)." }, 500);
    }
    return reply({ ok: true, title: t.title });
  }
  return reply({ error: "Unknown mode" }, 400);
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve && !(globalThis as any).__SPARK_TEST__) Deno.serve(handle);
