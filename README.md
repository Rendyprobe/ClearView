# ClearView — Smart Popup Cleaner

> Ekstensi Chromium yang secara cerdas mengidentifikasi dan menghapus overlay anti-adblock, modal popup yang mengganggu, dan penghalang akses konten — tanpa merusak elemen halaman yang sah.

---

## Daftar Isi

1. [Fitur Utama](#fitur-utama)
2. [Cara Kerja](#cara-kerja)
3. [Instalasi di Chrome / Brave / Edge](#instalasi)
4. [Cara Memuat Ekstensi Unpacked](#memuat-ekstensi-unpacked)
5. [Penggunaan](#penggunaan)
6. [Pengaturan (Settings)](#pengaturan)
7. [Perizinan (Permissions)](#perizinan)
8. [Privasi](#privasi)
9. [Struktur Proyek](#struktur-proyek)
10. [Menjalankan Tes](#menjalankan-tes)
11. [Troubleshooting](#troubleshooting)
12. [Keterbatasan yang Diketahui](#keterbatasan)
13. [Pengembangan Selanjutnya](#pengembangan-selanjutnya)

---

## Fitur Utama

| Fitur | Deskripsi |
|---|---|
| 🔍 **Deteksi Multi-Sinyal** | Menggabungkan analisis teks, struktur DOM, dan perilaku untuk menentukan apakah suatu elemen bersifat invasif |
| 🎯 **Skor Kepercayaan** | Setiap elemen mendapat skor 0–100. Hanya elemen dengan skor tinggi yang dihapus otomatis |
| 🛡️ **Perlindungan Konten Sah** | Login, pembayaran, GDPR/cookie consent, verifikasi usia, dan CAPTCHA selalu dilindungi |
| ↩️ **Undo** | Semua penghapusan bersifat reversibel — elemen hanya disembunyikan, tidak dihapus permanen |
| 👁️ **Preview Mode** | Sorot overlay yang terdeteksi tanpa menghapusnya |
| 🔄 **Dukungan SPA** | MutationObserver mendeteksi overlay yang diinjeksi secara dinamis di aplikasi React/Vue/Angular |
| 📋 **Allowlist/Blocklist** | Kontrol per-domain yang dapat dikonfigurasi |
| 📊 **Diagnostik Lokal** | Log detail dapat ditinjau dan dihapus kapan saja |

---

## Cara Kerja

ClearView menggunakan mesin deteksi berlapis:

### A. Sinyal Teks
Mencocokkan pola regex pada teks yang terlihat di dalam elemen:
- Frasa anti-adblock: *"ad blocker detected"*, *"disable your ad blocker"*, *"whitelist this website"*
- Newsletter: *"subscribe to our newsletter"*, *"enter your email"*
- Promosi: *"limited time offer"*, *"free trial"*

Teks dinormalisasi dengan Unicode NFKC, case-insensitive, dan normalisasi spasi.

### B. Sinyal Struktur DOM
- `position: fixed / absolute` + z-index tinggi
- Cakupan viewport > 50% atau > 80%
- Elemen backdrop semi-transparan
- `role="dialog"` atau `aria-modal="true"`
- Tombol close/dismiss
- Elemen child langsung dari `<body>`
- Pemblokiran scroll pada `<body>` atau `<html>`

### C. Sinyal Pengecualian (Exclusion)
Elemen yang mengandung kata-kata berikut **tidak akan pernah dihapus**:
- `login`, `sign in`, `password`
- `payment`, `checkout`, `billing`
- `cookie`, `gdpr`, `privacy policy`
- `age verification`, `captcha`
- `terms of service`

### D. Model Skor

```
Skor = Σ (bobot sinyal positif) + Σ (bobot sinyal negatif)
     → diklem pada rentang 0–100
```

| Sinyal | Bobot |
|---|---|
| Teks anti-adblock kuat | +40 |
| Cakupan viewport penuh (>80%) | +20 |
| Backdrop semi-transparan | +18 |
| Position fixed | +10 |
| Z-index > 9999 | +12 |
| Teks pengecualian terdeteksi | −60 |
| Di dalam `<article>` / `<main>` | −15 |
| Media player | −30 |
| Elemen navigasi | −25 |
| Root aplikasi | −50 |

**Ambang batas penghapusan otomatis:**
- Conservative: skor ≥ 80
- **Balanced (default): skor ≥ 65**
- Aggressive: skor ≥ 50

---

## Instalasi

### Persyaratan
- Browser Chromium: **Google Chrome**, **Brave**, **Microsoft Edge** (versi terbaru)
- Tidak memerlukan Node.js, build tools, atau dependensi eksternal

### Unduh Kode
```
git clone https://github.com/your-repo/clearview.git
```
atau unduh sebagai ZIP dan ekstrak ke folder pilihan Anda.

---

## Memuat Ekstensi Unpacked

### Google Chrome

1. Buka Chrome, ketik `chrome://extensions` di address bar → tekan Enter
2. Aktifkan **"Developer mode"** (toggle di pojok kanan atas)
3. Klik tombol **"Load unpacked"**
4. Navigasi ke folder `clearview/` (folder yang berisi `manifest.json`) → klik **Select Folder**
5. Ekstensi ClearView akan muncul di daftar. Pastikan toggle aktif (berwarna biru)
6. Ikon ClearView akan muncul di toolbar browser

### Brave Browser

1. Buka Brave, ketik `brave://extensions` di address bar → tekan Enter
2. Aktifkan **"Developer mode"** (toggle di pojok kanan atas)
3. Klik **"Load unpacked"**
4. Pilih folder `clearview/` → klik **Select Folder**
5. Saat Brave meminta konfirmasi, pilih **"Use anyway"**

> **Catatan untuk Brave:** Brave Shields tidak memblokir content script yang dimuat secara lokal (unpacked extension). ClearView bekerja secara harmonis dengan Brave Shields.

### Microsoft Edge

1. Buka Edge, ketik `edge://extensions` di address bar → tekan Enter
2. Aktifkan **"Developer mode"** (toggle di panel kiri bawah)
3. Klik **"Load unpacked"**
4. Pilih folder `clearview/` → klik **Select Folder**

---

## Penggunaan

### Popup (Klik Ikon di Toolbar)

| Elemen | Fungsi |
|---|---|
| **Toggle Utama** | Aktifkan/nonaktifkan ClearView sepenuhnya |
| **Removed** | Jumlah elemen yang dihapus di tab aktif |
| **Mode** | Sensitivitas deteksi yang aktif |
| **Domain** | Domain halaman saat ini |
| **Scan This Page** | Jalankan pemindaian manual segera |
| **Undo Last Cleanup** | Pulihkan elemen yang terakhir dihapus |
| **Allowlist This Site** | Tambahkan domain ke allowlist (nonaktifkan ClearView di sini) |
| **Open Settings** | Buka halaman pengaturan lengkap |

### Cara Kerja Otomatis

1. Saat Anda membuka halaman web, ClearView menunggu 800ms untuk halaman selesai dimuat
2. Pemindaian awal dijalankan
3. MutationObserver tetap aktif untuk mendeteksi overlay yang diinjeksi kemudian
4. Overlay dengan skor kepercayaan tinggi dihapus secara otomatis (jika Auto Cleanup aktif)
5. Badge di ikon menampilkan jumlah elemen yang ditangani

---

## Pengaturan

Buka **Settings** dari popup atau ketik `chrome://extensions` → klik **Details** → **Extension options**.

### Tab General
- **Enable ClearView** — Master switch
- **Automatic Cleanup** — Hapus otomatis overlay berkepercayaan tinggi
- **Preview Mode** — Sorot saja, jangan hapus
- **Monitor Dynamic Changes** — MutationObserver untuk SPA

### Tab Detection
- **Sensitivity** — Conservative / Balanced / Aggressive
- **Exclusion Keywords** — Kata kunci yang mencegah penghapusan elemen
- **Language** — Pengaturan bahasa (saat ini: teks selalu dinilai)

### Tab Domains
- **Allowlist** — Domain yang sepenuhnya dilewati
- **Monitor List** — Domain yang selalu dipindai agresif

### Tab Patterns
- **Custom Text Patterns** — Regex tambahan buatan pengguna

### Tab Diagnostics
- Log lokal semua aktivitas ClearView
- Dapat dihapus kapan saja
- Tidak merekam konten halaman atau kredensial

### Import/Export
- Gunakan tombol **Export JSON** di sidebar untuk menyimpan semua pengaturan
- Gunakan **Import JSON** untuk memulihkan atau berbagi konfigurasi

---

## Perizinan

| Izin | Alasan Diperlukan |
|---|---|
| `storage` | Menyimpan pengaturan dan log diagnostik secara lokal di browser |
| `activeTab` | Mengakses URL tab aktif untuk tampilan popup dan pemeriksaan domain |
| `scripting` | Mengirim pesan ke content script yang berjalan di tab aktif |
| `tabs` | Mengquery URL tab untuk menentukan apakah halaman dibatasi (chrome://, edge://) |
| `host_permissions: <all_urls>` | Menginjeksi content script ke semua halaman HTTP/HTTPS agar deteksi dapat berjalan otomatis |

**Tidak ada izin berikut yang diminta:**
- `history` — Riwayat browser tidak diakses
- `cookies` — Cookie tidak dibaca atau diubah
- `webRequest` — Lalu lintas jaringan tidak dipantau
- `identity` — Tidak ada akses ke akun Google/browser

---

## Privasi

- ✅ Tidak ada data yang dikirim ke server eksternal
- ✅ Tidak ada riwayat browsing yang direkam
- ✅ Tidak ada konten halaman, URL, atau formulir yang disimpan ke cloud
- ✅ Semua pengaturan disimpan di `chrome.storage.local` (perangkat Anda sendiri)
- ✅ Log diagnostik dibatasi ukurannya (default: 200 entri) dan dapat dihapus kapan saja
- ✅ Ekstensi tidak dapat berjalan di halaman browser internal (chrome://, edge://, brave://)

---

## Struktur Proyek

```
clearview/
├── manifest.json          # Manifest V3 — definisi ekstensi
├── background.js          # Service worker — koordinasi, badge, storage
├── content.js             # Content script — deteksi, scoring, cleanup, MutationObserver
├── popup.html             # UI popup toolbar
├── popup.css              # Styling popup
├── popup.js               # Controller popup
├── options.html           # Halaman pengaturan lengkap
├── options.css            # Styling halaman pengaturan
├── options.js             # Controller halaman pengaturan
├── rules/
│   ├── detection.js       # Pola teks, heuristik struktur DOM (modul ES)
│   ├── scoring.js         # Model skor kepercayaan (modul ES)
│   └── cleanup.js         # Engine cleanup & undo (modul ES)
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── tests/
│   ├── test-fixture.html  # Halaman pengujian dengan 10 skenario
│   └── checklist.js       # Checklist pengujian manual
└── README.md              # Dokumentasi ini
```

> **Catatan Arsitektur:** `content.js` adalah IIFE (non-module) yang berisi semua logika inline. Folder `rules/` berisi modul ES terpisah yang dirancang untuk penggunaan di lingkungan bundler atau pengujian unit di masa depan. Duplikasi ini disengaja untuk kompatibilitas MV3 content script.

---

## Menjalankan Tes

### Memuat Halaman Uji
1. Muat ekstensi sebagai unpacked (lihat instruksi instalasi)
2. Buka file `tests/test-fixture.html` di browser:
   - Di Chrome/Brave: seret file ke jendela browser, atau tekan `Ctrl+O`
   - URL akan menjadi `file:///path/to/clearview/tests/test-fixture.html`

> **Penting:** Untuk content script berjalan di halaman file://, perlu mengaktifkan akses ke URL file di pengaturan ekstensi:  
> `chrome://extensions` → ClearView → Details → aktifkan **"Allow access to file URLs"**

### Menjalankan Checklist Manual
```bash
node tests/checklist.js
```
Akan menampilkan 16 test case beserta langkah dan hasil yang diharapkan.

### Skenario Pengujian
| # | Skenario | Hasil yang Diharapkan |
|---|---|---|
| TC-01 | Modal anti-adblock | ✅ Terdeteksi dan disembunyikan |
| TC-02 | Backdrop terhubung | ✅ Disembunyikan bersama modal |
| TC-03 | Overlay dinamis | ✅ Terdeteksi oleh MutationObserver |
| TC-04 | Newsletter popup | ✅ Disembunyikan |
| TC-05 | Dialog login | ❌ Harus TETAP TAMPIL |
| TC-06 | Cookie consent | ❌ Harus TETAP TAMPIL |
| TC-07 | Video player | ❌ Harus TETAP TAMPIL |
| TC-08 | Artikel tentang adblock | ❌ Teks artikel TIDAK disentuh |
| TC-09 | Modal ambigu (preview mode) | 🟡 Di-highlight saja |
| TC-10 | Overlay berulang kali diinjeksi | ✅ Setiap reinsersi dideteksi |
| TC-11 | Undo | ✅ Elemen dipulihkan |
| TC-12 | Nonaktifkan ekstensi | ✅ Tidak ada cleanup |
| TC-13 | Allowlist domain | ✅ Domain dilewati |
| TC-14 | Setelah refresh | ✅ Ekstensi berjalan normal |
| TC-15 | Export/Import pengaturan | ✅ Berhasil |
| TC-16 | Penggunaan CPU | ✅ < 5% konsisten |

---

## Troubleshooting

### Ekstensi tidak aktif di halaman tertentu
- Halaman `chrome://`, `edge://`, `brave://`, `about:`, dan `chrome-extension://` tidak dapat diakses oleh content script. Ini adalah batasan keamanan browser, bukan bug ClearView.
- Popup akan menampilkan peringatan "Cannot run on this page type."

### Overlay tidak terdeteksi
- Coba ubah sensitivity ke **Aggressive** di Settings
- Tambahkan pola teks kustom di tab **Patterns** yang cocok dengan teks pada overlay tersebut
- Gunakan **"Scan This Page"** secara manual (pemindaian paksa)
- Tambahkan domain ke **Monitor List** di tab Domains

### Elemen yang sah ikut dihapus (false positive)
- Ubah sensitivity ke **Conservative**
- Tambahkan kata kunci relevan ke **Exclusion Keywords** di Settings → Detection
- Tambahkan domain ke **Allowlist** jika seluruh situs bermasalah
- Klik **"Undo Last Cleanup"** untuk memulihkan elemen

### Popup menampilkan "Content script not reachable"
- Refresh halaman (F5) dan coba lagi
- Pastikan ekstensi diaktifkan di `chrome://extensions`
- Pastikan tab tidak dalam posisi loading

### Badge tidak muncul
- Klik ikon ClearView → pastikan master toggle dalam posisi ON
- Verifikasi ekstensi di `chrome://extensions` tidak dalam status error (ikon merah)

### Pengaturan tidak tersimpan
- Klik tombol **"Save Settings"** yang muncul di bar atas setiap kali ada perubahan
- Jika masalah berlanjut, coba **Reset Defaults** lalu konfigurasi ulang

### Di Brave: Shields memblokir ekstensi
Brave Shields tidak memblokir ekstensi yang dimuat secara lokal. Jika ada konflik:
1. Klik ikon Brave Shields di address bar
2. Pastikan mode Shields tidak diset ke "Block all scripts"
3. Ekstensi ClearView berjalan di sisi klien, bukan melalui jaringan

---

## Keterbatasan

1. **Website dengan obfuscation agresif** — Beberapa situs mengenkripsi atau mengaburkan teks overlay sehingga pencocokan pola teks tidak efektif. Dalam kasus ini, sinyal struktural (ukuran, z-index) menjadi satu-satunya sumber sinyal.

2. **Canvas/WebGL overlays** — Overlay yang dirender menggunakan `<canvas>` atau WebGL tidak dapat dideteksi melalui DOM biasa.

3. **Shadow DOM** — Elemen yang berada di dalam Shadow DOM tertutup mungkin tidak terdeteksi oleh pemindai saat ini.

4. **Reinsersi agresif** — Beberapa situs menggunakan `requestAnimationFrame` atau loop yang sangat cepat untuk menyisipkan ulang overlay. ClearView memiliki batas throttle untuk mencegah penggunaan CPU berlebihan, yang berarti reinsersi sangat cepat mungkin tidak selalu tertangani.

5. **Iframe** — Overlay yang ada di dalam iframe lintas-origin tidak dapat diakses karena kebijakan same-origin browser.

6. **Perubahan sensitif per halaman** — Angka ambang skor global mungkin terlalu konservatif untuk beberapa situs dan terlalu agresif untuk situs lain. Aturan per-domain dapat membantu.

7. **File URL di Chrome/Brave** — Content script tidak berjalan di `file://` secara default. Aktifkan "Allow access to file URLs" di detail ekstensi untuk menguji halaman lokal.

---

## Pengembangan Selanjutnya

- [ ] **Aturan berbasis komunitas** — Database aturan yang dikurasi (diunduh, tidak dieksekusi dari jarak jauh)
- [ ] **Dukungan Shadow DOM** — Traversal Shadow DOM untuk mendeteksi overlay tersembunyi
- [ ] **Deteksi Canvas overlay** — Analisis heuristik untuk canvas yang menutupi viewport
- [ ] **Panel samping** (Side Panel API) — Antarmuka yang lebih kaya tanpa menutup popup
- [ ] **Sinkronisasi pengaturan** — `chrome.storage.sync` opsional untuk berbagi antar perangkat
- [ ] **Ekspor CSV log diagnostik** — Untuk analisis lebih lanjut
- [ ] **Pola bahasa tambahan** — Bahasa Indonesia, Spanyol, Portugis, dll.
- [ ] **Pengujian otomatis** — Playwright/Puppeteer untuk test E2E terhadap halaman uji
- [ ] **Build pipeline** — Webpack/Rollup untuk bundling modul ES rules/ ke dalam content script

---

## Lisensi

MIT License. Lihat file `LICENSE` untuk detail.

---

*ClearView dibuat dengan tujuan mengembalikan akses pengguna ke konten yang sah — bukan untuk memfasilitasi pemblokiran iklan yang tidak etis. Harap gunakan dengan bijak.*

