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

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

  const pass = req.headers.get("x-pass") || "";
  let user = "";
  try { user = decodeURIComponent(req.headers.get("x-user") || "").trim().slice(0, 40); } catch {}
  if (pass !== PASSWORD()) return json({ error: "Password salah" }, 401);
  if (!user) return json({ error: "Nama wajib diisi" }, 400);

  const st = store();

  try {
    if (route === "login") return json({ ok: true });

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

