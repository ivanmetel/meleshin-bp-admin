// Админка машины сборки КП (bp-admin) — конструктор «Собрать» (ТЗ Админка,
// tz/bp/2026-10-02-tz-bp-admin.md, 02.10): админка = собранный клиентский документ
// с видимым происхождением каждого элемента. Три колонки: рельс разделов документа
// (статусы данных), сам документ (карточка ЛК — экран = PDF), инспектор источника
// нажатого элемента — редактируемые поля открываются в нём же. Состав работ
// read-only: источник — смета. Табов вариантов на экране нет (Иван 02.10 —
// семейство «перегородки» это данные сметы, не орган админки; наложение
// вариантов остаётся механизмом машины). Верхняя панель: СОБРАТЬ / ПРОВЕРИТЬ /
// ПРЕДПРОСМОТР ЛК / ОТПРАВИТЬ. Работает поверх engine.js; машина и манифест
// без изменений. Вид «Маркдаун» и форм-грид «Конструктор» умерли (ТЗ §4–§5).
const CLIENT_URL = "https://ivanmetel.github.io/meleshin-bp-client/";

STATE.view = "build";
STATE.insp = null;

/* ============================================================
   Рельс: разделы документа человеческими именами + статусы данных
   ============================================================ */
function railModel(a) {
  const m = STATE.manifest;
  const omitPhotos = (m.layout.omit || []).includes("photos");
  return [
    { name: "Титул", sel: "#sec-open .doc-title-outer", ok: true, c: "" },
    { name: "Описание", sel: "#sec-open .doc-h2", ok: true, c: "" },
    { name: "План", sel: "#sec-plans", ok: a.has.plans, c: a.has.plans ? "1 лист" : "нет файла" },
    { name: "Фото", sel: "#sec-photos-1", ok: a.has.photos, c: a.has.photos ? m.images.photos.length + " фото" : (omitPhotos ? "исключено" : "нет файлов") },
    { name: "Работы", sel: "#sec-works", ok: true, c: a.docRows.length + " — " + fmtMoney(a.docItogo) + " €" },
    { name: "Организация", sel: "#sec-post", ok: true, c: a.has.also_included ? "свёрнута" : "" },
    { name: "Границы", sel: "#sec-notinc", ok: true, c: "" },
    { name: "Согласования", sel: "#sec-interaction .doc-h2", selFallback: "#sec-interaction", ok: a.has.permits, c: a.has.permits ? "" : "исключено" },
    { name: "Взаимодействие", sel: "#sec-interaction", ok: true, c: "" },
    { name: "Оплата", sel: "#sec-payment", ok: a.emptySlots.length === 0, c: a.emptySlots.length ? "пустые слоты" : "" },
    { name: "Галерея", sel: "#sec-gallery", ok: m.images.gallery.length > 0, c: m.images.gallery.length + " фото" },
  ];
}

function renderRail(a) {
  const items = railModel(a).map((s) =>
    '<div class="rail-item" data-sel="' + esc(s.sel) + '"' + (s.selFallback ? ' data-sel-fb="' + esc(s.selFallback) + '"' : "") + ">" +
    '<span class="st ' + (s.ok ? "ok" : s.c ? "warn" : "off") + '"></span><span class="nm">' + s.name + "</span>" +
    (s.c ? '<span class="c">' + esc(s.c) + "</span>" : "") + "</div>").join("");
  return '<div class="rail-h">Документ</div>' + items +
    '<div class="rail-legend"><span><i class="st ok"></i> данные есть</span><span><i class="st warn"></i> нужно действие</span><span><i class="st off"></i> отсутствует</span></div>';
}

/* ============================================================
   Верхняя панель: объект + режимы (табов вариантов нет — Иван 02.10)
   ============================================================ */
function renderBar(a) {
  const m = STATE.manifest;
  const mode = (k, label) => '<button data-view="' + k + '"' + (STATE.view === k ? ' class="active"' : "") + ">" + label + "</button>";
  return (
    '<div class="bb-obj">' + esc(m.object.folder) + ' <span class="c">— КП от ' + esc(m.object.date) + "</span></div>" +
    '<div class="bb-modes">' +
    mode("build", "Собрать") +
    mode("check", "Проверить " + a.gatesPassed + "/" + a.gatesTotal) +
    mode("send", "Отправить") +
    "</div>"
  );
}

/* ============================================================
   Инспектор: источник нажатого элемента
   ============================================================ */
function inspCard(title, body) { return '<div class="insp-card"><div class="insp-h">' + title + "</div>" + body + "</div>"; }
function inspField(label, inner) { return '<label class="insp-f"><span>' + label + "</span>" + inner + "</label>"; }
function inspRow(k, v) { return '<div class="insp-row"><span>' + k + "</span><b>" + v + "</b></div>"; }
function srcTag(text) { return '<div class="src-tag">' + text + "</div>"; }
function inspNote(text) { return '<div class="insp-note">' + text + "</div>"; }

// Строки таблицы в текущем виде документа (все / помещение) — как в engine,
// чтобы инспектор показывал то, что на экране
function currentWorkRows(a) {
  if (STATE.room === "all" || !STATE.room) return a.docRows;
  const vRows = applyVariant(ESTIMATE_ROWS, STATE.manifest, STATE.variant).rows;
  return mergeByName(vRows.filter((r) => r.room === STATE.room)).map((r, i) => ({ n: i + 1, name: r.name, unit: r.unit, qty: r.qty, price: r.price, cost: round2(r.qty * r.price) }));
}

function renderInspector(a) {
  const m = STATE.manifest;
  const insp = STATE.insp;
  if (!insp) return inspCard("Как править",
    '<p class="insp-text">Кликните по элементу документа — здесь откроется его источник, а редактируемые поля появятся в этой панели.</p>' +
    '<p class="insp-text">Редактируются: титул, подзаголовок и дата; заголовок таблицы работ; условия оплаты; род цены; решения по разделам — согласования, организация работ, фото, форма блока «В стоимость не входят».</p>' +
    '<p class="insp-text">Состав работ приходит из сметы, тексты блоков заданы ТЗ — клик по ним показывает происхождение, без правки здесь.</p>' +
    '<div class="insp-actions"><button class="btn ghost" data-act="reset">Сбросить манифест</button></div>');

  if (insp.kind === "work") {
    const rows = currentWorkRows(a);
    const r = rows[insp.i];
    if (!r) return inspCard("Строка", "<p class='insp-text'>Строка не найдена.</p>");
    const related = STATE.room === "all" && insp.i >= a.rows.length;
    let src = "";
    if (related) src = srcTag("Фиксированный блок ТЗ") + inspNote("Проектные сопутствующие работы; редактируются только в ТЗ.");
    else if (r.parts || STATE.room !== "all") {
      const parts = r.parts ? r.parts.map((p) => esc(p.room) + " " + fmtQty(p.qty)).join(" + ") : esc(r.qty ? "строки помещения «" + STATE.room + "»" : "");
      src = srcTag("Источник: смета") + (r.parts ? '<div class="insp-parts">' + parts + "</div>" : "") + inspNote("Склейка по правилу «имя + цена»: одинаковые строки помещений — одна строка документа, количества суммируются.");
    } else src = srcTag("Источник: смета");
    return inspCard("Строка " + r.n,
      inspRow("Работа", esc(r.name)) + inspRow("Ед.", esc(r.unit)) + inspRow("Кол-во", fmtQty(r.qty)) + inspRow("Цена за ед.", fmtMoney(r.price) + " €") + inspRow("Стоимость", fmtMoney(r.cost) + " €") +
      '<div class="ladder"><div class="li"><span>' + fmtQty(r.qty) + " × " + fmtMoney(r.price) + "</span><span>" + fmtMoney(r.cost) + " €</span></div></div>" +
      src + inspNote("Состав и количества в конструкторе не меняются (ТЗ Админка §2)."));
  }

  if (insp.kind === "total") {
    return inspCard("Итого таблицы",
      '<div class="ladder">' +
      '<div class="li"><span>Строительно-монтажные и отделочные</span><span>' + fmtMoney(a.itogo) + " €</span></div>" +
      '<div class="li"><span>Сопутствующие (2 строки)</span><span>' + fmtMoney(a.relTotal) + " €</span></div>" +
      '<div class="li eq"><span>Итого</span><span>' + fmtMoney(a.docItogo) + " €</span></div></div>" +
      inspNote(a.rows.length + " позиций склеено из " + ESTIMATE_ROWS.length + " строк сметы; сопутствующие — последние строки той же таблицы."));
  }

  if (insp.kind === "price") {
    return inspCard("Строка цены",
      '<div class="ladder">' +
      '<div class="li"><span>Итого таблицы</span><span>' + fmtMoney(a.docItogo) + " €</span></div>" +
      '<div class="li"><span>Черновые материалы</span><span>' + fmtMoney(m.commerce.materials) + " €</span></div>" +
      '<div class="li eq"><span>Стоимость по проекту</span><span>' + fmtMoney(a.price) + " €</span></div></div>" +
      '<div class="insp-sub">+ 19% VAT начисляется дополнительно.</div>' +
      inspField("Род цены", '<select data-path="commerce.price.kind"><option value="final"' + (m.commerce.price.kind === "final" ? " selected" : "") + '>final</option><option value="estimate"' + (m.commerce.price.kind === "estimate" ? " selected" : "") + ">estimate</option></select>") +
      inspNote("estimate добавляет в документ абзац о предварительном характере цены."));
  }

  if (insp.kind === "payments") {
    return inspCard("Условия оплаты",
      inspField("Предоплата, €", '<input data-path="commerce.predoplata" value="' + (m.commerce.predoplata || "") + '">') +
      inspField("Второй платёж, €", '<input data-path="commerce.second_payment.amount" value="' + (m.commerce.second_payment.amount || "") + '">') +
      inspField("Второй платёж — за что", '<input data-path="commerce.second_payment.note" value="' + esc(m.commerce.second_payment.note || "") + '">') +
      inspField("Срок, значение", '<input data-path="commerce.term.value" value="' + m.commerce.term.value + '">') +
      inspField("Срок, единица", '<select data-path="commerce.term.unit">' + ["недель", "дней", "месяцев"].map((u) => '<option' + (m.commerce.term.unit === u ? " selected" : "") + ">" + u + "</option>").join("") + "</select>") +
      inspField("Пункт об отчётности (длинные проекты)", '<input type="checkbox" data-path="commerce.reporting"' + (m.commerce.reporting ? " checked" : "") + ">"));
  }

  if (insp.kind === "object") {
    return inspCard("Титул и описание",
      inspField("Подзаголовок", '<input data-path="object.subtitle" value="' + esc(m.object.subtitle) + '">') +
      inspField("Дата", '<input data-path="object.date" value="' + esc(m.object.date) + '">') +
      inspRow("Папка (внутренняя)", '<span class="mono">' + esc(m.object.folder) + "</span>") +
      srcTag("Источник: карточка проекта") +
      '<div class="insp-parts mono">' + esc(m.sources.card) + "</div>" +
      inspNote("Открытие и поля «Объект», «Зона работ», «Материалы и транспорт» приходят из карточки; в конструкторе не редактируются."));
  }

  if (insp.kind === "workshead") {
    return inspCard("Заголовок зоны работ",
      inspField("Текст заголовка", '<input data-path="layout.works_heading" value="' + esc(m.layout.works_heading) + '">') +
      inspNote("Ниже — одна таблица: 13 позиций сметы + 2 сопутствющие строки, итог на последней странице."));
  }

  if (insp.kind === "permits") {
    return inspCard("Согласования и разрешительная документация",
      inspRow("Состояние", a.has.permits ? "блок включён" : "блок исключён") +
      '<div class="insp-actions"><button class="btn ghost" data-act="permits">' + (a.has.permits ? "Исключить блок" : "Включить блок") + "</button></div>" +
      srcTag("Фиксированный блок ТЗ") + inspNote("Текст блока фиксирован; решение — только включён или исключён."));
  }

  if (insp.kind === "org") {
    return inspCard("Организация строительного процесса",
      inspField("Форма", '<select data-path="layout.org_process"><option value="on"' + (m.layout.org_process === "on" ? " selected" : "") + '>блок целиком</option><option value="fold"' + (m.layout.org_process === "fold" ? " selected" : "") + ">свёрнута в «В стоимость также входит»</option></select>") +
      inspNote("Свёрнутая форма заменяет блок списком из двух пунктов после таблицы работ."));
  }

  if (insp.kind === "photos") {
    return inspCard("Фото объекта",
      inspField("Раздел включён", '<input type="checkbox" data-act="photos"' + (a.has.photos ? " checked" : "") + ">") +
      inspNote(m.images.photos.length + " фото; по 3 на полосу. Выключение убирает раздел из документа."));
  }

  if (insp.kind === "notinc") {
    return inspCard("В стоимость не входят",
      inspField("Форма", '<select data-path="layout.not_included_form"><option value="subsections"' + (m.layout.not_included_form === "subsections" ? " selected" : "") + '>подразделы</option><option value="prose"' + (m.layout.not_included_form === "prose" ? " selected" : "") + ">строкой (форма 2635)</option></select>") +
      srcTag("Источник: карточка проекта") + inspNote("Списки позиций (отделочные материалы, чистовая электрика и сантехника) приходят из карточки."));
  }

  return inspCard("Фиксированный блок ТЗ", inspNote("Этот текст фиксирован спецификацией и в конструкторе не редактируется."));
}

/* ============================================================
   Проверить: отчёт (машина), клик по воротам ведёт к месту в документе
   ============================================================ */
const GATE_ANCHOR = { 1: "#sec-works", 2: "#sec-payment", 3: "#sec-works", 6: "#sec-payment", 7: "#sec-open", 10: "#sec-photos-1" };

function renderReport(a) {
  const m = STATE.manifest;
  const gateRow = (x) => '<div class="rep-row ' + x.status + (GATE_ANCHOR[x.n] ? ' linked' : '') + '"' + (GATE_ANCHOR[x.n] ? ' data-goto="' + esc(GATE_ANCHOR[x.n]) + '"' : '') + '><span class="rep-status">' + (x.status === "pass" ? "✓" : x.status === "skip" ? "○" : "✕") + '</span><span class="rep-n">' + x.n + '</span><span class="rep-title">' + esc(x.title) + '</span><span class="rep-detail">' + esc(x.detail) + '</span></div>';
  const merged = a.aggregation.merged.map((gr) => "<div>«" + esc(gr.name) + "» " + fmtMoney(gr.price) + " €: " + gr.parts.map((p) => p.room + " " + fmtQty(p.qty)).join(" + ") + " → " + fmtQty(gr.qty) + " " + a.rows.find((r) => r.name === gr.name && r.price === gr.price).unit + "</div>").join("");
  const split = a.aggregation.keptSplit.map((gr) => "<div>«" + esc(gr.name) + "»: " + gr.prices.map((p) => fmtMoney(p) + " €").join(" | ") + " — строки остаются раздельными</div>").join("");
  const vc = a.variantChanges;
  return (
    '<div class="rep-grid">' +
    '<div class="rep-card"><div class="rep-h">Сборка</div><div class="rep-line">Файл: <b>' + a.filename + "</b></div>" +
    '<div class="rep-line">Слайдов: ' + (a.sections.length + a.worksPages.length - 1) + "; строк таблицы: " + a.docRows.length + "; страницы таблицы: " + a.worksPages.length + " (по 12 строк, шапка повторяется, итог — на последней)</div>" +
    '<div class="rep-line">Вариант: ' + a.variantLabel + (vc.replaced.length ? "; заменено строк: " + vc.replaced.length : "") + (vc.dropped.length ? "; исключено строк: " + vc.dropped.length : "") + "</div>" +
    '<div class="rep-line">Источники: карточка <span class="mono">' + esc(m.sources.card) + "</span>; смета — " + esc(m.sources.estimate) + "</div></div>" +
    '<div class="rep-card"><div class="rep-h">Агрегация</div>' + (merged || "<div>склеек нет</div>") + (split ? '<div class="rep-sub">Не склеено — одна работа, разные цены:</div>' + split : "") + "</div>" +
    '<div class="rep-card"><div class="rep-h">Арифметика</div><div class="rep-line">Итого по таблице: <b>' + fmtMoney(a.itogo) + " €</b></div>" +
    '<div class="rep-line">Сопутствующие: ' + fmtMoney(a.relTotal) + " €; черновые материалы: " + fmtMoney(a.materials) + " €</div>" +
    '<div class="rep-line">Строка цены: <b>' + fmtMoney(a.itogo) + " + " + fmtMoney(a.relTotal) + " + " + fmtMoney(a.materials) + " = " + fmtMoney(a.price) + " €</b> + 19% VAT</div></div>" +
    '<div class="rep-card gates"><div class="rep-h">Ворота 1–10</div>' + a.gates.map(gateRow).join("") + "</div>" +
    "</div>"
  );
}

/* ============================================================
   Отправить: статус и публикация (в демо — push published.json)
   ============================================================ */
function renderSend(a) {
  const m = STATE.manifest;
  return '<div class="rep-grid send-grid">' +
    '<div class="rep-card"><div class="rep-h">Статус</div>' +
    '<div class="rep-line"><span class="status-pill ' + (STATE.status === "agreed" ? "success" : "warn") + '"><span class="dot"></span><span>' + (STATE.status === "agreed" ? FIXED.status_agreed : FIXED.status_sent) + '</span><span>' + esc(m.object.date) + "</span></span></div>" +
    '<div class="insp-actions"><button class="btn ghost" data-status="sent">Отметить «Отправлен»</button><button class="btn ghost" data-status="agreed">Отметить «Согласован с клиентом»</button></div></div>' +
    '<div class="rep-card"><div class="rep-h">Публикация</div><div class="rep-line">В демо публикация — push файла published.json в репозиторий админки; ЛК клиента грузит его по умолчанию.</div>' +
    '<div class="rep-line">Текущее состояние конструктора клиент увидит через «Предпросмотр ЛК» — без публикации, в адресе страницы.</div>' +
    '<div class="insp-actions"><button class="btn primary" data-act="preview">Предпросмотр ЛК клиента ↗</button></div></div>' +
    "</div>";
}

/* ============================================================
   События
   ============================================================ */
function setPath(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const key = parts[parts.length - 1];
  if (typeof o[key] === "number" || (typeof o[key] === "string" && typeof value === "string" && value !== "" && !isNaN(Number(value)) && key !== "unit")) o[key] = Number(value);
  else o[key] = value;
}

// Клик по документу → инспектор источника (ТЗ §2)
function resolveInsp(a, e) {
  const t = e.target;
  if (!t.closest) return null;
  const roomBtn = t.closest("[data-room]");
  if (roomBtn) return { room: roomBtn.dataset.room };
  if (t.closest(".bp-total-row")) return { kind: "total" };
  const tr = t.closest(".bp-table-print tbody tr");
  if (tr && !tr.classList.contains("bp-total-row")) return { kind: "work", i: [...tr.parentNode.children].indexOf(tr) };
  if (t.closest(".doc-price")) return { kind: "price" };
  const sec = t.closest("section");
  if (!sec) return null;
  const id = sec.id;
  if (id === "sec-works" && t.closest(".doc-h2")) return { kind: "workshead" };
  if (id === "sec-open") return { kind: "object" };
  if (id.startsWith("sec-photos")) return { kind: "photos" };
  if (id === "sec-post" && t.closest(".doc-h3")) return { kind: "org" };
  if (id === "sec-payment") return { kind: "payments" };
  if (id === "sec-notinc") return { kind: "notinc" };
  if (id === "sec-interaction" && a.has.permits && t.closest(".doc-h2") === sec.querySelectorAll(".doc-h2")[0]) return { kind: "permits" };
  return { kind: "fixed" };
}

function renderAll() {
  const a = build();
  document.getElementById("build-bar").innerHTML = renderBar(a);
  const main3 = document.getElementById("main3");
  main3.classList.toggle("only-doc", STATE.view !== "build");
  document.getElementById("rail").innerHTML = STATE.view === "build" ? renderRail(a) : "";
  const docwrap = document.getElementById("docwrap");
  const keep = STATE.view === "build" ? [docwrap.scrollLeft, docwrap.scrollTop] : null;   // перерисовка не прыгает в начало документа
  if (STATE.view === "build") docwrap.innerHTML = '<div class="doc-frame">' + renderDoc(a, { flow: true }) + "</div>";
  else if (STATE.view === "check") docwrap.innerHTML = renderReport(a);
  else docwrap.innerHTML = renderSend(a);
  document.getElementById("inspector").innerHTML = STATE.view === "build" ? renderInspector(a) : "";
  wire(a);
  if (keep) { docwrap.scrollLeft = keep[0]; docwrap.scrollTop = keep[1]; }
}

// Поля и кнопки инспектора навешиваются отдельно: карточка инспектора
// перерисовывается и без полной перерисовки (клик по документу), и ей нужны живые обработчики
function wireInspector(a) {
  const insp = document.getElementById("inspector");
  insp.querySelectorAll("[data-path]").forEach((inp) => inp.addEventListener("change", () => {
    setPath(STATE.manifest, inp.dataset.path, inp.type === "checkbox" ? inp.checked : inp.value);
    renderAll();
  }));
  insp.querySelectorAll("button[data-act]").forEach((b) => b.addEventListener("click", () => {
    const act = b.dataset.act;
    if (act === "reset") { STATE.manifest = clone(MANIFEST_DEFAULT); STATE.variant = "base"; STATE.insp = null; }
    if (act === "permits") STATE.manifest.layout.permits = !STATE.manifest.layout.permits;
    if (act === "preview") { previewClient(); return; }
    renderAll();
  }));
  insp.querySelectorAll("input[data-act='photos']").forEach((inp) => inp.addEventListener("change", () => {
    const om = STATE.manifest.layout.omit;
    const i = om.indexOf("photos");
    if (inp.checked && i >= 0) om.splice(i, 1);
    if (!inp.checked && i < 0) om.push("photos");
    renderAll();
  }));
  insp.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => { STATE.status = b.dataset.status; renderAll(); }));
}

function wire(a) {
  const root = document;   // режимы живут в build-bar, рельс — в main3: вешаем со документа
  root.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { STATE.view = b.dataset.view; STATE.insp = null; renderAll(); }));
  root.querySelectorAll(".rail-item").forEach((b) => b.addEventListener("click", () => {
    const el = document.querySelector(b.dataset.sel) || (b.dataset.selFb && document.querySelector(b.dataset.selFb));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  root.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => {
    STATE.view = "build"; STATE.insp = null; renderAll();
    const el = document.querySelector(b.dataset.goto);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  wireInspector(a);
  docwrapClick(a);
}

function docwrapClick(a) {
  const el = document.getElementById("docwrap");
  el.onclick = (e) => {
    const r = resolveInsp(a, e);
    if (!r) return;
    if (r.room) { STATE.room = r.room; STATE.insp = null; renderAll(); return; }
    STATE.insp = r;
    document.getElementById("inspector").innerHTML = renderInspector(a);
    wireInspector(a);
  };
}

// Предпросмотр ЛК: текущее состояние конструктора уходит в адрес клиентской страницы
function previewClient() {
  const payload = { manifest: STATE.manifest, variant: STATE.variant, status: STATE.status };
  const b64 = btoa(String.fromCharCode.apply(null, new TextEncoder().encode(JSON.stringify(payload))));
  window.open(CLIENT_URL + "#preview=" + b64, "_blank");
}

if (document.getElementById("docwrap")) renderAll();
