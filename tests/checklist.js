/**
 * ClearView — tests/checklist.js
 * Manual test checklist runner (Node.js or browser console).
 * Run: node tests/checklist.js
 */

const CHECKLIST = [
  {
    id: 'TC-01',
    name: 'Anti-adblock modal terdeteksi dan dihapus',
    description: 'Buka test-fixture.html, klik "1. Adblock Modal", lalu scan.',
    expected: 'Modal "Ad Blocker Detected" disembunyikan. Badge menampilkan angka.',
    automated: false
  },
  {
    id: 'TC-02',
    name: 'Backdrop terhubung dihapus bersama modal',
    description: 'Aktifkan modal adblock DAN backdrop bersamaan, lalu scan.',
    expected: 'Keduanya disembunyikan. Scrolling dipulihkan.',
    automated: false
  },
  {
    id: 'TC-03',
    name: 'Overlay yang diinjeksi secara dinamis terdeteksi',
    description: 'Klik "3. Dynamic Overlay". Tunggu overlay muncul, lalu scan.',
    expected: 'Overlay terdeteksi meski diinjeksi setelah load awal.',
    automated: false
  },
  {
    id: 'TC-04',
    name: 'Newsletter popup terdeteksi',
    description: 'Klik "4. Newsletter", lalu scan.',
    expected: 'Newsletter popup disembunyikan (skor ≥ 65).',
    automated: false
  },
  {
    id: 'TC-05',
    name: 'Login dialog TIDAK dihapus',
    description: 'Klik "5. Login Dialog", lalu scan.',
    expected: 'Dialog login tetap tampil. Kata kunci "login" / "password" menghasilkan exclusion.',
    automated: false
  },
  {
    id: 'TC-06',
    name: 'Cookie consent TIDAK dihapus',
    description: 'Klik "6. Cookie Consent", lalu scan.',
    expected: 'Banner cookie consent tetap tampil.',
    automated: false
  },
  {
    id: 'TC-07',
    name: 'Video player TIDAK dihapus',
    description: 'Scroll ke video player di halaman, lalu scan.',
    expected: 'Video player tetap utuh.',
    automated: false
  },
  {
    id: 'TC-08',
    name: 'Teks artikel tidak memicu false positive',
    description: 'Scroll ke bagian artikel yang membahas ad blocker, lalu scan.',
    expected: 'Teks artikel tidak disentuh. Tidak ada elemen dihapus dari dalam <article>.',
    automated: false
  },
  {
    id: 'TC-09',
    name: 'Modal ambigu hanya di-highlight dalam preview mode',
    description: 'Aktifkan Preview Mode di settings. Klik "9. Ambiguous Modal", scan.',
    expected: 'Modal mendapat outline cyan tapi tidak disembunyikan.',
    automated: false
  },
  {
    id: 'TC-10',
    name: 'Reinsersi overlay ditangani oleh MutationObserver',
    description: 'Klik "10. Reinsert Overlay". Biarkan berjalan 10 detik.',
    expected: 'MutationObserver mendeteksi reinsersi dan menyembunyikan ulang overlay setiap kali muncul.',
    automated: false
  },
  {
    id: 'TC-11',
    name: 'Undo berhasil mengembalikan elemen',
    description: 'Scan halaman (hapus overlay). Klik "Undo Last Cleanup" di popup.',
    expected: 'Elemen yang disembunyikan kembali tampil. Badge count berkurang.',
    automated: false
  },
  {
    id: 'TC-12',
    name: 'Menonaktifkan ekstensi menghentikan semua aktivitas',
    description: 'Toggle OFF di popup. Refresh halaman.',
    expected: 'Tidak ada cleanup otomatis. Badge menampilkan "OFF".',
    automated: false
  },
  {
    id: 'TC-13',
    name: 'Allowlist mencegah pemrosesan pada domain',
    description: 'Klik "Allowlist This Site" di popup. Scan ulang.',
    expected: 'Tidak ada elemen diproses. Status menampilkan "Site is allowlisted".',
    automated: false
  },
  {
    id: 'TC-14',
    name: 'Ekstensi berfungsi setelah browser refresh',
    description: 'Scan halaman, hapus overlay. Refresh halaman (F5).',
    expected: 'Ekstensi berjalan normal. Counter kembali ke 0 (per-tab).',
    automated: false
  },
  {
    id: 'TC-15',
    name: 'Export/Import pengaturan berfungsi',
    description: 'Di Settings → Export JSON. Edit file. Import kembali. Verifikasi perubahan tersimpan.',
    expected: 'Pengaturan berhasil di-export dan di-import tanpa error.',
    automated: false
  },
  {
    id: 'TC-16',
    name: 'Penggunaan CPU tidak berlebihan',
    description: 'Buka DevTools → Performance. Aktifkan "10. Reinsert Overlay" selama 30 detik.',
    expected: 'CPU usage content script tidak melebihi 5% secara konsisten.',
    automated: false
  },
  {
    id: 'TC-17',
    name: 'Popup & overlay clickjacking pada video provider diblokir',
    description: 'Scroll ke Scenario 14 di test-fixture.html, klik tombol Play atau klik overlay video.',
    expected: 'Overlay transparan dihapus otomatis, window.open diblokir, dan video play button terlindungi.',
    automated: false
  },
  {
    id: 'TC-18',
    name: 'Iframe penyedia video terlindungi (all_frames & match_about_blank)',
    description: 'Buka situs streaming dengan embed player iframe (misal doodstream/streamtape). Klik video player.',
    expected: 'Popup tab tidak terbuka, tabunder dicegah, dan playback video berjalan normal tanpa gangguan popunder.',
    automated: false
  },
  {
    id: 'TC-19',
    name: 'Doodstream anti-adblock banner & bait check (Brave Shields) didefuse',
    description: 'Buka Scenario 15 di test-fixture.html atau tonton video Doodstream di browser Brave.',
    expected: 'Banner oranye dihilangkan, variabel umpan (canRunAds/offsetHeight) tersimulasi aman, dan video player dapat diputar lancar.',
    automated: false
  }
];

// Console output
console.log('\n══════════════════════════════════════════════');
console.log('  ClearView — Manual Test Checklist');
console.log('══════════════════════════════════════════════\n');

CHECKLIST.forEach(tc => {
  console.log(`[${tc.id}] ${tc.name}`);
  console.log(`  Steps:    ${tc.description}`);
  console.log(`  Expected: ${tc.expected}`);
  console.log(`  Status:   [ ] PASS  [ ] FAIL  [ ] SKIP`);
  console.log('');
});

console.log('══════════════════════════════════════════════');
console.log(`Total tests: ${CHECKLIST.length}`);
console.log('Note: All tests require manual execution with the extension loaded.\n');

module.exports = { CHECKLIST };

