# Logistik Bali — Gathering DTK x PERKOP 2026

Aplikasi web ringan pengganti file `Logistik_Akomodasi_Gathering_Bali_v3.xlsx`.
Data tersimpan di **Netlify Blobs** (bawaan Netlify, gratis, tanpa database terpisah).
Data awal sudah diisi otomatis dari Excel saat aplikasi pertama kali dibuka.

## Isi folder
- `public/index.html` — seluruh tampilan aplikasi (1 file, tanpa framework)
- `netlify/functions/api.mjs` — API simpan/update + pencatat riwayat
- `netlify/functions/seed.mjs` — data awal dari Excel
- `netlify.toml`, `package.json` — konfigurasi Netlify

## Cara deploy (pilih salah satu)

> ⚠️ Jangan pakai drag & drop (Netlify Drop). Cara itu tidak menjalankan
> fungsi server, jadi data tidak bisa disimpan.

### A. Lewat GitHub (paling gampang di-update)
1. Buat repo baru di GitHub, upload semua isi folder ini.
2. Di Netlify: **Add new site → Import an existing project → GitHub** → pilih repo.
3. Build command dikosongkan, publish directory otomatis `public` (dari netlify.toml). Klik **Deploy**.

### B. Lewat Netlify CLI
```bash
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```
(Pertama kali akan ditanya mau buat site baru — pilih *Create & configure a new site*.)

## Login
- Saat pertama buka: isi **nama** + **password tim** (`ciekebali`).
- Tersimpan di browser, jadi cukup sekali per HP/laptop.
- Nama dipakai di **Riwayat update**: siapa mengubah apa, dari nilai apa ke apa, jam berapa.

### Ganti password (opsional)
Netlify → Site configuration → Environment variables → tambah `APP_PASSWORD` = password baru → Deploy ulang.
Semua anggota tim otomatis diminta login lagi.

## Fitur
- Ringkasan (pengganti sheet Panduan): hitung mundur, rekap otomatis, cek "harus nol", tugas terdekat, perlu dikonfirmasi, aktivitas terbaru
- Peserta, Kamar (kartu per kamar + centang kunci), Head count per titik (✓ / X / –), Bagasi (status overbagasi otomatis),
  Properti, Hadiah & souvenir, Belanja, Bawaan peserta (+ tombol salin ke grup WA), Timeline, Kontak (tombol telepon & WA)
- Simpan otomatis, beberapa orang bisa edit bersamaan tanpa saling menimpa (per kolom)
- Data tersinkron otomatis tiap 15 detik ke semua HP
- Menu akun → **Unduh semua data (Excel)** untuk backup / laporan

## Kembalikan ke data Excel awal (hati-hati, menghapus semua isian)
```bash
curl -X POST https://NAMA-SITE.netlify.app/api/reset \
  -H "x-pass: ciekebali" -H "x-user: Kahfi" -H "content-type: application/json" \
  -d '{"confirm":"RESET"}'
```
