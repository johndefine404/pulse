// [Define404] pulse: 사람만 세는 방문 집계 서버 (Cloudflare Workers + Durable Objects SQLite).
// 화면 쪽 pulse.js 가 보내는 신호만 받는다: view(페이지 열림), human(스크롤·터치·클릭·키 입력), engaged(그 뒤 10초), convert(전환).
// 쿠키는 쓰지 않고 접속 주소(IP)는 저장하지 않는다(호출 한도 셀 때만 쓴다). 방문자 구분은 각 사이트 브라우저 저장소의 무작위 값뿐이다.
import { DurableObject } from "cloudflare:workers";

const KINDS = ["view", "human", "engaged", "convert"];
const KEEP_DAYS = 395; // 13개월 지난 기록은 지운다
const MAX_BODY = 2048; // 신호 한 건의 최대 크기(바이트)
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|python|curl|wget|monitor|scan/i;

// 신호를 받을 사이트 = 출처 목록. wrangler 설정의 [vars] SITES 에 둔다.
const sitesOf = (env) => {
  const raw = typeof env.SITES === "string" ? JSON.parse(env.SITES) : env.SITES || {};
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, [].concat(v)])); // 출처 하나만 문자열로 적어도 목록으로 바꾼다
};
// 날짜를 자르는 시간대(분). 기본 0(UTC). 예: 하노이 420, 서울 540
const offsetOf = (env) => Number(env.TZ_OFFSET_MINUTES || 0) * 60000;
const dayOf = (ts, off) => new Date(ts + off).toISOString().slice(0, 10);

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.off = offsetOf(env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ev (ts INTEGER, day TEXT, site TEXT, kind TEXT, vid TEXT, path TEXT, ref TEXT, name TEXT, bot INTEGER)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS ev_site_day ON ev(site, day)");
  }
  add(e) {
    const ts = Date.now();
    if (Math.random() < 0.01) this.sql.exec("DELETE FROM ev WHERE ts < ?", ts - KEEP_DAYS * 86400000);
    this.sql.exec("INSERT INTO ev VALUES (?,?,?,?,?,?,?,?,?)", ts, dayOf(ts, this.off), e.site, e.kind, e.vid, e.path, e.ref, e.name, e.bot ? 1 : 0);
  }
  purge(vid) {
    return this.sql.exec("DELETE FROM ev WHERE vid = ? RETURNING 1", String(vid).slice(0, 40)).toArray().length;
  }
  summary(days) {
    const since = dayOf(Date.now() - (days - 1) * 86400000, this.off);
    const rows = (q, ...a) => this.sql.exec(q, ...a).toArray();
    const sites = {};
    for (const r of rows(
      `SELECT site, day,
        SUM(kind='view' AND bot=0) AS views,
        COUNT(DISTINCT CASE WHEN kind='view' AND bot=0 THEN vid END) AS visitors,
        COUNT(DISTINCT CASE WHEN kind='human' AND bot=0 THEN vid END) AS humans,
        COUNT(DISTINCT CASE WHEN kind='engaged' AND bot=0 THEN vid END) AS engaged,
        SUM(kind='convert' AND bot=0) AS converts,
        SUM(bot=1) AS bot_views
      FROM ev WHERE day >= ? GROUP BY site, day ORDER BY day`, since)) {
      (sites[r.site] ||= { daily: {} }).daily[r.day] = r;
    }
    for (const s of Object.keys(sites)) {
      sites[s].refs = rows(`SELECT ref AS name, COUNT(*) AS n FROM ev WHERE site=? AND kind='view' AND bot=0 AND ref!='' AND day>=? GROUP BY ref ORDER BY n DESC LIMIT 8`, s, since);
      sites[s].converts = rows(`SELECT name, COUNT(*) AS n FROM ev WHERE site=? AND kind='convert' AND bot=0 AND day>=? GROUP BY name ORDER BY n DESC LIMIT 8`, s, since);
      sites[s].pages = rows(`SELECT path AS name, COUNT(DISTINCT vid) AS n FROM ev WHERE site=? AND kind='human' AND bot=0 AND day>=? GROUP BY path ORDER BY n DESC LIMIT 8`, s, since);
    }
    return { since, days, sites };
  }
}

const cors = (origin) => ({ "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", vary: "origin" });
const clean = (v, n) => String(v ?? "").slice(0, n);
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

// 조회 열쇠는 주소가 아니라 머리말(Authorization: Bearer ...)로만 받는다. 접속 기록에 열쇠가 남지 않게 한다.
async function authorized(request, env) {
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.STATS_KEY || !got) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([got, env.STATS_KEY].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const store = () => env.STORE.get(env.STORE.idFromName("main"));

    // 집계 조회: GET /stats?days=14
    if (url.pathname === "/stats") {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
      if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
      const asked = parseInt(url.searchParams.get("days") || "14", 10);
      const days = Math.min(KEEP_DAYS, Math.max(1, Number.isNaN(asked) ? 14 : asked));
      return json(await store().summary(days));
    }

    // 방문자 한 명의 기록 삭제(삭제 요청 대응): POST /purge {"vid": "..."}
    if (url.pathname === "/purge") {
      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
      let vid = "";
      try { vid = clean((await request.json()).vid, 40); } catch {}
      if (!vid) return json({ error: "vid required" }, 400);
      return json({ deleted: await store().purge(vid) });
    }

    // 화면 신호 받기: POST /e
    if (url.pathname !== "/e") return new Response("Not Found", { status: 404 });
    const sites = sitesOf(env);
    const origin = request.headers.get("origin") || "";
    const site = Object.keys(sites).find((k) => sites[k].includes(origin));
    if (request.method === "OPTIONS") return site ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (!site) return new Response(null, { status: 403 });
    // 호출 한도(선택): wrangler 설정에 LIMITER 가 있으면 접속 주소별로 센다. 주소는 세기만 하고 저장하지 않는다.
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("cf-connecting-ip") || "unknown" });
      if (!success) return new Response(null, { status: 429, headers: cors(origin) });
    }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return new Response(null, { status: 413, headers: cors(origin) });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY) return new Response(null, { status: 413, headers: cors(origin) });
    let b;
    try {
      b = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400, headers: cors(origin) });
    }
    if (!b || !KINDS.includes(b.kind)) return new Response(null, { status: 400, headers: cors(origin) });
    let ref = "";
    try {
      const h = new URL(b.ref || "").hostname;
      if (h && !sites[site].some((o) => new URL(o).hostname === h)) ref = h;
    } catch {}
    await store().add({
      site, kind: b.kind, vid: clean(b.vid, 40), path: clean(b.path, 200), ref, name: clean(b.name, 80),
      bot: BOT.test(request.headers.get("user-agent") || ""),
    });
    return new Response(null, { status: 204, headers: cors(origin) });
  },
};
