// API Sie Logistik — Gathering DTK x PERKOP Bali
// Data disimpan di Netlify Blobs (gratis, bawaan Netlify, tanpa database terpisah).
import { getStore } from "@netlify/blobs";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
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
// Tabel baru (misalnya rundown) ditambahkan ke data yang sudah berjalan tanpa mengubah tabel lama.
async function addMissingTables(st) {
  const cur = await st.getWithMetadata("db", { type: "json" });
  if (!cur || !cur.data || !cur.data.tables) return;
  const missing = Object.keys(SEED.tables).filter((k) => !cur.data.tables[k]);
  if (!missing.length) return;
  await mutate(st, "db", SEED, (d) => {
    const m = Object.keys(SEED.tables).filter((k) => !d.tables[k]);
    if (!m.length) return false;
    for (const k of m) d.tables[k] = structuredClone(SEED.tables[k]);
    d.rev = (d.rev || 0) + 1;
  });
}

async function upgradeIfNeeded(st, user) {
  await addMissingTables(st);
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


/* ================= Akun & login per orang =================
   Akun disimpan terpisah dari data (blob "accounts"), password di-hash dan tidak pernah dikirim ke HP.
   Peran: "Admin" (atur akses + spinwheel) dan "Anggota" (isi & ubah data). */
const ACC_KEY = "accounts";
const ACC_EMPTY = { users: {}, sessions: {} };
const hashPw = (pw, salt) => pbkdf2Sync(String(pw), salt, 60000, 32, "sha256").toString("hex");
const checkPw = (pw, u) => {
  const a = Buffer.from(hashPw(pw, u.salt), "hex"), b = Buffer.from(u.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};
const normUser = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, "").slice(0, 30);
const pubUser = (pid, u) => ({ pid, username: u.username, role: u.role });

// Pertama kali: Kahfi otomatis jadi Admin dengan password lama tim, supaya bisa mengatur akun lain.
async function ensureAccounts(st) {
  const cur = await read(st, ACC_KEY, ACC_EMPTY);
  if (Object.keys(cur.data.users).length) return cur.data;
  const db = (await read(st, "db", SEED)).data;
  const k = (db.tables.peserta || []).find((p) => /kahfi/i.test(p.nama)) || (db.tables.peserta || [])[0];
  return mutate(st, ACC_KEY, ACC_EMPTY, (a) => {
    if (Object.keys(a.users).length) return false;
    const salt = randomBytes(16).toString("hex");
    a.users[k.id] = { username: "kahfi", role: "Admin", salt, hash: hashPw(PASSWORD(), salt) };
  });
}
async function whoAmI(st, req) {
  const tok = req.headers.get("x-token") || "";
  if (!tok) return null;
  const a = await ensureAccounts(st);
  const sess = a.sessions[tok];
  const u = sess && a.users[sess.pid];
  return u ? { pid: sess.pid, username: u.username, role: u.role, token: tok } : null;
}
const displayName = (u) => u.username.charAt(0).toUpperCase() + u.username.slice(1);

async function accountRoute(st, route, req, me) {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (route === "account/logout") {
    await mutate(st, ACC_KEY, ACC_EMPTY, (a) => { delete a.sessions[me.token]; });
    return json({ ok: true });
  }
  if (route === "account/password") {
    const nw = String(body.new || "");
    if (nw.length < 6) return json({ error: "Password baru minimal 6 karakter" }, 400);
    let err = null;
    await mutate(st, ACC_KEY, ACC_EMPTY, (a) => {
      const u = a.users[me.pid];
      if (!checkPw(body.old || "", u)) { err = "Password lama salah"; return false; }
      u.salt = randomBytes(16).toString("hex"); u.hash = hashPw(nw, u.salt);
      for (const [t, s] of Object.entries(a.sessions)) if (s.pid === me.pid && t !== me.token) delete a.sessions[t];
    });
    if (err) return json({ error: err }, 400);
    return json({ ok: true });
  }
  if (route === "accounts" && req.method === "GET") {
    const a = (await read(st, ACC_KEY, ACC_EMPTY)).data;
    return json({ accounts: Object.entries(a.users).map(([pid, u]) => pubUser(pid, u)) });
  }
  if (route === "accounts/set") {
    if (me.role !== "Admin") return json({ error: "Hanya admin yang bisa mengatur akses" }, 403);
    const pid = String(body.pid || ""), role = ["Admin", "Anggota"].includes(body.role) ? body.role : "";
    const db = (await read(st, "db", SEED)).data;
    const p = (db.tables.peserta || []).find((x) => x.id === pid);
    if (!p) return json({ error: "Peserta tidak ditemukan" }, 404);
    let err = null, change = "";
    await mutate(st, ACC_KEY, ACC_EMPTY, (a) => {
      err = null; change = "";
      const u = a.users[pid];
      const admins = Object.entries(a.users).filter(([id, x]) => x.role === "Admin" && id !== pid).length;
      if (!role) {
        if (!u) return false;
        if (pid === me.pid) { err = "Tidak bisa mencabut akses akun sendiri"; return false; }
        if (u.role === "Admin" && !admins) { err = "Harus ada minimal satu admin"; return false; }
        delete a.users[pid];
        for (const [t, s] of Object.entries(a.sessions)) if (s.pid === pid) delete a.sessions[t];
        change = "akses dicabut"; return;
      }
      const username = normUser(body.username) || (u && u.username);
      if (!username) { err = "Nama pengguna wajib diisi"; return false; }
      if (Object.entries(a.users).some(([id, x]) => id !== pid && x.username === username)) { err = `Nama pengguna "${username}" sudah dipakai`; return false; }
      if (u && u.role === "Admin" && role !== "Admin" && !admins) { err = "Harus ada minimal satu admin"; return false; }
      const pin = String(body.password || "");
      if (!u && pin.length < 6) { err = "Buat password awal minimal 6 karakter"; return false; }
      if (pin && pin.length < 6) { err = "Password minimal 6 karakter"; return false; }
      const nu = u ? { ...u } : {};
      const parts = [];
      if (!u) parts.push(`akses ${role}`); else if (u.role !== role) parts.push(`peran ${u.role} → ${role}`);
      if (u && u.username !== username) parts.push(`nama pengguna ${username}`);
      nu.username = username; nu.role = role;
      if (pin) { nu.salt = randomBytes(16).toString("hex"); nu.hash = hashPw(pin, nu.salt); if (u) parts.push("password direset"); }
      a.users[pid] = nu;
      if (pin && u) for (const [t, s] of Object.entries(a.sessions)) if (s.pid === pid) delete a.sessions[t];
      change = parts.join(", ");
      if (!change) return false;
    });
    if (err) return json({ error: err }, 400);
    if (change) await addLog(st, [{ user: displayName(me), table: "peserta", tableLabel: "Akses aplikasi", action: "ubah", label: `${p.nama}: ${change}` }]);
    const a = (await read(st, ACC_KEY, ACC_EMPTY)).data;
    return json({ accounts: Object.entries(a.users).map(([id, u]) => pubUser(id, u)) });
  }
  return null;
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

  const st = store();

  // Foto hadiah: boleh dilihat tanpa login (dipakai layar penonton)
  if (route.startsWith("img/") && req.method === "GET") {
    const hid = decodeURIComponent(route.slice(4));
    const res = await st.getWithMetadata("img-" + hid, { type: "arrayBuffer" });
    if (!res || !res.data) return new Response("Not found", { status: 404 });
    return new Response(res.data, { headers: { "content-type": res.metadata?.type || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable" } });
  }

  // Rundown untuk peserta: boleh dibuka tanpa login, hanya berisi jadwal kegiatan.
  if (route === "rundown" && req.method === "GET") {
    try {
      await addMissingTables(st);
      const db = (await read(st, "db", SEED)).data;
      const rows = (db.tables.rundown || SEED.tables.rundown).map(({ id, day, urut, mulai, selesai, ikon, kegiatan, catatan, sub }) =>
        ({ id, day, urut, mulai, selesai, ikon, kegiatan, catatan, sub }));
      return json({ rows, rev: db.rev });
    } catch (e) { return json({ error: e.message }, 500); }
  }

  // Layar penonton spinwheel boleh dibuka tanpa login
  if (route === "spin/state") {
    try { return await spinRoute(st, route, req, null); } catch (e) { return json({ error: e.message }, 500); }
  }

  // Login: nama pengguna + password masing-masing. Token disimpan di HP, jadi cukup login sekali.
  if (route === "login" && req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const a = await ensureAccounts(st);
      const uname = normUser(body.username);
      const hit = Object.entries(a.users).find(([, u]) => u.username === uname);
      if (!hit || !checkPw(body.password || "", hit[1])) return json({ error: "Nama pengguna atau password salah" }, 401);
      const token = randomBytes(24).toString("hex");
      await mutate(st, ACC_KEY, ACC_EMPTY, (x) => { x.sessions[token] = { pid: hit[0], t: Date.now() }; });
      return json({ token, me: pubUser(hit[0], hit[1]) });
    } catch (e) { return json({ error: e.message }, 500); }
  }

  const me = await whoAmI(st, req).catch(() => null);
  if (!me) return json({ error: "Sesi berakhir. Silakan masuk lagi." }, 401);
  const user = displayName(me);

  try {
    await upgradeIfNeeded(st, user);

    if (route === "me") return json({ me: pubUser(me.pid, me) });
    if (route.startsWith("account") ) { const r = await accountRoute(st, route, req, me); if (r) return r; }

    if (route.startsWith("spin/")) {
      if (route !== "spin/refresh" && me.role !== "Admin") return json({ error: "Hanya admin yang bisa menjalankan spinwheel" }, 403);
      return await spinRoute(st, route, req, user);
    }

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
      if (me.role !== "Admin") return json({ error: "Hanya admin" }, 403);
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

