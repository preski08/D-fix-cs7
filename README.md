# Dompetku v3.7.4 — BTC Pure ESM Fix

## Perbaikan
- **Error `exports is not defined` dihilangkan** — library diganti ke pure ESM (`@scure` + `@noble`)
- UI BTC full-screen dark (mirip wallet modern): balance, Receive / Send / Refresh / Lock
- Pilih jaringan: **Mainnet** atau **Testnet**
- Buat dompet + password (min 8) → recovery phrase → alamat bc1/tb1 otomatis
- Terima (QR + salin alamat) · Kirim (fee estimate + broadcast Esplora)
- Non-custodial: private key terenkripsi lokal (PBKDF2 + AES-GCM)

## Cara pakai
1. Extract semua file ke folder yang sama
2. Buka `index.html` (atau deploy GitHub Pages)
3. **Hard refresh** `Ctrl+Shift+R`
4. Login → tekan **BTC** di header
5. Pilih jaringan → buat / buka dengan kata sandi
6. Catat recovery phrase offline

## Catatan
- Butuh internet untuk load library & data blockchain
- Testnet3 & Testnet4: alamat `tb1…` (Testnet4 memakai explorer mempool.space/testnet4) · Mainnet: `bc1…`
- Kirim BTC nyata hanya di Mainnet — uji dengan jumlah kecil

## Changelog
- Tambah Testnet4 (explorer mempool.space/testnet4). Testnet3 & Testnet4 memakai alamat tb1 yang sama, jadi saldo di kedua jaringan bisa dicek dari satu dompet.
- Pin @noble/hashes@1.4.0 untuk semua dependensi esm.sh (perbaiki "noble-hashes have no entry-point").
