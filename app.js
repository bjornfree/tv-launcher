// Лаунчер. ES5 без зависимостей: браузеры VIDAA U4 старые.
(function () {
  "use strict";

  var STORE_KEY = "home.cfg.v1";
  var FOCUS_KEY = "home.focus.v1";
  var LONG_PRESS_MS = 600;
  var STAGE_W = 1920, STAGE_H = 1080, CONTENT_W = 1728;
  var PALETTE = ["#e50914", "#ff0033", "#ff9500", "#f5c518", "#34c759", "#00a8e1", "#1a98ff", "#5856d6", "#9146ff", "#2c2c2e"];

  var PRESETS = [
    { name: "Lampa", glyph: "L", color: "#5856d6", icon: "icons/lampa.svg", url: "http://lampa.mx" },
    { name: "YouTube", glyph: "▶", color: "#ff0033", icon: "icons/youtube.svg", url: "https://www.youtube.com/tv", native: "YouTube" },
    { name: "Netflix", glyph: "N", color: "#141414", icon: "icons/netflix.svg", native: "Netflix" },
    { name: "Prime Video", glyph: "P", color: "#0f171e", icon: "icons/primevideo.png", native: "Prime Video" },
    { name: "Кинопоиск", glyph: "К", color: "#ff5500", icon: "icons/kinopoisk.svg", url: "https://hd.kinopoisk.ru" },
    { name: "Twitch", glyph: "T", color: "#9146ff", icon: "icons/twitch.svg", url: "https://hisense.tv.twitch.tv/" },
    { name: "Plex", glyph: "P", color: "#1f1f1f", icon: "icons/plex.svg", url: "https://app.plex.tv" },
    { name: "Vevo", glyph: "V", color: "#f2f2f2", icon: "icons/vevo.png", url: "https://hisense.vevo.com" }
  ];

  // иконка плитки: своя -> из пресета по имени -> favicon сайта; .svg — белый логотип, прочее — квадратный значок
  function iconSrc(t) {
    if (t.icon) return t.icon;
    var m = t.url && t.url.match(/^https?:\/\/([^\/:?#]+)/i);
    return m ? "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(m[1]) + "&sz=128" : "";
  }
  function preset(name) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].name.toLowerCase() === String(name).toLowerCase()) return PRESETS[i];
    return {};
  }
  function presetIcon(name) { return preset(name).icon || ""; }

  var DEFAULTS = { columns: 6, dockSize: 4, h24: true, showDate: true, bg: "black", tiles: PRESETS };
  var BGS = [["black", "Чёрный"], ["gradient", "Градиент"], ["navy", "Тёмно-синий"]];

  // ------------------------------------------------------------ состояние
  var cfg = loadCfg();
  var focus = loadFocus();      // { area: "tiles" | "top", i, top }
  var moving = -1;              // индекс перетаскиваемой плитки, -1 — не перетаскиваем
  var modal = null;             // { title, items, idx, onBack, left }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function loadCfg() {
    var c = copy(DEFAULTS);
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (s && s.tiles instanceof Array) for (var k in c) if (s[k] !== undefined) c[k] = s[k];
    } catch (e) { TV.log("cfg read: " + e); }
    // плитки, сохранённые старой версией: подтягиваем иконку/цвет из пресета с тем же именем
    c.tiles.forEach(function (t) {
      var p = preset(t.name);
      if (!t.icon && p.icon) t.icon = p.icon;
      if (!t.color && p.color) t.color = p.color;
      if (!t.url && !t.native && p.url) t.url = p.url;
    });
    return c;
  }
  function saveCfg() { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { TV.log("cfg write: " + e); } }
  function loadFocus() {
    try { var f = JSON.parse(localStorage.getItem(FOCUS_KEY) || "null"); if (f && f.area) return f; } catch (e) {}
    return { area: "tiles", i: 0, top: 0 };
  }
  function saveFocus() { try { localStorage.setItem(FOCUS_KEY, JSON.stringify(focus)); } catch (e) {} }

  function toast(t) {
    var el = $("toast"); el.textContent = t; el.style.opacity = 1;
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.style.opacity = 0; }, 3500);
  }

  // ------------------------------------------------------------ геометрия: док = ряд 0, сетка = ряды 1..
  function dockSize() { return Math.min(cfg.dockSize, cfg.tiles.length); }
  function pos(i) {
    var d = dockSize();
    if (i < d) return { r: 0, c: i };
    var g = i - d;
    return { r: 1 + Math.floor(g / cfg.columns), c: g % cfg.columns };
  }
  function rowLen(r) {
    var d = dockSize();
    if (r === 0) return d;
    var rest = cfg.tiles.length - d - (r - 1) * cfg.columns;
    return clamp(rest, 0, cfg.columns);
  }
  function index(r, c) {
    var len = rowLen(r);
    if (!len) return -1;
    c = clamp(c, 0, len - 1);
    return r === 0 ? c : dockSize() + (r - 1) * cfg.columns + c;
  }
  // куда уйдёт фокус из плитки i по направлению; -1 — за край, "top" — в верхнюю панель
  function step(i, dir) {
    var p = pos(i);
    if (dir === "left") return p.c > 0 ? i - 1 : -1;
    if (dir === "right") return p.c < rowLen(p.r) - 1 ? i + 1 : -1;
    if (dir === "up") return p.r === 0 ? "top" : index(p.r - 1, p.c);
    return index(p.r + 1, p.c);
  }

  // ------------------------------------------------------------ отрисовка
  function tileHtml(t, i, eol) {
    var src = iconSrc(t);
    var glyph = '<b class="glyph">' + esc(t.glyph || (t.name || "?").charAt(0).toUpperCase()) + "</b>";
    // картинка не загрузилась (нет сети, битый адрес) -> показываем букву
    var card = src ? '<img class="' + (/\.svg(\?|$)/i.test(src) ? "logo" : "badge") + '" src="' + esc(src) + '" alt="" onerror="this.parentNode.className+=\' noimg\'">' + glyph : glyph;
    return '<div class="tile' + (moving === i ? " moving" : "") + (eol ? " eol" : "") + '" data-i="' + i + '">' +
      '<span class="card' + (src ? "" : " noimg") + '" style="background:' + esc(t.color || "#2c2c2e") + '">' +
      card + (t.native && !t.url ? '<span class="sub">ТВ</span>' : "") + "</span>" +
      '<div class="label">' + esc(t.name) + "</div></div>";
  }

  function layout() {
    var C = cfg.columns, gap = 40;
    var tw = Math.floor((CONTENT_W - (C - 1) * gap) / C);
    var rs = document.documentElement.style;
    rs.setProperty("--tw", tw + "px");
    rs.setProperty("--th", Math.round(tw * 0.6) + "px");
    document.documentElement.className = cfg.bg === "black" ? "" : "bg-" + cfg.bg;
  }

  function render() {
    layout();
    document.body.className = moving >= 0 ? "moving-mode" : "";
    var d = dockSize(), dock = "", grid = "";
    for (var i = 0; i < cfg.tiles.length; i++) {
      var p = pos(i);
      var h = tileHtml(cfg.tiles[i], i, p.c === (p.r === 0 ? d : cfg.columns) - 1);
      if (p.r === 0) dock += h; else grid += h;
    }
    $("dock").innerHTML = dock || '<div class="empty">Нет приложений — Настройки → Добавить</div>';
    $("grid").innerHTML = grid;
    focusedEl = null;
    updateFocus();
  }

  // перемещение фокуса без перерисовки DOM: иначе CSS-переходы (масштаб, стекло, прокрутка) не анимируются
  var focusedEl = null;
  function updateFocus() {
    var pills = document.querySelectorAll(".pill");
    for (var k = 0; k < pills.length; k++) pills[k].className = "pill" + (focus.area === "top" && focus.top === k ? " focus" : "");

    var el = focus.area === "tiles" ? document.querySelector('.tile[data-i="' + focus.i + '"]') : null;
    if (focusedEl && focusedEl !== el) {
      focusedEl.className = focusedEl.className.replace(" focus", "");
      focusedEl.firstChild.style.boxShadow = "";
    }
    var glass = $("glass");
    if (el) {
      if (el.className.indexOf(" focus") < 0) el.className += " focus";
      var t = cfg.tiles[focus.i];
      el.firstChild.style.boxShadow = "0 18px 60px " + (t.color || "#000") + "88";
      // координаты плитки внутри #content: секция (#dock/#grid) + плитка
      var x = el.parentNode.offsetLeft + el.offsetLeft, y = el.parentNode.offsetTop + el.offsetTop;
      glass.style.transform = "translate(" + x + "px," + y + "px) scale(1.08)";
      glass.style.opacity = 1;
    } else {
      glass.style.opacity = 0;
    }
    focusedEl = el;

    var cur = el ? cfg.tiles[focus.i] : null;
    $("title").textContent = moving >= 0 ? "Перемещение: стрелки, OK — готово" : cur ? cur.name : "";
    scrollToFocus();
    saveFocus();
  }

  function scrollToFocus() {
    var y = 0;
    if (focus.area === "tiles" && cfg.tiles.length) {
      var r = pos(focus.i).r;
      if (r >= 1) {
        var el = document.querySelector('.tile[data-i="' + focus.i + '"]');
        // прокручиваем, только когда ряд в фокусе не помещается; тогда сразу на весь экран, чтобы заголовок не резался
        if (el) {
          var bottom = $("grid").offsetTop + el.offsetTop + el.offsetHeight + 60;
          // ряд в фокусе становится вторым видимым: предыдущий ряд целиком над ним
          if (bottom > $("viewport").clientHeight) y = $("grid").offsetTop + el.offsetTop - (el.offsetHeight + 30) - 50;
        }
      }
    }
    $("content").style.transform = "translateY(" + -y + "px)";
    $("title").style.opacity = y > 0 ? 0 : 1;
  }

  // ------------------------------------------------------------ часы
  var DAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  function tick() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    if (!cfg.h24) h = h % 12 || 12;
    $("time").textContent = h + ":" + (m < 10 ? "0" : "") + m;
    $("date").textContent = cfg.showDate ? DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] : "";
  }

  // ------------------------------------------------------------ запуск
  function launch(t) {
    if (!t) return;
    TV.log("launch " + t.name);
    if (t.native && TV.launchNative(t)) return;
    if (t.url) { location.href = t.url; return; }
    toast("Не удалось запустить " + t.name + " — см. Настройки → Диагностика");
  }

  // ------------------------------------------------------------ модальные списки
  // item: { label, val?: fn->string, hint?, ok?: fn, left?: fn, right?: fn, input?: {get,set} , sep? }
  function openModal(title, items, opts) {
    opts = opts || {};
    modal = { title: title, items: items, idx: opts.idx || 0, onBack: opts.onBack, left: opts.left };
    renderModal();
  }
  function closeModal() { blurInput(); modal = null; $("modal").style.display = "none"; render(); }
  function blurInput() { if (document.activeElement && document.activeElement.tagName === "INPUT") document.activeElement.blur(); }

  function renderModal() {
    if (!modal) return;
    $("modal").style.display = "block";
    $("sheet").className = modal.left ? "left" : modal.wide ? "wide" : "";
    $("sheet-title").textContent = modal.title;
    var html = "";
    for (var i = 0; i < modal.items.length; i++) {
      var it = modal.items[i];
      html += '<div class="item' + (i === modal.idx ? " focus" : "") + (it.sep ? " sep" : "") + '" data-m="' + i + '">' + esc(it.label);
      if (it.val) html += '<span class="val">' + it.val() + "</span>";
      if (it.hint) html += '<span class="hint">' + esc(it.hint) + "</span>";
      if (it.input) html += '<input type="' + (it.input.type || "text") + '" data-in="' + i + '" value="' + esc(it.input.get()) + '">';
      html += "</div>";
    }
    if (modal.pre) html += '<div id="diag"><div id="diag-in" style="transform:translateY(' + -(modal.scroll || 0) + 'px)">' + modal.pre + "</div></div>";
    $("items").innerHTML = html;
    // прокрутка длинного списка
    var el = document.querySelector('.item[data-m="' + modal.idx + '"]');
    var max = $("sheet").clientHeight - 200;
    $("items").style.transform = "translateY(" + -(el ? Math.max(0, el.offsetTop - max + el.offsetHeight) : 0) + "px)";
  }

  function readInputs() {
    var ins = document.querySelectorAll("#items input");
    for (var i = 0; i < ins.length; i++) modal.items[+ins[i].getAttribute("data-in")].input.set(ins[i].value);
  }

  function modalKey(k) {
    var it = modal.items[modal.idx];
    var typing = document.activeElement && document.activeElement.tagName === "INPUT";
    if (typing) {
      if (k === "ok" || k === "up" || k === "down") { readInputs(); blurInput(); if (k === "ok") k = "down"; }
      else if (k === "back") { readInputs(); blurInput(); return; }
      else return "pass"; // стрелки влево/вправо и буквы — в поле ввода
    }
    // экран с текстом: вверх/вниз листают текст
    if (modal.pre && (k === "up" || k === "down")) {
      var inner = $("diag-in"), box = $("diag");
      var maxS = Math.max(0, inner.offsetHeight - box.clientHeight);
      modal.scroll = clamp((modal.scroll || 0) + (k === "down" ? 400 : -400), 0, maxS);
      inner.style.transform = "translateY(" + -modal.scroll + "px)";
      return;
    }
    if (k === "up") modal.idx = clamp(modal.idx - 1, 0, modal.items.length - 1);
    else if (k === "down") modal.idx = clamp(modal.idx + 1, 0, modal.items.length - 1);
    else if (k === "left" && it.left) it.left();
    else if (k === "right" && it.right) it.right();
    else if (k === "ok") {
      if (it.input) { var inp = document.querySelector('#items input[data-in="' + modal.idx + '"]'); if (inp) inp.focus(); return; }
      if (it.ok) { readInputs(); it.ok(); if (!modal) return; }
    } else if (k === "back") { readInputs(); if (modal.onBack) modal.onBack(); else closeModal(); return; }
    renderModal();
  }

  function cycle(list, cur, d) { var i = list.indexOf(cur); return list[(i + d + list.length) % list.length]; }

  // ------------------------------------------------------------ экраны
  function openSettings(idx) {
    function num(key, min, max) {
      return { left: function () { cfg[key] = clamp(cfg[key] - 1, min, max); applyCfg(); }, right: function () { cfg[key] = clamp(cfg[key] + 1, min, max); applyCfg(); }, val: function () { return "‹ " + cfg[key] + " ›"; } };
    }
    function flag(key, on, off) {
      var f = function () { cfg[key] = !cfg[key]; applyCfg(); };
      return { left: f, right: f, ok: f, val: function () { return cfg[key] ? on : off; } };
    }
    var bgIds = BGS.map(function (b) { return b[0]; });
    var items = [
      { label: "Добавить приложение", ok: function () { openAdd(); } },
      { label: "Приложения телевизора", hint: "прочитать установленные на ТВ", ok: openTvApps },
      { label: "Упорядочить плитки", hint: "OK на плитке — взять, стрелки — двигать", ok: function () { closeModal(); moving = focus.area === "tiles" ? focus.i : 0; focus = { area: "tiles", i: moving, top: 0 }; render(); } },
      ext({ label: "Колонок в сетке", sep: true }, num("columns", 4, 8)),
      ext({ label: "Мест в доке" }, num("dockSize", 3, 7)),
      ext({ label: "Формат времени" }, flag("h24", "24 ч", "12 ч")),
      ext({ label: "Показывать дату" }, flag("showDate", "да", "нет")),
      { label: "Фон", left: function () { cfg.bg = cycle(bgIds, cfg.bg, -1); applyCfg(); }, right: function () { cfg.bg = cycle(bgIds, cfg.bg, 1); applyCfg(); },
        val: function () { return "‹ " + BGS[bgIds.indexOf(cfg.bg)][1] + " ›"; } },
      { label: "Диагностика", sep: true, hint: "функции ТВ и журнал", ok: openDiag },
      { label: "Сбросить всё", ok: function () {
        openModal("Сбросить настройки и плитки?", [
          { label: "Да, сбросить", ok: function () { cfg = copy(DEFAULTS); saveCfg(); focus = { area: "tiles", i: 0, top: 0 }; closeModal(); tick(); } },
          { label: "Отмена", ok: function () { openSettings(9); } }
        ], { onBack: function () { openSettings(9); } });
      } }
    ];
    openModal("Настройки", items, { idx: idx });
  }
  function ext(a, b) { for (var k in b) a[k] = b[k]; return a; }
  function applyCfg() { saveCfg(); tick(); render(); }

  function openAdd() {
    var items = PRESETS.map(function (p) {
      return { label: p.name, hint: p.url || "приложение ТВ", ok: function () { addTile(copy(p)); } };
    });
    items.unshift({ label: "Своя ссылка…", hint: "название, адрес, цвет", ok: function () { openEdit(-1); } });
    openModal("Добавить приложение", items, { onBack: function () { openSettings(0); } });
  }

  function addTile(t) {
    cfg.tiles.push(t); saveCfg();
    focus = { area: "tiles", i: cfg.tiles.length - 1, top: 0 };
    closeModal(); toast("Добавлено: " + t.name);
  }

  // форма плитки: i = -1 — новая
  function openEdit(i) {
    var t = i >= 0 ? copy(cfg.tiles[i]) : { name: "", url: "", color: PALETTE[6] };
    var items = [
      { label: "Название", input: { get: function () { return t.name; }, set: function (v) { t.name = v; } } },
      { label: "Адрес (URL)", input: { type: "url", get: function () { return t.url || ""; }, set: function (v) { t.url = v; } } },
      { label: "Иконка (URL, необязательно)", hint: "пусто — возьмём значок сайта", input: { type: "url", get: function () { return t.icon || ""; }, set: function (v) { t.icon = v.trim() || undefined; } } },
      { label: "Цвет", left: function () { t.color = cycle(PALETTE, t.color, -1); }, right: function () { t.color = cycle(PALETTE, t.color, 1); },
        val: function () { return PALETTE.map(function (c) { return '<span class="swatch' + (c === t.color ? " on" : "") + '" style="background:' + c + '"></span>'; }).join(""); } },
      { label: "Сохранить", sep: true, ok: function () {
        t.name = (t.name || "").trim();
        t.url = (t.url || "").trim();
        if (!t.name) { toast("Нужно название"); return; }
        if (t.url && !/^https?:\/\//i.test(t.url)) t.url = "http://" + t.url; // lampa.mx -> http://lampa.mx
        if (t.url && !/^https?:\/\/[^\s/]+\.[^\s]+/i.test(t.url)) { toast("Не похоже на адрес: " + t.url); return; }
        if (!t.url && !t.native) { toast("Нужен адрес"); return; }
        t.glyph = t.glyph && i >= 0 && t.name === cfg.tiles[i].name ? t.glyph : t.name.charAt(0).toUpperCase();
        if (i >= 0) { cfg.tiles[i] = t; saveCfg(); closeModal(); } else addTile(t);
      } },
      { label: "Отмена", ok: closeModal }
    ];
    openModal(i >= 0 ? "Изменить плитку" : "Своя ссылка", items, { onBack: closeModal });
  }

  function openTileMenu(i) {
    var t = cfg.tiles[i];
    openModal(t.name, [
      { label: "Переместить", ok: function () { closeModal(); moving = i; render(); } },
      { label: "Изменить", ok: function () { openEdit(i); } },
      { label: i < dockSize() ? "Убрать из дока" : "В док", ok: function () {
        var x = cfg.tiles.splice(i, 1)[0];
        var to = i < dockSize() ? dockSize() - 1 : Math.max(0, dockSize() - 1);
        if (i < dockSize()) cfg.tiles.splice(cfg.tiles.length, 0, x); else cfg.tiles.splice(to, 0, x);
        focus.i = cfg.tiles.indexOf(x); saveCfg(); closeModal();
      } },
      { label: "Удалить", sep: true, ok: function () {
        cfg.tiles.splice(i, 1); saveCfg();
        focus.i = clamp(i, 0, Math.max(0, cfg.tiles.length - 1)); closeModal();
      } }
    ]);
  }

  function openTvApps(asyncApps) {
    // асинхронный ответ ТВ перерисует список, если он ещё открыт
    var apps = asyncApps || TV.listApps(function (late) { if (modal && modal.title === "Приложения телевизора") openTvApps(late); });
    var have = {};
    cfg.tiles.forEach(function (t) { have[(t.name || "").toLowerCase()] = 1; });
    var self = location.href.split(/[?#]/)[0];
    var items = apps.filter(function (a) { return a.name && a.url !== self; }).map(function (a) {
      var added = have[a.name.toLowerCase()];
      return { label: a.name, val: function () { return added ? "добавлено" : "+"; }, hint: a.url || "встроенное", ok: function () {
        if (added) return;
        addTile({ name: a.name, glyph: a.name.charAt(0).toUpperCase(), color: PALETTE[a.name.length % PALETTE.length], icon: a.icon || presetIcon(a.name) || undefined, url: a.url, native: a.native, appId: a.appId });
      } };
    });
    if (!items.length) {
      // ответ ТВ прямо здесь, чтобы хватило одного фото
      var why = TV.LOG.filter(function (l) { return /apps via|FileRead/.test(l); }).slice(0, 4);
      items = [{ label: "ТВ не отдал список приложений", hint: "открыть Диагностику", ok: openDiag }].concat(why.map(function (l) { return { label: l.slice(9, 140) }; }));
    }
    openModal("Приложения телевизора", items, { onBack: function () { openSettings(1); } });
  }

  function openInputs() {
    var srcs = TV.listInputs();
    var guessed = !srcs.length;
    if (guessed) srcs = [{ id: "HDMI1", name: "HDMI 1" }, { id: "HDMI2", name: "HDMI 2" }, { id: "HDMI3", name: "HDMI 3" }, { id: "HDMI4", name: "HDMI 4" }, { id: "TV", name: "Live TV" }];
    var items = srcs.map(function (s) {
      return { label: s.name || s.id, val: function () { return s.signal ? "●" : ""; }, ok: function () {
        if (TV.switchInput(s)) { closeModal(); return; }
        toast("Нет API переключения входов — см. Диагностика");
      } };
    });
    if (guessed) items[0].hint = "список по умолчанию: ТВ не отдал источники";
    openModal("Входы", items, { left: true });
  }

  function openDiag() {
    var p = TV.probe();
    openModal("Диагностика", [{ label: "Закрыть (вверх/вниз — листать)", ok: closeModal }]);
    modal.wide = true;
    // имена функций колонками без префикса Hisense_, чтобы все 90+ влезли на один экран для фото
    var names = p.bridge.map(function (n) { return '<span class="fn">' + esc(n.replace(/^Hisense_/, "")) + "</span>"; }).join("");
    modal.pre = '<div class="fns-title">Функции ТВ (' + p.bridge.length + '), префикс Hisense_ опущен:</div><div class="fns">' + (names || "— нет —") + "</div>" +
      "<pre>" + esc(JSON.stringify(p, function (k, v) { return k === "bridge" ? undefined : v; }, 1) + "\n\nЖурнал:\n" + TV.LOG.join("\n")) + "</pre>";
    renderModal();
  }

  // ------------------------------------------------------------ клавиши
  var KEYMAP = { 37: "left", 38: "up", 39: "right", 40: "down", 13: "ok", 461: "back", 10009: "back", 27: "back", 8: "back",
    403: "menu", 404: "settings", 457: "menu", 18: "menu" };
  var okDown = 0, okTimer = null;

  function onKey(e) {
    var typing = document.activeElement && document.activeElement.tagName === "INPUT";
    var k = KEYMAP[e.keyCode];
    if (!k) { TV.log("key " + e.keyCode); return; }
    if (typing && k === "back" && e.keyCode === 8) return; // Backspace стирает текст
    if (modal) { if (modalKey(k) !== "pass") e.preventDefault(); return; }
    e.preventDefault();
    if (k === "ok" && focus.area === "tiles" && moving < 0) return okPress();
    handle(k);
  }

  // короткое OK — запуск, долгое (автоповтор клавиши) — меню плитки
  function okPress() {
    okDown++;
    if (okDown === 2) { clearTimeout(okTimer); okTimer = null; if (cfg.tiles[focus.i]) openTileMenu(focus.i); return; }
    if (okDown > 2) return;
    okTimer = setTimeout(function () { okTimer = null; if (okDown === 1) launch(cfg.tiles[focus.i]); okDown = 0; }, LONG_PRESS_MS);
  }
  function onKeyUp(e) {
    if (KEYMAP[e.keyCode] !== "ok" || modal) { okDown = 0; return; }
    if (okTimer && okDown === 1) { clearTimeout(okTimer); okTimer = null; launch(cfg.tiles[focus.i]); }
    okDown = 0;
  }

  function handle(k) {
    if (k === "settings") return openSettings(0);
    if (moving >= 0) return moveKey(k);
    if (focus.area === "top") {
      if (k === "left") focus.top = Math.max(0, focus.top - 1);
      else if (k === "right") focus.top = Math.min(1, focus.top + 1);
      else if (k === "down" && cfg.tiles.length) focus.area = "tiles";
      else if (k === "ok") return focus.top === 0 ? openInputs() : openSettings(0);
      else if (k === "back") TV.exit();
      return updateFocus();
    }
    if (k === "menu") return cfg.tiles[focus.i] && openTileMenu(focus.i);
    if (k === "back") { if (pos(focus.i).r > 0) { focus.i = index(0, 0); return updateFocus(); } return TV.exit(); }
    var n = step(focus.i, k);
    if (n === "top") focus.area = "top";
    else if (n >= 0) focus.i = n;
    updateFocus();
  }

  function moveKey(k) {
    if (k === "ok" || k === "back") { moving = -1; saveCfg(); toast("Порядок сохранён"); return render(); }
    var n = step(moving, k);
    if (typeof n !== "number" || n < 0) return;
    var t = cfg.tiles.splice(moving, 1)[0];
    cfg.tiles.splice(n, 0, t);
    moving = focus.i = n;
    render();
  }

  // ------------------------------------------------------------ мышь / указка пульта
  document.addEventListener("click", function (e) {
    var t = e.target;
    while (t && t.getAttribute) {
      if (t.getAttribute("data-i") !== null) { focus = { area: "tiles", i: +t.getAttribute("data-i"), top: 0 }; render(); return launch(cfg.tiles[focus.i]); }
      if (t.getAttribute("data-top") !== null) { focus = { area: "top", i: focus.i, top: +t.getAttribute("data-top") }; return handle("ok"); }
      if (t.getAttribute("data-m") !== null && modal) { modal.idx = +t.getAttribute("data-m"); if (e.target.tagName !== "INPUT") modalKey("ok"); return; }
      t = t.parentNode;
    }
  });
  document.addEventListener("contextmenu", function (e) {
    var t = e.target; while (t && t.getAttribute && t.getAttribute("data-i") === null) t = t.parentNode;
    if (t && t.getAttribute) { e.preventDefault(); focus = { area: "tiles", i: +t.getAttribute("data-i"), top: 0 }; openTileMenu(focus.i); }
  });

  // ------------------------------------------------------------ масштаб 1920x1080 под окно
  function fit() {
    var w = window.innerWidth, h = window.innerHeight, s = Math.min(w / STAGE_W, h / STAGE_H);
    document.body.style.transform = "translate(" + (w - STAGE_W * s) / 2 + "px," + (h - STAGE_H * s) / 2 + "px) scale(" + s + ")";
  }

  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", fit);
  window.onerror = function (m, src, line) { TV.log("ERROR " + m + " " + src + ":" + line); };

  if (focus.area === "tiles" && focus.i >= cfg.tiles.length) focus.i = 0;
  fit(); tick(); setInterval(tick, 10000); render();
  TV.log("start " + JSON.stringify(TV.probe().bridge));
})();
