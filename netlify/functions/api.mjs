// API Sie Logistik — Gathering DTK x PERKOP Bali
// Data disimpan di Netlify Blobs (gratis, bawaan Netlify, tanpa database terpisah).
import { getStore } from "@netlify/blobs";
import SEED from "./seed.mjs";

export const config = { path: "/api/*" };

const PASSWORD = () => process.env.APP_PASSWORD || "ciekebali";
const LOG_MAX = 2000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const store = () => getStore({ name: "gathering-bali", consistency: "strong" });

async function read(st, key, fallback) {
  const res = await st.getWithMetadata(key, { type: "json" });
  if (res && res.data) return { data: res.data, etag: res.etag };
  await st.setJSON(key, fallback, { onlyIfNew: true });
  const again = await st.getWithMetadata(key, { type: "json" });
  return { data: again.data, etag: again.etag };
}

// Kalau data tersimpan masih versi Excel lama, ganti dengan data Excel terbaru.
// Data lama disalin dulu ke "db-backup-v<versi>" supaya bisa dipulihkan.
async function upgradeIfNeeded(st, user) {
  const cur = await st.getWithMetadata("db", { type: "json" });
  if (!cur || !cur.data) return;
  const oldV = cur.data.seedVersion || 1;
  if (oldV >= SEED.seedVersion) return;
  await st.setJSON(`db-backup-v${oldV}`, cur.data);
  const fresh = structuredClone(SEED);
  fresh.rev = (cur.data.rev || 1) + 1;
  const res = await st.setJSON("db", fresh, { onlyIfMatch: cur.etag });
  if (res && res.modified === false) return; // sudah diperbarui oleh request lain
  await mutate(st, "log", [], (log) => {
    log.push({ id: Date.now().toString(36), t: new Date().toISOString(), user: "Sistem", table: "-", tableLabel: "Sistem",
      label: `Data diperbarui dari Excel v${SEED.seedVersion}`, action: "reset", changes: [] });
  });
}

// Baca → ubah → tulis dengan cek versi (etag). Kalau ada yang menyimpan bersamaan, ulangi.
async function mutate(st, key, fallback, fn) {
  for (let i = 0; i < 8; i++) {
    const { data, etag } = await read(st, key, fallback);
    const out = fn(data);
    if (out === false) return data;
    const res = await st.setJSON(key, data, { onlyIfMatch: etag });
    if (!res || res.modified !== false) return data;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new Error("Server sibuk, coba simpan lagi");
}

const clean = (v) => (v === null || v === undefined ? "" : String(v).slice(0, 2000));

function applyOps(db, ops) {
  const entries = [];
  for (const op of ops) {
    const rows = db.tables[op.table];
    if (!rows) continue;
    const base = { table: op.table, tableLabel: clean(op.tableLabel), label: clean(op.label) };

    if (op.op === "update") {
      let row = rows.find((r) => r.id === op.id);
      const isNew = !row;
      if (isNew) {
        row = { id: String(op.id) };
        rows.push(row);
      }
      const changes = [];
      for (const [k, v] of Object.entries(op.changes || {})) {
        if (k === "id") continue;
        const from = clean(row[k]);
        const to = clean(v);
        if (from === to) continue;
        row[k] = to;
        changes.push({ f: clean(op.fieldLabels?.[k] || k), from, to });
      }
      if (changes.length) entries.push({ ...base, action: "ubah", changes });
    } else if (op.op === "add") {
      const row = { ...(op.row || {}) };
      row.id = clean(row.id) || Date.now().toString(36);
      if (rows.some((r) => r.id === row.id)) row.id += Math.random().toString(36).slice(2, 5);
      for (const k of Object.keys(row)) row[k] = clean(row[k]);
      rows.push(row);
      entries.push({ ...base, action: "tambah", changes: [] });
    } else if (op.op === "delete") {
      const idx = rows.findIndex((r) => r.id === op.id);
      if (idx < 0) continue;
      rows.splice(idx, 1);
      entries.push({ ...base, action: "hapus", changes: [] });
    }
  }
  return entries;
}


/* ================= Spinwheel doorprize =================
   Server yang memilih pemenang dan jam mulai putaran (startAt).
   Semua HP memutar roda yang sama mengikuti jam server, jadi hasilnya tampil serentak. */
const SPIN_KEY = "spin";
const SPIN_DUR = 15000;     // lama putaran (ms), sengaja lama supaya dramatis
const SPIN_LEAD = 3000;     // hitung mundur sebelum roda berputar (ms)
const SPIN_EMPTY = { v: 0, announce: null, current: null, history: [], exclude: [], pool: [] };

function randInt(n) {
  const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n;
}
// Ikut doorprize: kolom "doorprize" di Peserta (Ya/Tidak). Kalau belum diisi: pegawai ikut, keluarga tidak.
const ikutDoorprize = (p) => p.doorprize ? p.doorprize === "Ya" : p.status !== "Keluarga";
function buildPool(db, spin) {
  const won = new Set(spin.history.filter((h) => !h.void).map((h) => h.pid));
  const ex = new Set(spin.exclude); // yang dibatalkan karena tidak hadir
  return (db.tables.peserta || []).filter((p) => p.nama && ikutDoorprize(p) && !won.has(p.id) && !ex.has(p.id)).map((p) => ({ id: p.id, nama: p.nama }));
}
function imgOf(db, hid) {
  const h = hid && (db.tables.hadiah || []).find((x) => x.id === hid);
  return h && h.gambar ? `/api/img/${encodeURIComponent(hid)}?v=${encodeURIComponent(h.gambar)}` : "";
}
const spinPublic = (s) => ({
  v: s.v, now: Date.now(), announce: s.announce && { prize: s.announce.prize, img: s.announce.img || "" }, pool: s.pool.map((p) => p.nama), exclude: s.exclude,
  current: s.current && { id: s.current.id, prize: s.current.prize, img: s.current.img || "", names: s.current.names, winnerIdx: s.current.winnerIdx,
    jitter: s.current.jitter, turns: s.current.turns, startAt: s.current.startAt, dur: s.current.dur },
  history: s.history.map((h) => ({ id: h.id, prize: h.prize, img: h.img || "", winner: h.winner, revealAt: h.revealAt, void: !!h.void })),
});
const spinning = (s) => s.current && Date.now() < s.current.startAt + s.current.dur;

async function addLog(st, entries) {
  const t = new Date().toISOString();
  await mutate(st, "log", [], (log) => {
    log.push(...entries.map((e, i) => ({ id: Date.now().toString(36) + "s" + i, t, changes: [], ...e })));
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  });
}
async function setHadiah(st, hadiahId, penerima, kartu) {
  if (!hadiahId) return;
  await mutate(st, "db", SEED, (d) => {
    const h = (d.tables.hadiah || []).find((x) => x.id === hadiahId);
    if (!h) return false;
    h.penerima = penerima; h.kartu = kartu; d.rev = (d.rev || 0) + 1;
  });
}

async function spinRoute(st, route, req, user) {
  // Layar penonton: tanpa password, hanya nama peserta & hasil undian.
  if (route === "spin/state") {
    const s = (await read(st, SPIN_KEY, SPIN_EMPTY)).data;
    if (!s.v) s.pool = buildPool((await read(st, "db", SEED)).data, s); // belum pernah disentuh admin
    const v = Number(new URL(req.url).searchParams.get("v") || -1);
    if (v === s.v) return json({ v: s.v, now: Date.now(), same: 1 });
    return json(spinPublic(s));
  }
  if (!user) return null; // rute admin di bawah butuh login tim
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const db = (await read(st, "db", SEED)).data;
  let err = null, logs = [], hadiahOps = [];

  const s = await mutate(st, SPIN_KEY, SPIN_EMPTY, (s) => {
    err = null; logs = []; hadiahOps = [];
    if (route === "spin/refresh") { /* hitung ulang daftar peserta */ }
    else if (route === "spin/announce") {
      const prize = clean(body.prize).slice(0, 80).trim();
      if (spinning(s)) { err = "Tunggu roda berhenti dulu"; return false; }
      s.announce = prize ? { prize, hadiahId: clean(body.hadiahId), by: user } : null;
    }
    else if (route === "spin/exclude") {
      s.exclude = Array.isArray(body.exclude) ? body.exclude.map(clean).slice(0, 200) : s.exclude;
    }
    else if (route === "spin/go") {
      if (spinning(s)) { err = "Roda masih berputar"; return false; }
      if (!s.announce) { err = "Umumkan hadiahnya dulu"; return false; }
      const pool = buildPool(db, s);
      if (!pool.length) { err = "Tidak ada peserta tersisa di undian"; return false; }
      const wi = randInt(pool.length);
      const startAt = Date.now() + SPIN_LEAD;
      const id = Date.now().toString(36) + randInt(1e6).toString(36);
      const img = imgOf(db, s.announce.hadiahId);
      s.current = { id, prize: s.announce.prize, hadiahId: s.announce.hadiahId, img, names: pool.map((p) => p.nama),
        // jitter: posisi berhenti di dalam segmen pemenang. Dibuat dekat batas antar nama supaya menegangkan.
        winnerIdx: wi, jitter: (randInt(2) ? 1 : -1) * (0.22 + randInt(1000) / 1000 * 0.2), turns: 5 + randInt(2), startAt, dur: SPIN_DUR, by: user };
      s.history.push({ id, prize: s.announce.prize, hadiahId: s.announce.hadiahId, img, pid: pool[wi].id, winner: pool[wi].nama,
        by: user, t: new Date().toISOString(), revealAt: startAt + SPIN_DUR });
      logs = [{ user, table: "hadiah", tableLabel: "Spinwheel", action: "spin", label: `${s.announce.prize}: ${pool[wi].nama}` }];
      hadiahOps = [[s.announce.hadiahId, pool[wi].nama, "✓"]];
      s.announce = null;
    }
    else if (route === "spin/void") {
      if (spinning(s)) { err = "Tunggu roda berhenti dulu"; return false; }
      const h = s.history.find((x) => x.id === body.id && !x.void);
      if (!h) { err = "Hasil tidak ditemukan"; return false; }
      h.void = true;
      if (!s.exclude.includes(h.pid)) s.exclude.push(h.pid);
      s.announce = { prize: h.prize, hadiahId: h.hadiahId, by: user };
      if (s.current && s.current.id === h.id) s.current = null;
      logs = [{ user, table: "hadiah", tableLabel: "Spinwheel", action: "batal", label: `${h.prize}: ${h.winner} (tidak hadir)` }];
      hadiahOps = [[h.hadiahId, "", ""]];
    }
    else if (route === "spin/reset") {
      if (body.confirm !== "RESET") { err = "Konfirmasi salah"; return false; }
      hadiahOps = s.history.filter((h) => !h.void && h.hadiahId).map((h) => [h.hadiahId, "", ""]);
      s.history = []; s.current = null; s.announce = null; s.exclude = [];
      logs = [{ user, table: "hadiah", tableLabel: "Spinwheel", action: "reset", label: "Spinwheel dikosongkan (uji coba selesai)" }];
    }
    else { err = "Tidak ditemukan"; return false; }
    s.pool = buildPool(db, s);
    if (s.announce) s.announce.img = imgOf(db, s.announce.hadiahId);
    s.v = (s.v || 0) + 1;
  });
  if (err) return json({ error: err }, 409);
  for (const [hid, nama, kartu] of hadiahOps) await setHadiah(st, hid, nama, kartu);
  if (logs.length) await addLog(st, logs);
  return json(spinPublic(s));
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

  const pass = req.headers.get("x-pass") || "";
  let user = "";
  try { user = decodeURIComponent(req.headers.get("x-user") || "").trim().slice(0, 40); } catch {}
  const st = store();

  // Foto hadiah: boleh dilihat tanpa login (dipakai layar penonton)
  if (route.startsWith("img/") && req.method === "GET") {
    const hid = decodeURIComponent(route.slice(4));
    const res = await st.getWithMetadata("img-" + hid, { type: "arrayBuffer" });
    if (!res || !res.data) return new Response("Not found", { status: 404 });
    return new Response(res.data, { headers: { "content-type": res.metadata?.type || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable" } });
  }

  // Layar penonton spinwheel boleh dibuka tanpa login
  if (route === "spin/state") {
    try { return await spinRoute(st, route, req, null); } catch (e) { return json({ error: e.message }, 500); }
  }

  if (pass !== PASSWORD()) return json({ error: "Password salah" }, 401);
  if (!user) return json({ error: "Nama wajib diisi" }, 400);

  try {
    if (route === "login") return json({ ok: true });

    await upgradeIfNeeded(st, user);

    if (route.startsWith("spin/")) return await spinRoute(st, route, req, user);

    // Upload / hapus foto hadiah. Foto sudah dikecilkan di HP sebelum dikirim.
    if (route.startsWith("img/") && (req.method === "POST" || req.method === "DELETE")) {
      const hid = decodeURIComponent(route.slice(4)).slice(0, 60);
      if (req.method === "DELETE") { await st.delete("img-" + hid); return json({ ok: true }); }
      const body = await req.json().catch(() => ({}));
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.data || "");
      if (!m) return json({ error: "Format foto tidak didukung" }, 400);
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 1500000) return json({ error: "Foto terlalu besar (maks 1,5 MB)" }, 400);
      await st.set("img-" + hid, buf, { metadata: { type: m[1] } });
      return json({ ok: true, v: Date.now().toString(36) });
    }

    if (route === "data" && req.method === "GET") {
      const { data } = await read(st, "db", SEED);
      const since = Number(url.searchParams.get("rev") || 0);
      if (since && since === data.rev) return json({ rev: data.rev, unchanged: true });
      const log = (await read(st, "log", [])).data;
      return json({ ...data, recentLog: log.slice(-12).reverse() });
    }

    if (route === "log" && req.method === "GET") {
      const log = (await read(st, "log", [])).data;
      const limit = Math.min(Number(url.searchParams.get("limit") || 300), LOG_MAX);
      return json({ log: log.slice(-limit).reverse(), total: log.length });
    }

    if (route === "ops" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const ops = Array.isArray(body.ops) ? body.ops.slice(0, 200) : [];
      if (!ops.length) return json({ error: "Tidak ada perubahan" }, 400);

      let entries = [];
      const db = await mutate(st, "db", SEED, (d) => {
        entries = applyOps(d, ops);
        if (!entries.length) return false;
        d.rev = (d.rev || 0) + 1;
      });

      if (entries.length) {
        const t = new Date().toISOString();
        const stamped = entries.map((e, i) => ({ id: Date.now().toString(36) + i, t, user, ...e }));
        await mutate(st, "log", [], (log) => {
          log.push(...stamped);
          if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
        });
      }
      const log = (await read(st, "log", [])).data;
      return json({ ...db, recentLog: log.slice(-12).reverse() });
    }

    // Kembalikan semua data ke isi Excel awal (hanya jika diminta eksplisit)
    if (route === "reset" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.confirm !== "RESET") return json({ error: "Konfirmasi salah" }, 400);
      const fresh = structuredClone(SEED);
      const cur = (await read(st, "db", SEED)).data;
      fresh.rev = (cur.rev || 1) + 1;
      await st.setJSON("db", fresh);
      await mutate(st, "log", [], (log) => {
        log.push({ id: Date.now().toString(36), t: new Date().toISOString(), user, table: "-", tableLabel: "Sistem", label: "Semua data", action: "reset", changes: [] });
      });
      return json({ ok: true });
    }

    return json({ error: "Tidak ditemukan" }, 404);
  } catch (err) {
    return json({ error: err.message || "Terjadi kesalahan di server" }, 500);
  }
};

