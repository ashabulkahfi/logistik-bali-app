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

## Login & akun
- Setiap orang punya akun sendiri: **nama pengguna + password**. Login cukup sekali per HP/laptop.
- Akun pertama otomatis: **kahfi** (Admin) dengan password `ciekebali` (atau nilai `APP_PASSWORD` di Netlify).
  Segera ganti lewat menu akun (lingkaran inisial kanan atas) > Ganti password.
- Admin memberi akses dari menu **Peserta**: buka nama orangnya > bagian **Akses aplikasi** > pilih peran,
  isi nama pengguna & password awal > Simpan. Kirim nama pengguna & password ke orangnya lewat WA.
- Peran: **Admin** = atur akses + jalankan spinwheel. **Anggota** = isi & ubah data.
- Cabut akses: pilih "Tidak punya akses". Orang itu langsung keluar dari aplikasi di HP-nya.
- Lupa password: admin isi "Reset password" di bagian Akses aplikasi.
- Semua perubahan tercatat atas nama pengguna masing-masing di Riwayat update.

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
  -H "x-token: TOKEN_ADMIN" -H "content-type: application/json" \
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

### Pindah kamar
- Menu Kamar: seret nama ke kamar lain (di laptop seret namanya, di HP tahan pegangan ⋮⋮ di kiri nama).
  Bawa ke tepi atas/bawah layar untuk menggulir. Lepas di kotak "Belum dapat kamar" untuk mengeluarkan dari kamar.
- Ketuk nama untuk pindah lewat pilihan kamar, atau tukar kamar dengan peserta lain.
- "Tambah penghuni" di tiap kamar memilih dari daftar Peserta, tidak perlu mengetik nama.
- "Tambah kamar" (kanan atas menu Kamar) membuat kamar baru dengan nomor berikutnya. Kamar kosong bisa dihapus.
- Semua pindahan tercatat di Riwayat update.

## Rundown
- Menu **Rundown**: jadwal 3 hari (waktu Bali / WITA) dari rundown final panitia.
  Admin & Anggota bisa ubah jam/isi (ketuk kegiatan), geser urutan (↑ ↓), tambah/hapus, atau "Urutkan sesuai jam".
- Baris INTIMATE GALA DINNER punya tombol **Susunan acara** (16 segmen dari sheet Gala Dinner-Acara). Tombol yang sama ada di menu Gala dinner.
- Peserta membuka **https://NAMA-SITE.netlify.app/rundown** tanpa login: hanya jadwal (tanpa susunan acara gala dinner),
  tombol Salin untuk WA, dan penanda "Sedang berlangsung" saat hari H. Perubahan dari tim langsung terlihat.
- Saat update ke versi ini, tabel rundown ditambahkan otomatis ke data yang sudah ada. Data lama tidak diubah.
