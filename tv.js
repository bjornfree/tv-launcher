// Мост к API телевизора. Ни одна функция VIDAA не документирована, поэтому всё — best-effort:
// перебираем кандидатов, пишем в лог, что сработало. Реальные имена берутся из экрана «Диагностика».
var TV = (function () {
  var LOG = [];
  function log(s) { LOG.unshift(new Date().toTimeString().slice(0, 8) + " " + s); if (LOG.length > 200) LOG.length = 200; }

  function bridgeNames(re) {
    var out = [];
    for (var k in window) {
      try {
        if (/^(Hisense|HiUtils|hisense)/.test(k) && typeof window[k] === "function" && (!re || re.test(k))) out.push(k);
      } catch (e) {}
    }
    return out.sort();
  }

  function call(name, args) {
    try { return { ok: true, r: window[name].apply(window, args || []) }; }
    catch (e) { return { ok: false, e: String(e) }; }
  }

  function parse(v) {
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch (e) { return v; }
  }

  // ищет в произвольном JSON первый массив объектов (список приложений/источников)
  function findArray(v, depth) {
    v = parse(v);
    if (!v || typeof v !== "object" || (depth || 0) > 4) return null;
    if (v instanceof Array) return v.length && typeof v[0] === "object" ? v : null;
    for (var k in v) { var a = findArray(v[k], (depth || 0) + 1); if (a) return a; }
    return null;
  }

  function pick(o, keys) { for (var i = 0; i < keys.length; i++) if (o[keys[i]]) return String(o[keys[i]]); return ""; }

  function probe() {
    var info = { ua: navigator.userAgent, href: location.href, screen: screen.width + "x" + screen.height + " / " + innerWidth + "x" + innerHeight, bridge: bridgeNames() };
    ["Hisense_GetFirmWareVersion", "Hisense_GetModelName", "Hisense_GetOSVersion", "Hisense_GetApiVersion", "Hisense_GetBrand"].forEach(function (n) {
      if (typeof window[n] === "function") { var c = call(n); info[n] = c.ok ? c.r : "ERR " + c.e; }
    });
    return info;
  }

  // запись websdk/Appinfo.json: веб-приложения, установленные через магазин/установщик
  function fromAppinfo(a) {
    return { name: pick(a, ["AppName", "Title", "name"]), url: pick(a, ["URL", "url", "StartCommand"]), icon: pick(a, ["Icon_96", "IconURL", "Image", "Thumb"]), native: "" };
  }

  // выход из приложения: штатно через Hisense_CloseBrowser, иначе window.close
  function exit() {
    if (typeof window.Hisense_CloseBrowser === "function") { var c = call("Hisense_CloseBrowser"); if (c.ok) return; }
    window.close();
  }

  function listApps(onAsync) {
    var apps = [];
    if (typeof window.HiUtils_createRequest === "function") {
      var c = call("HiUtils_createRequest", ["fileRead", { path: "websdk/Appinfo.json", mode: 6 }]);
      var arr = c.ok && c.r && c.r.ret ? findArray(c.r.msg) : null;
      log("apps via HiUtils Appinfo.json: " + (arr ? arr.length : (c.e || "нет")));
      (arr || []).forEach(function (a) { apps.push(fromAppinfo(a)); });
    }
    // VIDAA U4/U6: Hisense_FileRead(path, mode), mode 6 = /APPS. Только чтение; FileWrite не вызываем.
    if (typeof window.Hisense_FileRead === "function") {
      var r = call("Hisense_FileRead", ["websdk/Appinfo.json", 6]);
      var raw = r.ok ? r.r : null;
      if (raw && typeof raw === "object" && raw.msg !== undefined) raw = raw.msg;
      log("Hisense_FileRead Appinfo.json -> " + (r.ok ? typeof r.r + " " + String(JSON.stringify(r.r)).slice(0, 300) : r.e));
      var list = findArray(raw);
      (list || []).forEach(function (a) { apps.push(fromAppinfo(a)); });
      // вдруг API асинхронный: пробуем вариант с колбэком, результат придёт позже
      if (!list && onAsync) {
        var c2 = call("Hisense_FileRead", ["websdk/Appinfo.json", 6, function (res) {
          log("Hisense_FileRead callback -> " + typeof res + " " + String(JSON.stringify(res)).slice(0, 300));
          var l2 = findArray(res && res.msg !== undefined ? res.msg : res);
          if (l2 && l2.length) onAsync(l2.map(fromAppinfo));
        }]);
        log("Hisense_FileRead(cb) -> " + (c2.ok ? typeof c2.r + " " + String(JSON.stringify(c2.r)).slice(0, 200) : c2.e));
      }
    }
    bridgeNames(/app.*(list|info)|installed/i).forEach(function (n) {
      if (/install|uninstall/i.test(n) && !/installed/i.test(n)) return; // не вызывать установку/удаление
      var c = call(n);
      var arr = c.ok ? findArray(c.r) : null;
      log("apps via " + n + ": " + (arr ? arr.length : (c.ok ? "не список" : c.e)));
      (arr || []).forEach(function (a) {
        var name = pick(a, ["name", "appName", "AppName", "title", "Title"]);
        if (name) apps.push({ name: name, url: "", native: name, appId: pick(a, ["appId", "id", "Id"]), icon: pick(a, ["icon", "iconUrl", "IconURL", "Icon_96", "thumbnail", "image"]) });
      });
    });
    return apps;
  }

  function launchNative(tile) {
    var cands = [
      ["Hisense_launchAppViaName", [tile.native]],
      ["Hisense_StartApp", [tile.native]],
      ["Hisense_StartApp", [":am," + (tile.appId || tile.native) + ",:start=" + (tile.appId || tile.native)]]
    ];
    for (var i = 0; i < cands.length; i++) {
      if (typeof window[cands[i][0]] !== "function") continue;
      var c = call(cands[i][0], cands[i][1]);
      log("launch " + tile.native + " via " + cands[i][0] + "(" + cands[i][1][0] + ") -> " + (c.ok ? JSON.stringify(c.r) : c.e));
      if (c.ok) return true;
    }
    log("launch " + tile.native + ": нет подходящей функции");
    return false;
  }

  function listInputs() {
    var out = [];
    // не трогаем блокировки/пароли: Hisense_GetCurrentSourceLockStatus и т.п.
    bridgeNames(/get.*(source|input)/i).filter(function (n) { return !/lock|status|password|rating|block/i.test(n); }).forEach(function (n) {
      var c = call(n);
      var arr = c.ok ? findArray(c.r) : null;
      log("inputs via " + n + ": " + (arr ? arr.length : (c.ok ? JSON.stringify(c.r) : c.e)));
      (arr || []).forEach(function (s) {
        if (!pick(s, ["sourceid", "id", "sourcename", "displayname", "name"])) return;
        out.push({ id: pick(s, ["sourceid", "id", "sourcename"]), name: pick(s, ["displayname", "name", "sourcename"]), signal: s.is_signal === "1" || s.has_signal === "1" });
      });
    });
    return out;
  }

  function switchInput(src) {
    // только прямое переключение источника; Set*SourceLock* и подобные никогда не вызываем
    var fns = bridgeNames(/^Hisense_(Set|Change|Switch)(Current|TV)?(Source|Input)$/i);
    for (var i = 0; i < fns.length; i++) {
      var c = call(fns[i], [src.id]);
      log("input " + src.id + " via " + fns[i] + " -> " + (c.ok ? JSON.stringify(c.r) : c.e));
      if (c.ok) return true;
    }
    log("input " + src.id + ": нет функции переключения источника");
    return false;
  }

  return { log: log, LOG: LOG, exit: exit, probe: probe, listApps: listApps, launchNative: launchNative, listInputs: listInputs, switchInput: switchInput };
})();
