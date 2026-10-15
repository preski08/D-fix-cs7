/* Dompetku BTC — non-custodial, pure ESM (@noble + @scure)
 * Tidak pakai bip32/bitcoinjs yang sering "exports is not defined".
 * Generate alamat P2WPKH (bc1) sederhana, kirim/terima via Blockstream Esplora.
 */
(function () {
  'use strict';

  var KEY = 'dk_btc_wallet_v2';
  var TXKEY = 'dk_btc_local_tx_v2';
  var NET_KEY = 'dk_btc_network';

  var libs = { bip39: null, bip32: null, secp: null, base: null, hashes: null, wordlist: null };
  var libsReady = false;
  var libsError = null;
  var libsLoading = null;

  var wallet = null;
  var password = null;
  var feeRate = 5;
  var balanceSats = 0;
  var utxos = [];
  var history = [];
  var btcPrice = { idr: 0, usd: 0 };
  var network = localStorage.getItem(NET_KEY) || 'mainnet';

  function $(id) { return document.getElementById(id); }
  function satToBtc(s) { return (Number(s || 0) / 1e8); }
  function fmtBtc(s) { return satToBtc(s).toFixed(8) + ' BTC'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Daftar API explorer. Jika satu gagal, otomatis pakai yang berikutnya.
  // Testnet3 & Testnet4 sama-sama memakai prefix tb1 dan coin type 1',
  // jadi alamat (dan saldo) yang sama muncul di keduanya; yang beda hanya explorer.
  function isTestnet() { return network === 'testnet' || network === 'testnet4'; }
  function apiBases() {
    if (network === 'testnet4') return ['https://mempool.space/testnet4/api'];
    if (network === 'testnet') return ['https://blockstream.info/testnet/api', 'https://mempool.space/testnet/api'];
    return ['https://blockstream.info/api', 'https://mempool.space/api'];
  }
  function netLabel() {
    return network === 'testnet4' ? 'Testnet4' : (network === 'testnet' ? 'Testnet3' : 'Mainnet');
  }
  var chainBase = null;
  function esplora() {
    var list = apiBases();
    return (chainBase && list.indexOf(chainBase) >= 0) ? chainBase : list[0];
  }
  function hrp() { return isTestnet() ? 'tb' : 'bc'; }

  var CDN = [
    {
      bip39: 'https://esm.sh/@scure/bip39@1.2.2?deps=@noble/hashes@1.4.0',
      wordlist: 'https://esm.sh/@scure/bip39@1.2.2/wordlists/english.js',
      bip32: 'https://esm.sh/@scure/bip32@1.4.0?deps=@noble/hashes@1.4.0',
      secp: 'https://esm.sh/@noble/secp256k1@2.1.0?deps=@noble/hashes@1.4.0',
      base: 'https://esm.sh/@scure/base@1.1.9?deps=@noble/hashes@1.4.0',
      hashes: ['https://esm.sh/@noble/hashes@1.4.0/sha256', 'https://esm.sh/@noble/hashes@1.4.0/ripemd160', 'https://esm.sh/@noble/hashes@1.4.0/hmac']
    },
    {
      bip39: 'https://cdn.jsdelivr.net/npm/@scure/bip39@1.2.2/+esm',
      wordlist: 'https://cdn.jsdelivr.net/npm/@scure/bip39@1.2.2/wordlists/english.js/+esm',
      bip32: 'https://cdn.jsdelivr.net/npm/@scure/bip32@1.4.0/+esm',
      secp: 'https://cdn.jsdelivr.net/npm/@noble/secp256k1@2.1.0/+esm',
      base: 'https://cdn.jsdelivr.net/npm/@scure/base@1.1.9/+esm',
      hashes: ['https://cdn.jsdelivr.net/npm/@noble/hashes@1.4.0/sha256/+esm', 'https://cdn.jsdelivr.net/npm/@noble/hashes@1.4.0/ripemd160/+esm', 'https://cdn.jsdelivr.net/npm/@noble/hashes@1.4.0/hmac/+esm']
    }
  ];

  function ensureLibs() {
    if (libsReady) return Promise.resolve(true);
    if (libsLoading) return libsLoading;
    libsLoading = (async function () {
      var last = null;
      for (var i = 0; i < CDN.length; i++) {
        try {
          var set = CDN[i];
          var mods = await Promise.all([
            import(set.bip39),
            import(set.wordlist),
            import(set.bip32),
            import(set.secp),
            import(set.base),
            Promise.all(set.hashes.map(function (u) { return import(u); }))
          ]);
          libs.bip39 = mods[0];
          libs.wordlist = mods[1].wordlist || mods[1].default || mods[1];
          libs.bip32 = mods[2];
          libs.secp = mods[3];
          libs.base = mods[4];
          libs.hashes = {
            sha256: mods[5][0].sha256,
            ripemd160: mods[5][1].ripemd160,
            hmac: mods[5][2].hmac
          };
          if (libs.secp.etc && libs.secp.etc.hmacSha256Sync == null && libs.hashes.hmac && libs.hashes.sha256) {
            libs.secp.etc.hmacSha256Sync = function (k) {
              var msgs = Array.prototype.slice.call(arguments, 1);
              var h = libs.hashes.hmac.create(libs.hashes.sha256, k);
              msgs.forEach(function (x) { h.update(x); });
              return h.digest();
            };
          }
          if (!libs.bip39.generateMnemonic || !libs.bip32.HDKey) {
            throw new Error('Library tidak lengkap');
          }
          libsReady = true;
          libsError = null;
          console.log('[DKBTC] pure ESM ready via set', i + 1);
          return true;
        } catch (e) {
          last = e;
          console.warn('[DKBTC] set', i + 1, 'gagal:', e.message || e);
        }
      }
      libsError = last ? (last.message || String(last)) : 'Gagal memuat library';
      throw new Error(libsError);
    })().finally(function () { libsLoading = null; });
    return libsLoading;
  }

  function hex(buf) {
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }
  function fromHex(s) {
    return new Uint8Array((s.match(/.{1,2}/g) || []).map(function (x) { return parseInt(x, 16); }));
  }
  function bytes(str) { return new TextEncoder().encode(str); }

  async function deriveAes(pass, salt, iterations) {
    iterations = iterations || 210000;
    var material = await crypto.subtle.importKey('raw', bytes(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function encryptWallet(mnemonic, pass) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveAes(pass, salt);
    var cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes(mnemonic));
    return {
      v: 2, salt: hex(salt), iv: hex(iv), cipher: hex(cipher),
      iterations: 210000, network: network, createdAt: Date.now()
    };
  }

  async function decryptWallet(rec, pass) {
    var key = await deriveAes(pass, fromHex(rec.salt), rec.iterations || 210000);
    var plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromHex(rec.iv) }, key, fromHex(rec.cipher)
    );
    return new TextDecoder().decode(plain);
  }

  function deriveFromMnemonic(mnemonic) {
    if (!libsReady) throw new Error('Library belum siap');
    var seed = libs.bip39.mnemonicToSeedSync(mnemonic);
    var path = isTestnet() ? "m/84'/1'/0'/0/0" : "m/84'/0'/0'/0/0";
    var hd = libs.bip32.HDKey.fromMasterSeed(seed);
    var child = hd.derive(path);
    if (!child.privateKey) throw new Error('Gagal derive key');
    var pub = libs.secp.getPublicKey(child.privateKey, true);
    var sha = libs.hashes.sha256(pub);
    var h160 = libs.hashes.ripemd160(sha);
    var words = libs.base.bech32.toWords(h160);
    words.unshift(0);
    var address = libs.base.bech32.encode(hrp(), words);
    return {
      address: address, privateKey: child.privateKey, publicKey: pub,
      mnemonic: mnemonic, network: network, path: path
    };
  }

  function alertMsg(msg, kind) {
    var el = $('btc-alert');
    if (!el) return;
    el.hidden = !msg;
    el.className = 'btc-alert' + (kind ? ' ' + kind : '');
    el.textContent = msg || '';
  }

  function setPanel(name) {
    ['btc-lock-panel', 'btc-recovery-panel', 'btc-wallet-panel'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = (id !== name);
    });
    hideSub();
  }

  function hideSub() {
    ['btc-receive-panel', 'btc-send-panel'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
  }

  function updateNetUI() {
    var pill = $('btc-network-pill');
    if (pill) pill.textContent = network === 'testnet4' ? 'Bitcoin Testnet4' : (network === 'testnet' ? 'Bitcoin Testnet3' : 'Bitcoin Mainnet');
    var sel = $('btc-network-select');
    if (sel) sel.value = network;
  }

  async function getJson(url) {
    var r = await fetch(url);
    if (!r.ok) throw new Error('API ' + r.status);
    return r.json();
  }

  async function loadMarket() {
    try {
      var p = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=idr,usd');
      btcPrice = p.bitcoin || btcPrice;
    } catch (_) {}
  }

  async function loadFees() {
    try {
      var f = await getJson(esplora() + '/fee-estimates');
      feeRate = Number(f['30'] || f['6'] || f['3'] || 5);
    } catch (_) { feeRate = 5; }
    updateTotal();
  }

  async function loadChain() {
    if (!wallet) return;
    var lastErr = null;
    var bases = apiBases();
    for (var i = 0; i < bases.length; i++) {
      var base = bases[i];
      try {
        var addr = await getJson(base + '/address/' + wallet.address);
        var hist = await getJson(base + '/address/' + wallet.address + '/txs');
        var us = await getJson(base + '/address/' + wallet.address + '/utxo');
        balanceSats =
          (Number((addr.chain_stats && addr.chain_stats.funded_txo_sum) || 0) -
            Number((addr.chain_stats && addr.chain_stats.spent_txo_sum) || 0)) +
          (Number((addr.mempool_stats && addr.mempool_stats.funded_txo_sum) || 0) -
            Number((addr.mempool_stats && addr.mempool_stats.spent_txo_sum) || 0));
        utxos = us || [];
        history = hist || [];
        chainBase = base;
        console.info('[DKBTC] saldo dari', base, balanceSats, 'sat');
        renderBalance();
        renderHistory();
        return;
      } catch (e) {
        lastErr = e;
        console.warn('[DKBTC] API gagal:', base, e.message || e);
      }
    }
    throw new Error('Explorer tidak bisa dihubungi (' + (lastErr && lastErr.message || 'jaringan') + ')');
  }

  function renderBalance() {
    var b = $('btc-balance'), f = $('btc-fiat');
    if (b) b.textContent = fmtBtc(balanceSats);
    if (f) {
      var cur = (localStorage.getItem('dk_currency') || 'IDR').toLowerCase();
      var rate = btcPrice[cur] || btcPrice.idr || 0;
      f.textContent = rate
        ? '≈ ' + (satToBtc(balanceSats) * rate).toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' ' + cur.toUpperCase()
        : '—';
    }
  }

  function renderHistory() {
    var el = $('btc-history');
    if (!el) return;
    if (!history.length) {
      el.innerHTML = '<div class="btc-empty">Belum ada transaksi di alamat ini.</div>';
      return;
    }
    var own = wallet.address;
    el.innerHTML = history.slice(0, 15).map(function (tx) {
      var v = (tx.vout || []).filter(function (o) { return o.scriptpubkey_address === own; })
        .reduce(function (a, o) { return a + Number(o.value || 0); }, 0);
      var spent = (tx.vin || []).some(function (i) {
        return i.prevout && i.prevout.scriptpubkey_address === own;
      });
      var incoming = v > 0 && !spent;
      var confirmed = !!(tx.status && tx.status.confirmed);
      var time = tx.status && tx.status.block_time
        ? new Date(tx.status.block_time * 1000).toLocaleString('id-ID')
        : 'Pending';
      return '<div class="btc-tx-row">' +
        '<span class="btc-tx-ico">' + (incoming ? '↓' : '↑') + '</span>' +
        '<div class="btc-tx-info"><b>' + (incoming ? 'Masuk' : 'Keluar') + '</b><small>' + esc(time) +
        ' · ' + (confirmed ? 'OK' : 'Pending') + '</small></div>' +
        '<span class="btc-tx-amt ' + (incoming ? 'in' : 'out') + '">' +
        (incoming ? '+' : '−') + satToBtc(v || 0).toFixed(8) + '</span></div>';
    }).join('');
  }

  function renderQr() {
    var el = $('btc-qr');
    if (!el || !wallet) return;
    el.innerHTML = '';
    if (window.QRCode) {
      new window.QRCode(el, {
        text: wallet.address, width: 180, height: 180,
        colorDark: '#0f172a', colorLight: '#ffffff'
      });
    }
    var a = $('btc-address');
    if (a) a.textContent = wallet.address;
  }

  function vbytes(nIn, nOut) { return 10 + nIn * 68 + nOut * 31; }

  function updateTotal() {
    var amt = Number(($('btc-amount') && $('btc-amount').value) || 0);
    var sats = Math.round(amt * 1e8);
    var est = Math.ceil(vbytes(utxos.length || 1, 2) * feeRate);
    var feeEl = $('btc-fee');
    if (feeEl) feeEl.textContent = est + ' sats (~' + feeRate.toFixed(1) + ' sat/vB)';
    var tot = $('btc-total');
    if (tot) tot.textContent = amt > 0 ? fmtBtc(sats + est) : '—';
  }

  function open() {
    var m = $('btc-modal');
    if (!m) { alert('Modal BTC belum siap'); return; }
    m.classList.add('active');
    m.style.display = 'flex';
    updateNetUI();
    alertMsg('');
    var saved = localStorage.getItem(KEY);
    setPanel('btc-lock-panel');
    if ($('btc-password')) $('btc-password').value = '';
    if ($('btc-lock-title')) {
      $('btc-lock-title').textContent = saved
        ? 'Masukkan kata sandi untuk membuka dompet BTC.'
        : 'Buat dompet BTC baru. Kata sandi mengenkripsi recovery phrase di perangkat ini.';
    }
    var btn = $('btc-unlock-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = saved ? 'Buka Dompet' : 'Buat Dompet BTC';
      btn.onclick = function () { unlock(); };
    }
    ensureLibs().then(function () {
      if (btn && !libsError) btn.textContent = saved ? 'Buka Dompet' : 'Buat Dompet BTC';
    }).catch(function (e) {
      alertMsg('Gagal memuat modul: ' + (e.message || e) + '\nHard refresh (Ctrl+Shift+R) atau coba jaringan lain.', 'error');
      if (btn) {
        btn.textContent = 'Coba Muat Ulang';
        btn.onclick = function () { libsReady = false; libsError = null; open(); };
      }
    });
    if ($('btc-password')) $('btc-password').focus();
  }

  function close() {
    var m = $('btc-modal');
    if (m) { m.classList.remove('active'); m.style.display = 'none'; }
    lock(false);
  }

  async function unlock() {
    var pass = ($('btc-password') && $('btc-password').value) || '';
    if (!pass || pass.length < 8) {
      alertMsg('Kata sandi minimal 8 karakter.', 'error');
      return;
    }
    var btn = $('btc-unlock-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Memuat…'; }
    alertMsg('Memuat library Bitcoin…');
    try {
      await ensureLibs();
    } catch (e) {
      alertMsg('Modul gagal: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Coba Lagi'; }
      return;
    }

    var saved = localStorage.getItem(KEY);
    try {
      var mnemonic;
      if (saved) {
        var rec = JSON.parse(saved);
        // Jaringan mengikuti pilihan pengguna (dk_btc_network), BUKAN rec.network:
        // alamat tb1 sama untuk Testnet3 & Testnet4, jadi cukup ganti explorer-nya.
        // Sebelumnya rec.network menimpa pilihan dan membuat Testnet4 tidak pernah terpakai.
        network = localStorage.getItem(NET_KEY) || rec.network || 'mainnet';
        if (network !== 'mainnet' && network !== 'testnet' && network !== 'testnet4') network = 'testnet4';
        localStorage.setItem(NET_KEY, network);
        updateNetUI();
        // Dekripsi dipisah: hanya kegagalan AES-GCM yang berarti kata sandi salah.
        try {
          mnemonic = await decryptWallet(rec, pass);
        } catch (decErr) {
          throw new Error('PASS_WRONG');
        }
        wallet = deriveFromMnemonic(mnemonic);
        password = pass;
        setPanel('btc-wallet-panel');
        renderBalance();
        renderQr();
        // Gagal jaringan (pasar, biaya, riwayat) tidak boleh membuat dompet dianggap terkunci.
        await Promise.all([
          loadMarket().catch(function (e) { console.warn('[DKBTC] market:', e); }),
          loadFees().catch(function (e) { console.warn('[DKBTC] fees:', e); })
        ]);
        renderBalance();
        try {
          await loadChain();
          alertMsg('Dompet terbuka.', 'success');
        } catch (e) {
          alertMsg('Dompet terbuka, tapi saldo gagal dimuat: ' + e.message + '. Tekan Refresh.', 'error');
        }
      } else {
        mnemonic = libs.bip39.generateMnemonic(libs.wordlist, 128);
        var rec2 = await encryptWallet(mnemonic, pass);
        localStorage.setItem(KEY, JSON.stringify(rec2));
        password = pass;
        wallet = deriveFromMnemonic(mnemonic);
        var words = $('btc-recovery-words');
        if (words) {
          words.innerHTML = mnemonic.split(' ').map(function (w, i) {
            return '<span>' + (i + 1) + '. ' + esc(w) + '</span>';
          }).join('');
        }
        if ($('btc-recovery-confirm')) $('btc-recovery-confirm').checked = false;
        setPanel('btc-recovery-panel');
        alertMsg('Catat recovery phrase offline sebelum lanjut.', 'success');
      }
    } catch (e) {
      console.error('[DKBTC] unlock:', e);
      if (!saved) alertMsg('Gagal: ' + e.message, 'error');
      else if (e.message === 'PASS_WRONG') alertMsg('Kata sandi salah.', 'error');
      else alertMsg('Gagal membuka dompet: ' + (e.message || e), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = localStorage.getItem(KEY) ? 'Buka Dompet' : 'Buat Dompet BTC';
        btn.onclick = function () { unlock(); };
      }
    }
  }

  function confirmRecovery() {
    if (!$('btc-recovery-confirm') || !$('btc-recovery-confirm').checked) {
      alertMsg('Centang konfirmasi setelah mencatat recovery phrase.', 'error');
      return;
    }
    setPanel('btc-wallet-panel');
    renderQr();
    renderBalance();
    Promise.all([loadMarket(), loadFees()]).then(function () {
      renderBalance();
      return loadChain();
    }).catch(function (e) {
      alertMsg('Alamat dibuat, data chain gagal: ' + e.message, 'error');
    });
    alertMsg('Dompet siap. Simpan recovery phrase offline!', 'success');
  }

  function showReceive() {
    hideSub();
    if ($('btc-receive-panel')) $('btc-receive-panel').hidden = false;
    renderQr();
  }

  function showSend() {
    hideSub();
    if ($('btc-send-panel')) $('btc-send-panel').hidden = false;
    loadFees();
  }

  function copyAddress() {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.address)
      .then(function () { alertMsg('Alamat disalin.', 'success'); })
      .catch(function () { alertMsg('Salin manual: tekan lama alamat.', 'error'); });
  }

  async function send() {
    if (!wallet || !password) { alertMsg('Buka dompet dulu.', 'error'); return; }
    if (!libsReady) { alertMsg('Library belum siap.', 'error'); return; }
    var dest = (($('btc-destination') && $('btc-destination').value) || '').trim();
    var amount = Number(($('btc-amount') && $('btc-amount').value) || 0);
    if (!dest || dest.length < 14) { alertMsg('Alamat tujuan tidak valid.', 'error'); return; }
    if (network === 'mainnet' && dest.indexOf('bc1') !== 0) {
      alertMsg('Gunakan alamat bc1… untuk Mainnet.', 'error'); return;
    }
    if (isTestnet() && dest.indexOf('tb1') !== 0) {
      alertMsg('Gunakan alamat tb1… untuk ' + netLabel() + '.', 'error'); return;
    }
    if (!(amount > 0)) { alertMsg('Masukkan jumlah BTC valid.', 'error'); return; }
    var sendSats = Math.round(amount * 1e8);
    try {
      var current = await getJson(esplora() + '/address/' + wallet.address + '/utxo');
      if (!current.length) {
        alertMsg('Belum ada UTXO / saldo untuk dikirim.', 'error'); return;
      }
      var fee = Math.ceil(vbytes(current.length, 2) * feeRate);
      if (sendSats + fee > balanceSats) {
        alertMsg('Saldo tidak cukup (termasuk fee).', 'error'); return;
      }
      if (!confirm('Kirim ' + fmtBtc(sendSats) + ' ke\n' + dest +
        '\n\nFee ~' + fee + ' sats\nJaringan: ' + network +
        '\n\nTransaksi TIDAK bisa dibatalkan.')) return;

      alertMsg('Membangun transaksi…');
      var inputs = [];
      var totalIn = 0;
      for (var i = 0; i < current.length; i++) {
        var u = current[i];
        var prev = await getJson(esplora() + '/tx/' + u.txid);
        var out = prev.vout[u.vout];
        inputs.push({
          txid: u.txid, vout: u.vout,
          value: Number(out.value),
          script: out.scriptpubkey
        });
        totalIn += Number(out.value);
      }
      var change = totalIn - sendSats - fee;
      var raw = await buildAndSignP2WPKH(inputs, dest, sendSats, change);
      var resp = await fetch(esplora() + '/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: raw
      });
      var txid = await resp.text();
      if (!resp.ok) throw new Error(txid || 'Broadcast gagal');
      try {
        var arr = JSON.parse(localStorage.getItem(TXKEY) || '[]');
        arr.unshift({ txid: txid, amount: sendSats, fee: fee, dest: dest, ts: Date.now() });
        localStorage.setItem(TXKEY, JSON.stringify(arr.slice(0, 50)));
      } catch (_) {}
      alertMsg('Terkirim! TXID: ' + txid, 'success');
      if ($('btc-amount')) $('btc-amount').value = '';
      await loadChain();
    } catch (e) {
      alertMsg('Gagal kirim: ' + (e.message || e), 'error');
    }
  }

  async function buildAndSignP2WPKH(inputs, destAddr, sendSats, changeSats) {
    function addrToScript(addr) {
      var dec = libs.base.bech32.decode(addr);
      var data = libs.base.bech32.fromWords(dec.words.slice(1));
      var s = new Uint8Array(22);
      s[0] = 0x00; s[1] = 0x14;
      s.set(data, 2);
      return s;
    }
    var destScript = addrToScript(destAddr);
    var changeScript = changeSats > 546 ? addrToScript(wallet.address) : null;

    function concat() {
      var parts = Array.prototype.slice.call(arguments);
      var len = 0;
      parts.forEach(function (p) { len += p.length; });
      var out = new Uint8Array(len), o = 0;
      parts.forEach(function (p) { out.set(p, o); o += p.length; });
      return out;
    }
    function u8(n) { return new Uint8Array([n]); }
    function u32(n) { var b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }
    function u64(n) {
      var b = new Uint8Array(8);
      var dv = new DataView(b.buffer);
      dv.setUint32(0, n >>> 0, true);
      dv.setUint32(4, Math.floor(n / 0x100000000), true);
      return b;
    }
    function varint(n) {
      if (n < 0xfd) return u8(n);
      if (n <= 0xffff) { var b = new Uint8Array(3); b[0] = 0xfd; b[1] = n & 0xff; b[2] = n >> 8; return b; }
      var b4 = new Uint8Array(5); b4[0] = 0xfe; new DataView(b4.buffer).setUint32(1, n, true); return b4;
    }
    function revHex(txid) {
      var a = fromHex(txid); a.reverse(); return a;
    }
    function compactToDer(compact) {
      var r = compact.slice(0, 32);
      var s = compact.slice(32, 64);
      function trim(b) {
        var i = 0;
        while (i < b.length - 1 && b[i] === 0) i++;
        if (b[i] & 0x80) {
          var o = new Uint8Array(b.length - i + 1);
          o[0] = 0; o.set(b.slice(i), 1); return o;
        }
        return b.slice(i);
      }
      r = trim(r); s = trim(s);
      var len = 2 + r.length + 2 + s.length;
      var out = new Uint8Array(2 + len);
      out[0] = 0x30; out[1] = len;
      out[2] = 0x02; out[3] = r.length; out.set(r, 4);
      out[4 + r.length] = 0x02; out[5 + r.length] = s.length; out.set(s, 6 + r.length);
      return out;
    }

    var vinCount = inputs.length;
    var outputs = [concat(u64(sendSats), varint(destScript.length), destScript)];
    if (changeScript) outputs.push(concat(u64(changeSats), varint(changeScript.length), changeScript));
    var voutCount = outputs.length;

    var witnesses = [];
    for (var i = 0; i < vinCount; i++) {
      var inp = inputs[i];
      var prevouts = [];
      inputs.forEach(function (x) {
        prevouts.push(concat(revHex(x.txid), u32(x.vout)));
      });
      var hashPrevouts = libs.hashes.sha256(libs.hashes.sha256(concat.apply(null, prevouts)));
      var seqs = [];
      for (var s = 0; s < vinCount; s++) seqs.push(u32(0xffffffff));
      var hashSequence = libs.hashes.sha256(libs.hashes.sha256(concat.apply(null, seqs)));
      var hashOutputs = libs.hashes.sha256(libs.hashes.sha256(concat.apply(null, outputs)));

      var pubHash = libs.hashes.ripemd160(libs.hashes.sha256(wallet.publicKey));
      var scriptCode = concat(u8(0x19), u8(0x76), u8(0xa9), u8(0x14), pubHash, u8(0x88), u8(0xac));

      var preimage = concat(
        u32(2), hashPrevouts, hashSequence,
        revHex(inp.txid), u32(inp.vout),
        scriptCode, u64(inp.value), u32(0xffffffff),
        hashOutputs, u32(0), u32(0x01)
      );
      var sighash = libs.hashes.sha256(libs.hashes.sha256(preimage));
      var sig = libs.secp.sign(sighash, wallet.privateKey);
      var der;
      if (sig.toDERRawBytes) der = sig.toDERRawBytes();
      else if (sig.toCompactRawBytes) der = compactToDer(sig.toCompactRawBytes());
      else der = compactToDer(sig);
      var sigWithHash = concat(der, u8(0x01));
      witnesses.push([sigWithHash, wallet.publicKey]);
    }

    var parts = [u32(2), u8(0x00), u8(0x01)];
    parts.push(varint(vinCount));
    inputs.forEach(function (inp) {
      parts.push(revHex(inp.txid), u32(inp.vout), varint(0), u32(0xffffffff));
    });
    parts.push(varint(voutCount));
    outputs.forEach(function (o) { parts.push(o); });
    witnesses.forEach(function (w) {
      parts.push(varint(w.length));
      w.forEach(function (item) {
        parts.push(varint(item.length), item);
      });
    });
    parts.push(u32(0));
    return hex(concat.apply(null, parts));
  }

  function lock(clear) {
    if (clear === undefined) clear = true;
    wallet = null; password = null; utxos = []; balanceSats = 0;
    setPanel('btc-lock-panel');
    if (clear) alertMsg('');
  }

  async function refresh() {
    if (!wallet) { alertMsg('Buka dompet dulu.', 'error'); return; }
    try {
      await Promise.all([loadMarket(), loadFees()]);
      await loadChain();
      alertMsg('Diperbarui.', 'success');
    } catch (e) {
      alertMsg('Gagal: ' + e.message, 'error');
    }
  }

  function setNetwork(net) {
    if (net !== 'mainnet' && net !== 'testnet' && net !== 'testnet4') return;
    if (wallet) {
      alertMsg('Kunci dompet dulu sebelum ganti jaringan.', 'error');
      return;
    }
    network = net;
    localStorage.setItem(NET_KEY, net);
    updateNetUI();
    alertMsg('Jaringan: ' + netLabel(), 'success');
  }

  function bind() {
    var el = $('btc-amount');
    if (el && !el._btc) {
      el._btc = true;
      el.addEventListener('input', updateTotal);
    }
    var sel = $('btc-network-select');
    if (sel && !sel._btc) {
      sel._btc = true;
      sel.addEventListener('change', function () { setNetwork(sel.value); });
    }
  }

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(function () { ensureLibs().catch(function () {}); }, { timeout: 5000 });
  } else {
    setTimeout(function () { ensureLibs().catch(function () {}); }, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.DKBTC = {
    open: open, close: close, unlock: unlock, confirmRecovery: confirmRecovery,
    showReceive: showReceive, showSend: showSend, copyAddress: copyAddress,
    send: send, refresh: refresh, lock: lock, setNetwork: setNetwork,
    ready: function () { return libsReady; }
  };
  console.log('[DKBTC] pure ESM Bitcoin wallet ready ✅');
})();
