/**
 * ref の保管係（本部サイトの「全ページ」と共通予約フォームに1行で入れる）
 *
 * 例えるなら「受付の前に置いたスタンプ帳」。お客さまが ?ref=K001 のリンクから来たら
 * スタンプを30日間覚えておき、予約フォームの隠し項目にそっと書き写す。
 * 後から別の店のリンクを踏んだら新しいスタンプで上書きする（ラストクリック）。
 *
 * - 保存するのは 店コード・広告経由か・踏んだ日時 の3つだけ。名前・電話・住所は扱わない。
 * - shop（店の指名）はその場だけで、保存しない（共通予約フォーム仕様 1章）。
 * - 記事ページ（/area/・/shop/）にも必ず入れる。入っていないページで ref を踏まれると、
 *   次のページへ移った時点で ref が消え、送客した店の4割が数えられない。
 * - 保存先は2つ：arigatouosouji.com 全体（yoyaku. などのサブドメインも）で読めるクッキー（www あり・なしの行き来でも消えない）と
 *   localStorage（クッキーが使えない端末の予備）。新しい方を使う。
 * - 使い方：<script src="ref-keeper.js" defer></script>
 *   フォームに <input type="hidden" name="ref"> <input type="hidden" name="ref_at">
 *   <input type="hidden" name="ad"> <input type="hidden" name="shop"> を置くと自動で埋まる。
 */
var SoukyakuRefKeeper = (function () {
  'use strict';
  var KEY = 'soukyaku_ref_v1';
  var DAYS = 30;
  var CODE = /^(HQ00|K\d{3})$/;
  var CONFIG = {
    formUrl: 'https://yoyaku.arigatouosouji.com/yoyaku/',
    cookieDomain: 'arigatouosouji.com',
    // パイロットで外部のフォームサービスを使うときは、その URL もここに足す（ref をリンクで引き継ぐ）
    formUrls: ['https://yoyaku.arigatouosouji.com/yoyaku/']
  };

  /**
   * 店コードを取り出す。小文字・全角はそろえる。
   * AI が ?ref= を二重に付けた「K001?ref=K001」のような値は、先頭の店コードだけを使う。
   * 「K0012」のように後ろに数字や英字が続くものは店コードと見なさない。
   */
  function norm(v) {
    var s = String(v || '').normalize('NFKC').trim().toUpperCase();
    var m = /^(HQ00|K\d{3})(?![0-9A-Z])/.exec(s);
    return m ? m[1] : '';
  }

  function parse(raw, now) {
    try {
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || !CODE.test(v.ref) || !v.at) return null;
      if (now.getTime() - new Date(v.at).getTime() > DAYS * 86400000) return null;
      return v;
    } catch (e) { return null; }
  }

  function read(storage, now) {
    var v = null;
    try { v = parse(storage.getItem(KEY), now); } catch (e) { v = null; }
    if (!v) { try { storage.removeItem(KEY); } catch (e) { /* なにもしない */ } }
    return v;
  }

  /** URL の ?ref=…&ad=1 を受け取り、正しい店コードなら保存（上書き）する */
  function capture(search, storage, now) {
    var p = new URLSearchParams(search || '');
    var ref = norm(p.get('ref'));
    var shop = norm(p.get('shop'));
    var saved = read(storage, now);
    if (ref) {
      saved = { ref: ref, ad: p.get('ad') === '1' ? 1 : 0, at: now.toISOString() };
      try { storage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* 保存できない端末では今回の送信だけ */ }
    }
    return {
      ref: saved ? saved.ref : '',
      ref_at: saved ? saved.at : '',
      ad: saved ? String(saved.ad) : '0',
      shop: shop
    };
  }

  /** クッキー（親ドメイン全体で読める）を storage と同じ形で使う */
  function cookieStorage(doc, domain) {
    return {
      getItem: function (k) {
        var m = new RegExp('(?:^|; )' + k + '=([^;]*)').exec(doc.cookie || '');
        return m ? decodeURIComponent(m[1]) : null;
      },
      setItem: function (k, v) {
        doc.cookie = k + '=' + encodeURIComponent(v) + '; Max-Age=' + DAYS * 86400 + '; Path=/; SameSite=Lax; Secure'
          + (domain ? '; Domain=' + domain : '');
      },
      removeItem: function (k) {
        doc.cookie = k + '=; Max-Age=0; Path=/' + (domain ? '; Domain=' + domain : '');
      }
    };
  }

  /** 2つの保存先を束ねる。読むときは新しい方、書くときは両方 */
  function bothStorage(a, b) {
    function get(s) { try { return s ? s.getItem(KEY) : null; } catch (e) { return null; } }
    return {
      getItem: function () {
        var x = get(a), y = get(b);
        var at = function (s) { try { return (s && JSON.parse(s).at) || ''; } catch (e) { return ''; } };
        var tx = at(x), ty = at(y);
        return tx >= ty ? x : y;
      },
      setItem: function (k, v) { [a, b].forEach(function (s) { try { if (s) s.setItem(k, v); } catch (e) { /* 片方だけでもよい */ } }); },
      removeItem: function (k) { [a, b].forEach(function (s) { try { if (s) s.removeItem(k); } catch (e) { /* なにもしない */ } }); }
    };
  }

  /** フォームの隠し項目に書き写す */
  function fill(doc, values) {
    Object.keys(values).forEach(function (name) {
      var els = doc.querySelectorAll('input[type="hidden"][name="' + name + '"]');
      for (var i = 0; i < els.length; i++) els[i].value = values[name];
    });
  }

  /**
   * 予約フォームへのリンクに ref を引き継ぐ（フォームが別のドメインにあっても ref が届くように）。
   * 相対リンク（/yoyaku/?shop=K004）も絶対リンクも見る。既に ref が付いているリンクは触らない。
   */
  function carryLinks(doc, values, formUrls, base) {
    if (!values.ref) return 0;
    var n = 0;
    var links = doc.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var u;
      try { u = new URL(links[i].getAttribute('href'), base); } catch (e) { continue; }
      var full = u.origin + u.pathname;
      var isForm = formUrls.some(function (f) { return full === f || full + '/' === f; });
      if (!isForm || u.searchParams.get('ref')) continue;
      u.searchParams.set('ref', values.ref);
      if (values.ad === '1') u.searchParams.set('ad', '1');
      links[i].setAttribute('href', u.toString());
      n++;
    }
    return n;
  }

  function run(win) {
    var local = null;
    try { local = win.localStorage; } catch (e) { local = null; }
    var host = win.location.hostname;
    var domain = host === CONFIG.cookieDomain || host.slice(-(CONFIG.cookieDomain.length + 1)) === '.' + CONFIG.cookieDomain
      ? CONFIG.cookieDomain : '';
    var storage = bothStorage(cookieStorage(win.document, domain), local);
    var values = capture(win.location.search, storage, new Date());
    var go = function () {
      fill(win.document, values);
      carryLinks(win.document, values, CONFIG.formUrls, win.location.href);
    };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', go);
    else go();
    return values;
  }

  return { KEY: KEY, DAYS: DAYS, CONFIG: CONFIG, norm: norm, capture: capture, read: read, fill: fill,
    carryLinks: carryLinks, cookieStorage: cookieStorage, bothStorage: bothStorage, run: run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SoukyakuRefKeeper;
else if (typeof window !== 'undefined' && !window.SOUKYAKU_REF_KEEPER_MANUAL) SoukyakuRefKeeper.run(window);
