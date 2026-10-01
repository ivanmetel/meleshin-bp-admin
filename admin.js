// Админка машины сборки КП (bp-admin) — операционная часть: конструктор (манифест,
// блоки, варианты), документ, маркдаун, отчёт. Работает поверх engine.js.
// Связь с ЛК: «Предпросмотр ЛК клиента» открывает meleshin-bp-client с текущим
// состоянием конструктора в адресе (#preview=...); опубликованное для клиента
// состояние — published.json этого репо (ЛК грузит его по умолчанию).
const CLIENT_URL = "https://ivanmetel.github.io/meleshin-bp-client/";

/* ============================================================
   Представления: markdown, манифест, отчёт
   ============================================================ */
function renderMd(a) {
  return '<div class="md-wrap"><div class="md-bar"><span class="md-name">' + a.filename + "</span></div><pre class=\"md-pre\">" + esc(a.md) + "</pre></div>";
}

function renderReport(a) {
  const m = STATE.manifest;
  const gateRow = (x) => '<div class="rep-row ' + x.status + '"><span class="rep-status">' + (x.status === "pass" ? "✓" : x.status === "skip" ? "○" : "✕") + '</span><span class="rep-n">' + x.n + '</span><span class="rep-title">' + esc(x.title) + '</span><span class="rep-detail">' + esc(x.detail) + "</span></div>";
  const merged = a.aggregation.merged.map((gr) => "<div>«" + esc(gr.name) + "» " + fmtMoney(gr.price) + " €: " + gr.parts.map((p) => p.room + " " + fmtQty(p.qty)).join(" + ") + " → " + fmtQty(gr.qty) + " " + a.rows.find((r) => r.name === gr.name && r.price === gr.price).unit + "</div>").join("");
  const split = a.aggregation.keptSplit.map((gr) => "<div>«" + esc(gr.name) + "»: " + gr.prices.map((p) => fmtMoney(p) + " €").join(" | ") + " — строки остаются раздельными</div>").join("");
  const vc = a.variantChanges;
  return (
    '<div class="rep-grid">' +
    '<div class="rep-card"><div class="rep-h">Сборка</div><div class="rep-line">Файл: <b>' + a.filename + "</b></div>" +
    '<div class="rep-line">Слайдов: ' + a.sections.length + " · строк таблицы: " + a.rows.length + " · страницы таблицы: " + a.pages + " (" + a.rows.length + " строк, по 12 на страницу, заголовок повторяется)</div>" +
    '<div class="rep-line">Вариант: ' + a.variantLabel + (vc.replaced.length ? " · заменено строк: " + vc.replaced.length : "") + (vc.dropped.length ? " · исключено строк: " + vc.dropped.length : "") + "</div>" +
    '<div class="rep-line">Источники: карточка <span class="mono">' + esc(m.sources.card) + "</span>; смета — " + esc(m.sources.estimate) + "</div></div>" +
    '<div class="rep-card"><div class="rep-h">Агрегация</div>' + (merged || "<div>склеек нет</div>") + (split ? '<div class="rep-sub">Не склеено — одна работа, разные цены:</div>' + split : "") + "</div>" +
    '<div class="rep-card"><div class="rep-h">Арифметика</div><div class="rep-line">Итого по таблице: <b>' + fmtMoney(a.itogo) + " €</b></div>" +
    '<div class="rep-line">Сопутствующие: ' + fmtMoney(a.relTotal) + " € · черновые материалы: " + fmtMoney(a.materials) + " €</div>" +
    '<div class="rep-line">Строка цены: <b>' + fmtMoney(a.itogo) + " + " + fmtMoney(a.relTotal) + " + " + fmtMoney(a.materials) + " = " + fmtMoney(a.price) + " €</b> + 19% VAT</div></div>" +
    '<div class="rep-card"><div class="rep-h">Блоки</div><div class="rep-line">Использованы (' + a.sections.flatMap((x) => x.blocks).length + "): " + a.sections.flatMap((x) => x.blocks).join(", ") + "</div>" +
    '<div class="rep-line">Отключены: ' + (offBlocks(a).join(", ") || "—") + "</div></div>" +
    '<div class="rep-card gates"><div class="rep-h">Ворота 1–10</div>' + a.gates.map(gateRow).join("") + "</div>" +
    "</div>"
  );
}

function offBlocks(a) {
  const optional = ["plans", "photos", "prelim_note", "related", "org_process", "also_included", "prelim_volumes", "not_estimated", "separate_estimate", "engineering", "permits", "gallery", "reporting"];
  return optional.filter((b) => !a.has[b]);
}

function renderManifest() {
  const m = STATE.manifest;
  const f = (label, inner) => '<label class="mf-field"><span>' + label + "</span>" + inner + "</label>";
  return (
    '<div class="mf-grid">' +
    '<div class="mf-card"><div class="mf-h">Объект</div>' +
    f("Имя папки / YYNN (внутреннее)", '<input data-path="object.folder" value="' + esc(m.object.folder) + '">') +
    f("Подзаголовок (Документ 3.4)", '<input data-path="object.subtitle" value="' + esc(m.object.subtitle) + '">') +
    f("Дата отправки", '<input data-path="object.date" value="' + esc(m.object.date) + '">') +
    "</div>" +
    '<div class="mf-card"><div class="mf-h">Коммерция — значения Ивана</div>' +
    f("Род цены", '<select data-path="commerce.price.kind"><option value="final"' + (m.commerce.price.kind === "final" ? " selected" : "") + '>final</option><option value="estimate"' + (m.commerce.price.kind === "estimate" ? " selected" : "") + ">estimate</option></select>") +
    f("Черновые материалы, €", '<input data-path="commerce.materials" value="' + m.commerce.materials + '">') +
    f("Предоплата, €", '<input data-path="commerce.predoplata" value="' + m.commerce.predoplata + '">') +
    f("Второй платёж, €", '<input data-path="commerce.second_payment.amount" value="' + m.commerce.second_payment.amount + '">') +
    f("Срок, значение", '<input data-path="commerce.term.value" value="' + m.commerce.term.value + '">') +
    f("Срок, единица", '<select data-path="commerce.term.unit">' + ["недель", "дней", "месяцев"].map((u) => '<option' + (m.commerce.term.unit === u ? " selected" : "") + ">" + u + "</option>").join("") + "</select>") +
    f("Пункт об отчётности (длинные проекты)", '<input type="checkbox" data-path="commerce.reporting"' + (m.commerce.reporting ? " checked" : "") + ">") +
    "</div>" +
    '<div class="mf-card"><div class="mf-h">Макет</div>' +
    f("Заголовок зоны работ", '<input data-path="layout.works_heading" value="' + esc(m.layout.works_heading) + '">') +
    f("Организация процесса", '<select data-path="layout.org_process"><option value="on"' + (m.layout.org_process === "on" ? " selected" : "") + '>блок включён</option><option value="fold"' + (m.layout.org_process === "fold" ? " selected" : "") + ">свёрнута → «В стоимость также входит»</option></select>") +
    f("Форма «В стоимость не входят»", '<select data-path="layout.not_included_form"><option value="subsections"' + (m.layout.not_included_form === "subsections" ? " selected" : "") + '>подразделы</option><option value="prose"' + (m.layout.not_included_form === "prose" ? " selected" : "") + ">строкой (форма 2635)</option></select>") +
    f("Фото объекта", '<input type="checkbox" data-path="toggle-photos"' + (!m.layout.omit.includes("photos") ? " checked" : "") + ">") +
    f("Блок согласований (решение 3)", '<input type="checkbox" data-path="layout.permits"' + (m.layout.permits ? " checked" : "") + ">") +
    "</div>" +
    '<div class="mf-card"><div class="mf-h">Решения ТЗ</div>' +
    f("1. Бренд", '<select data-path="layout.brand"><option' + (m.layout.brand === "MELESHIN LTD" ? " selected" : "") + '>MELESHIN LTD</option><option' + (m.layout.brand === "MELESHIN Group" ? " selected" : "") + ">MELESHIN Group</option></select>") +
    f("2. Язык ЛК клиента (админ-тумблер)", '<select data-path="object.language"><option value="ru"' + (m.object.language === "ru" ? " selected" : "") + '>ru — кабинет на русском</option><option value="en" disabled>en [ ] — решение 2 ТЗ</option></select>') +
    f("4. Менеджер", '<select data-path="object.manager_top"><option value="1"' + (m.object.manager_top ? " selected" : "") + '>сверху, перед заголовком</option><option value="0"' + (!m.object.manager_top ? " selected" : "") + ">снизу</option></select>") +
    f("5. Срок действия", '<input value="14 дней — фиксированная строка" disabled>') +
    "</div>" +
    '<div class="mf-card mf-wide"><div class="mf-h">Манифест (ТЗ) — указатели на источники</div><pre class="mf-pre">object:    { folder: ' + esc(m.object.folder) + ', language: ' + m.object.language + ", date: " + esc(m.object.date) + " }\n" +
    "sources:\n  card:     " + esc(m.sources.card) + "\n  estimate: " + esc(m.sources.estimate) + "\n" +
    "images:   { hero, plans: [" + m.images.plans.length + "], photos: [" + m.images.photos.length + "], gallery: [" + m.images.gallery.length + "] }\n" +
    "commerce: { price: { kind: " + m.commerce.price.kind + " }, materials: " + fmtMoney(m.commerce.materials) + ",\n            payments: [предоплата " + fmtMoney(m.commerce.predoplata) + ", второй " + fmtMoney(m.commerce.second_payment.amount) + "], term: " + m.commerce.term.value + " " + esc(m.commerce.term.unit) + " }\n" +
    "layout:   { omit: [" + esc(m.layout.omit.join(", ")) + "], org_process: " + m.layout.org_process + ", related_table: " + m.layout.related_table + " }\n" +
    "variants: { penoplex, no-insulation }   # наложение на базовый состав</pre>" +
    '<div class="mf-actions"><button class="btn ghost" id="btn-reset">Сбросить манифест</button></div></div>' +
    "</div>"
  );
}

/* ============================================================
   Каркас: шапка, герой, сайдбар, тулбар
   ============================================================ */
const BLOCK_REGISTRY = [
  ["chrome", "Marp-обвязка: шапка + подвал"], ["manager", "Менеджер + телефон + дата"], ["title", "Коммерческое предложение"],
  ["subtitle", "Подзаголовок"], ["description", "Описание проекта"], ["plans", "План этажа"], ["photos", "Фото объекта"],
  ["works_head", "Заголовок зоны работ"], ["works_table", "Таблица работ + Итого"], ["prelim_note", "Предварительный характер"],
  ["related", "Проектные сопутствующие работы"], ["org_process", "Организация строительного процесса"], ["also_included", "В стоимость также входит"],
  ["prelim_volumes", "Объёмы определены предварительно"], ["not_estimated", "В оценку не вошло"], ["not_included", "В стоимость не входят"],
  ["separate_estimate", "Отдельной сметой"], ["engineering", "Инженерные работы"], ["permits", "Согласования и разрешения"],
  ["interaction", "Формат взаимодействия"], ["payment", "Условия оплаты a–h"], ["gallery", "Финальная галерея"],
];
const BLOCK_ANCHOR = { chrome: "sec-open", manager: "sec-open", title: "sec-open", subtitle: "sec-open", description: "sec-open", plans: "sec-plans", photos: "sec-photos-1", works_head: "sec-works", works_table: "sec-works", prelim_note: "sec-works", related: "sec-post", org_process: "sec-post", also_included: "sec-post", prelim_volumes: "sec-post", not_estimated: "sec-post", not_included: "sec-notinc", separate_estimate: "sec-notinc", engineering: "sec-notinc", permits: "sec-interaction", interaction: "sec-interaction", payment: "sec-payment", gallery: "sec-gallery" };

function renderSide(a) {
  const m = STATE.manifest;
  const present = new Set(a.sections.flatMap((x) => x.blocks));
  const variants = Object.entries(m.variants).map(([k, v]) => {
    const active = STATE.variant === k;
    const note = k === "base" ? "база" : k === "penoplex" ? "замена 1 строки" : "минус 1 строка";
    return '<div class="item' + (active ? " active" : "") + '" data-variant="' + k + '"><span class="name">' + v.label + "</span>" + '<span class="c">' + note + "</span></div>";
  }).join("");
  const blocks = BLOCK_REGISTRY.map(([id, title]) => {
    const on = present.has(id);
    const optional = ["plans", "photos", "prelim_note", "related", "org_process", "also_included", "prelim_volumes", "not_estimated", "separate_estimate", "engineering", "permits", "gallery"].includes(id);
    const mark = on ? "•" : optional ? "—" : "○";
    return '<div class="item bl' + (on ? " active" : "") + '" data-block="' + BLOCK_ANCHOR[id] + '" title="' + esc(title) + '"><span class="name">' + id + "</span>" + '<span class="c">' + mark + "</span></div>";
  }).join("");
  return (
    '<div class="group"><div class="h"><span>Вариант</span></div>' + variants + "</div>" +
    '<div class="group"><div class="h"><span>Блоки документа</span><span class="c">' + present.size + '/22</span></div>' + blocks + "</div>" +
    '<div class="group"><div class="h"><span>Решения ТЗ</span></div>' +
    '<div class="item" data-decision="brand"><span class="name">1 · Бренд</span><span class="c">' + (m.layout.brand === "MELESHIN LTD" ? "LTD" : "Group") + "</span></div>" +
    '<div class="item"><span class="name">2 · en-профиль</span><span class="c">[ ]</span></div>' +
    '<div class="item" data-decision="permits"><span class="name">3 · permits</span><span class="c">' + (m.layout.permits ? "вкл" : "выкл") + "</span></div>" +
    '<div class="item" data-decision="manager"><span class="name">4 · Менеджер</span><span class="c">' + (m.object.manager_top ? "сверху" : "снизу") + "</span></div>" +
    '<div class="item"><span class="name">5 · Срок действия</span><span class="c">14 дней</span></div>' +
    "</div>"
  );
}

function renderToolbar(a) {
  const views = [["doc", "Документ"], ["md", "Маркдаун"], ["manifest", "Конструктор"], ["report", "Отчёт"]];
  return (
    '<div class="d3-toolbar"><div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="doc-search" placeholder="Поиск по позициям…" value="' + esc(STATE.search) + '"' + (STATE.view === "doc" ? "" : " disabled") + "></div>" +
    '<div class="view-toggle">' + views.map(([k, label]) => '<button data-view="' + k + '"' + (STATE.view === k ? ' class="active"' : "") + ">" + label + "</button>").join("") + "</div></div>"
  );
}

/* ============================================================
   События админки
   ============================================================ */
function setPath(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const key = parts[parts.length - 1];
  if (typeof o[key] === "number" || (typeof o[key] === "string" && typeof value === "string" && value !== "" && !isNaN(Number(value)) && key !== "unit")) o[key] = Number(value);
  else o[key] = value;
}

function wire(a) {
  const root = document.getElementById("content");
  root.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { STATE.view = b.dataset.view; renderAllAdmin(); }));
  root.querySelectorAll("[data-variant]").forEach((b) => b.addEventListener("click", () => { STATE.variant = b.dataset.variant; renderAllAdmin(); renderSummary(build()); }));
  root.querySelectorAll("[data-block]").forEach((b) => b.addEventListener("click", () => {
    STATE.view = "doc";
    renderAllAdmin();
    const el = document.getElementById(b.dataset.block);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  root.querySelectorAll("[data-decision]").forEach((b) => b.addEventListener("click", () => {
    const d = b.dataset.decision;
    if (d === "brand") STATE.manifest.layout.brand = STATE.manifest.layout.brand === "MELESHIN LTD" ? "MELESHIN Group" : "MELESHIN LTD";
    if (d === "permits") STATE.manifest.layout.permits = !STATE.manifest.layout.permits;
    if (d === "manager") STATE.manifest.object.manager_top = !STATE.manifest.object.manager_top;
    renderAllAdmin();
    renderSummary(build());
  }));
  const search = root.querySelector("#doc-search");
  if (search) search.addEventListener("input", () => {
    STATE.search = search.value;
    const works = document.getElementById("sec-works");
    if (works) {
      const aa = build();
      works.querySelector(".bp-table, .doc-filter-note") && (works.innerHTML = '<div class="doc-h2">' + esc(STATE.manifest.layout.works_heading) + "</div>" + renderWorksTable(aa));
    } else renderAllAdmin();
  });
  root.querySelectorAll(".mf-field input[data-path], .mf-field select[data-path]").forEach((inp) => inp.addEventListener("change", () => {
    const p = inp.dataset.path;
    if (p === "toggle-photos") {
      const om = STATE.manifest.layout.omit;
      const i = om.indexOf("photos");
      if (inp.checked && i >= 0) om.splice(i, 1);
      if (!inp.checked && i < 0) om.push("photos");
    } else if (p === "object.manager_top") STATE.manifest.object.manager_top = inp.value === "1";
    else setPath(STATE.manifest, p, inp.type === "checkbox" ? inp.checked : inp.value);
    renderAllAdmin();
    renderSummary(build());
  }));
  const reset = document.getElementById("btn-reset");
  if (reset) reset.addEventListener("click", () => { STATE.manifest = clone(MANIFEST_DEFAULT); STATE.variant = "base"; renderAllAdmin(); renderSummary(build()); });
  const pv = document.getElementById("btn-preview");
  if (pv) pv.addEventListener("click", previewClient);
}

/* ============================================================
   Запуск админки
   ============================================================ */
function renderAllAdmin() {
  const a = build();
  document.getElementById("side").innerHTML = renderSide(a);
  let viewHtml;
  if (STATE.view === "doc") viewHtml = renderDoc(a);
  else if (STATE.view === "md") viewHtml = renderMd(a);
  else if (STATE.view === "manifest") viewHtml = renderManifest();
  else viewHtml = renderReport(a);
  document.getElementById("content").innerHTML = renderToolbar(a) + '<div id="view" class="view-' + STATE.view + '">' + viewHtml + "</div>";
  wire(a);
  return a;
}

// Сводка шапки: объект · вариант · цена · ворота — числа из той же сборки (калькулятор)
function renderSummary(a) {
  const el = document.getElementById("sum-line");
  if (!el) return;
  el.innerHTML = esc(STATE.manifest.object.field_object) + " · вариант: " + a.variantLabel +
    ' · цена: <b class="tnum">' + fmtMoney(a.price) + " €</b> + 19% VAT · ворота: " + a.gatesPassed + "/" + a.gatesTotal +
    ' · <span class="mono">' + a.filename + "</span>";
}

// Предпросмотр ЛК: текущее состояние конструктора уходит в адрес клиентской страницы
function previewClient() {
  const payload = { manifest: STATE.manifest, variant: STATE.variant, status: STATE.status };
  const b64 = btoa(String.fromCharCode.apply(null, new TextEncoder().encode(JSON.stringify(payload))));
  window.open(CLIENT_URL + "#preview=" + b64, "_blank");
}

if (document.getElementById("content")) {
  if (STATE.view === "estimate") STATE.view = "doc";   // «Смета» — экран ЛК клиента
  renderAllAdmin();
  renderSummary(build());
}
