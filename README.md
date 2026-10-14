# Logistik Bali — Gathering DTK x PERKOP 2026

Aplikasi web ringan pengganti file `Logistik_Akomodasi_Gathering_Bali_v3.xlsx`.
Data tersimpan di **Netlify Blobs** (bawaan Netlify, gratis, tanpa database terpisah).
Data awal sudah diisi otomatis dari Excel **v4** saat aplikasi pertama kali dibuka.

## Update ke data Excel baru
Situs yang sebelumnya berisi data v3 akan otomatis diganti ke data v4 saat pertama dibuka setelah deploy
(tercatat di Riwayat update sebagai "Sistem: Data diperbarui dari Excel v4").
Data lama tidak hilang: disalin ke blob `db-backup-v1` di Netlify Blobs.

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
  Properti, Gala dinner (checklist per segmen), Hadiah & souvenir, Belanja, Bawaan peserta (+ tombol salin ke grup WA), Timeline, Kontak (tombol telepon & WA)
- Simpan otomatis, beberapa orang bisa edit bersamaan tanpa saling menimpa (per kolom)
- Data tersinkron otomatis tiap 15 detik ke semua HP
- Menu akun → **Unduh semua data (Excel)** untuk backup / laporan

## Kembalikan ke data Excel awal (hati-hati, menghapus semua isian)
```bash
curl -X POST https://NAMA-SITE.netlify.app/api/reset \
  -H "x-pass: ciekebali" -H "x-user: Kahfi" -H "content-type: application/json" \
  -d '{"confirm":"RESET"}'
```

## Spinwheel doorprize (live di HP semua orang)
- Admin (siapa pun yang login dengan password tim) buka menu **Spinwheel**.
- Penonton buka **https://NAMA-SITE.netlify.app/spin**, tanpa password. Isinya hanya roda dan daftar pemenang.
  Link dan QR ada di panel admin.
- Alur: pilih hadiah, tekan "Umumkan ke semua HP", lalu tekan **SPIN**. Ada hitung mundur 3 detik,
  roda berputar sekitar 15 detik dan melambat dramatis di akhir, lalu nama pemenang tampil bersamaan di semua HP.
- Server yang memilih pemenang secara acak. Semua HP memutar roda mengikuti jam server, jadi hasilnya sama.
- Pemenang otomatis tercatat di menu Hadiah (Nama Penerima + Kartu simbolis) dan di Riwayat update.
- Pemenang keluar dari roda. Kalau pemenang tidak hadir: "Tidak hadir, putar ulang".
- Setelah uji coba (gladi), tekan "Kosongkan (setelah uji coba)" supaya hasil percobaan terhapus.
- Pemakaian kuota Netlify: setiap HP mengecek server tiap 1 detik selama halaman terbuka.
  30 HP selama 30 menit kira-kira 54 ribu request, masih jauh di bawah kuota paket gratis.

### Ikut doorprize & foto hadiah
- Menu Peserta punya kolom **Ikut doorprize** (Ya/Tidak). Pegawai otomatis "Ya", keluarga (anak, pasangan) otomatis "Tidak".
  Bisa diubah di menu Peserta atau di panel Spinwheel. Hanya yang "Ya" yang masuk roda.
- Menu Hadiah: buka hadiah, tekan "Pilih foto" (bisa langsung kamera HP), lalu Simpan perubahan.
  Foto dikecilkan otomatis di HP sebelum diunggah. Foto muncul saat hadiah diumumkan dan di kartu pemenang.
