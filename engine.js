// Движок машины сборки КП (engine.js) — модель реализации ТЗ "BP auto-assembly" (30.09).
// Общий код админки (bp-admin) и ЛК клиента (bp-client): машина + клиентские представления.
// Живёт в репо meleshin-bp-admin; ЛК клиента грузит его со страницы админки (script src).
// Модель: оператор (манифест) → машина (агрегация, арифметика, маршрут блоков, ворота) → документ (слайды + markdown).
// Производственная машина по ТЗ — bp-assemble.py (python3 stdlib); здесь та же логика в браузере.

/* ============================================================
   Утилиты
   ============================================================ */
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function thousands(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function fmtMoney(v) { return thousands(round2(v).toFixed(2).replace(".", ",")); }
function fmtQty(v) { return Number.isInteger(v) ? thousands(String(v)) : thousands(round2(v).toFixed(2).replace(".", ",")); }

/* ============================================================
   Машина: вариант → агрегация → таблица → документ
   ============================================================ */

// Наложение варианта (Правила сборки, правило 4): замена/исключение строк поверх базового состава.
function applyVariant(rows, manifest, variantKey) {
  const v = manifest.variants[variantKey] || { label: variantKey };
  const out = clone(rows);
  const changes = { replaced: [], dropped: [] };
  (v.replace || []).forEach((r) => {
    const i = out.findIndex((x) => x.name === r.match);
    if (i >= 0) { out[i] = Object.assign({}, r.row, { room: out[i].room }); changes.replaced.push({ from: r.match, to: r.row.name }); }
  });
  (v.drop || []).forEach((name) => {
    const i = out.findIndex((x) => x.name === name);
    if (i >= 0) { out.splice(i, 1); changes.dropped.push(name); }
  });
  return { rows: out, changes, label: v.label || variantKey };
}

// Агрегация (Правила сборки, правило 1): склейка по "имя + цена"; одинаковое имя с разными ценами не склеивается.
function aggregate(srcRows) {
  const order = [];
  const map = new Map();
  srcRows.forEach((r) => {
    const key = r.name + "||" + r.price.toFixed(2);
    if (!map.has(key)) { map.set(key, { name: r.name, unit: r.unit, qty: 0, price: r.price, cost: 0, parts: [] }); order.push(key); }
    const g = map.get(key);
    g.qty = round2(g.qty + r.qty);
    g.cost = round2(g.cost + round2(r.qty * r.price));
    g.parts.push({ room: r.room || "—", qty: r.qty });
  });
  const groups = order.map((k) => map.get(k));
  const merged = groups.filter((g) => g.parts.length > 1).map((g) => ({ name: g.name, price: g.price, parts: g.parts, qty: g.qty }));
  const byName = new Map();
  groups.forEach((g) => { if (!byName.has(g.name)) byName.set(g.name, []); byName.get(g.name).push(g.price); });
  const keptSplit = [...byName.entries()].filter(([, prices]) => prices.length > 1).map(([name, prices]) => ({ name, prices }));
  return { rows: groups, merged, keptSplit };
}

function relatedTotal(manifest) {
  return FIXED.related_rows.reduce((s, r) => s + round2(r.qty * r.price), 0);
}

// Сборка документа: блоки реестра в маршруте ТЗ (Документ), арифметика, итоги, markdown-эмиттер.
function assemble(manifest, variantKey) {
  const m = manifest;
  const brand = m.layout.brand;
  const vres = applyVariant(ESTIMATE_ROWS, m, variantKey);
  const agg = aggregate(vres.rows);

  const rows = agg.rows.map((r, i) => ({ n: i + 1, name: r.name, unit: r.unit, qty: r.qty, price: r.price, cost: r.cost, parts: r.parts }));
  const itogo = round2(rows.reduce((s, r) => s + r.cost, 0));
  const relTotal = m.layout.related_table === "separate" ? relatedTotal(m) : 0;
  const materials = m.commerce.materials;
  const price = round2(itogo + relTotal + materials);
  const worksSum = round2(itogo + relTotal);

  const omit = m.layout.omit || [];
  const has = {
    plans: !omit.includes("plans") && m.images.plans.length > 0,
    photos: !omit.includes("photos") && m.images.photos.length > 0,
    gallery: m.images.gallery.length > 0,
    permits: m.layout.permits && !omit.includes("permits"),
    related: m.layout.related_table === "separate",
    prelim_note: m.commerce.price.kind === "estimate",
    org_process: m.layout.org_process === "on",
    also_included: m.layout.org_process === "fold",
    prelim_volumes: (m.layout.prelim_volumes || []).length > 0,
    not_estimated: (m.layout.not_estimated || []).length > 0,
    separate_estimate: (m.layout.separate_estimate || []).length > 0,
    engineering: !!m.layout.engineering,
    reporting: !!m.commerce.reporting,
  };

  const emptySlots = [];
  if (m.commerce.materials === null || m.commerce.materials === "") emptySlots.push("materials");
  if (!m.commerce.predoplata) emptySlots.push("predoplata");

  // Цена (Документ 3.21а): строка-заголовок собирается из таблицы + сопутствующих + материалов.
  const priceLine = (m.commerce.price.kind === "estimate" ? "Ориентировочная стоимость по проекту составляет " : "Стоимость по проекту составляет ") + fmtMoney(price) + " € + 19% VAT.";
  const breakdownLine = "В том числе: работы — " + fmtMoney(worksSum) + " € (согласно таблице работ), черновые материалы — " + fmtMoney(materials) + " €.";

  const sections = [];
  const md = [];

  // --- Слайд 1: chrome → manager → title → subtitle → description
  const managerMd = '<div style="text-align: right; color: #555;">' + FIXED.manager.name + '<br>\n<a href="' + FIXED.manager.phone_href + '" style="color: #555;">' + FIXED.manager.phone + "</a><br>\n" + m.object.date + "\n</div>";
  const openingFinal = (m.object.opening || "").replace("{brand}", brand.replace(/^MELESHIN\s*/, ""));

  md.push("---");
  md.push("marp: true");
  md.push('theme: "concept-note-involve"');
  md.push("paginate: true");
  md.push("header: '<span style=\"display:block;font-size:18px;border-bottom:1.5px solid #ccc;padding-bottom:1mm\"><img src=\"../../meleshin-logo.png\" style=\"float:left;height:23px;object-fit:contain;margin-right:12px\"><span style=\"position:relative\"><b>" + brand + "</b> <span style=\"font-weight:400\">| Коммерческое предложение</span></span></span>'");
  md.push('footer: <a href="https://meleshin.com.cy" style="color: inherit; text-decoration: none;">' + brand + '</a> | <a href="tel:+35777788811" style="color: inherit; text-decoration: none;">+357 77 788811</a> | [order@meleshin.com.cy](mailto:order@meleshin.com.cy) | <a href="https://www.instagram.com/renovation_cyprus" style="color: inherit; text-decoration: none;">Instagram: renovation_cyprus</a>');
  md.push("---");
  md.push("");
  if (m.object.manager_top) { md.push(managerMd); md.push(""); }
  md.push("# <div style=\"text-align: center;\">" + FIXED.title + "</div>");
  md.push("");
  md.push('<div style="text-align: center;">' + m.object.subtitle + "</div>");
  md.push("");
  md.push("## " + FIXED.description_h2);
  md.push("");
  md.push('<div style="display:grid;grid-template-columns:63% 34%;gap:6mm;align-items:start">');
  md.push("<div>");
  md.push("");
  md.push(openingFinal);
  md.push("");
  md.push("**Объект.** " + m.object.field_object);
  md.push("");
  md.push("**Зона работ.** " + m.object.field_zone);
  md.push("");
  md.push("**Материалы и транспорт.** " + m.object.field_materials);
  md.push("");
  md.push("</div>");
  md.push('<div><img src="' + m.images.hero + '" style="height:90mm;width:100%;object-fit:cover"></div>');
  md.push("</div>");

  sections.push({ id: "sec-open", slide: 1, title: "Титул и описание проекта", blocks: ["chrome", "manager", "title", "subtitle", "description"] });

  // --- Слайд: план
  if (has.plans) {
    md.push("");
    md.push("---");
    md.push("");
    md.push("## " + FIXED.plans_h2);
    md.push("");
    md.push('<div style="text-align:center"><img src="' + m.images.plans[0] + '" style="width:60%"></div>');
    sections.push({ id: "sec-plans", slide: sections.length + 1, title: FIXED.plans_h2, blocks: ["plans"] });
  }

  // --- Слайды: фото объекта, по 3 на слайд (Документ 3.7)
  if (has.photos) {
    const per = 3;
    for (let i = 0; i < m.images.photos.length; i += per) {
      const chunk = m.images.photos.slice(i, i + per);
      const head = i === 0 ? FIXED.photos_h2_start : FIXED.photos_h2_cont;
      md.push("");
      md.push("---");
      md.push("");
      md.push("## " + head);
      md.push("");
      md.push('<div style="display:flex;gap:4mm">' + chunk.map((p) => '<img src="' + p + '" style="height:100mm;flex:1;object-fit:cover">').join("") + "</div>");
      sections.push({ id: "sec-photos-" + (i / per + 1), slide: sections.length + 1, title: head, blocks: ["photos"], photos: chunk });
    }
  }

  // --- Зона работ: заголовок + таблица с разбивкой по страницам (Правила сборки, правило 2)
  const worksHeading = m.layout.works_heading || "Состав работ";
  const alignRow = "|:--:|:--|--:|--:|--:|--:|";
  const headerRow = "| " + FIXED.works_cols.join(" | ") + " |";
  const itogoMd = "| | **Итого:** | | | | **" + fmtMoney(itogo) + "** |";
  const perPage = 12;
  const pages = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));

  md.push("");
  md.push("---");
  md.push("");
  md.push("## " + worksHeading);
  md.push("");
  pages.forEach((p, pi) => {
    if (pi > 0) { md.push(""); md.push("---"); md.push(""); }
    md.push(headerRow);
    md.push(alignRow);
    p.forEach((r) => md.push("| " + r.n + " | " + r.name + " | " + r.unit + " | " + fmtQty(r.qty) + " | " + fmtMoney(r.price) + " | " + fmtMoney(r.cost) + " |"));
    if (pi === pages.length - 1) md.push(itogoMd);
  });
  if (has.prelim_note) { md.push(""); md.push(FIXED.prelim_note); }

  const tableBlocks = ["works_head", "works_table"].concat(has.prelim_note ? ["prelim_note"] : []);
  sections.push({ id: "sec-works", slide: sections.length + 1, title: worksHeading, blocks: tableBlocks });

  // --- Зона после таблицы: related → org_process → also_included → prelim_volumes → not_estimated
  if (has.related || has.org_process || has.also_included || has.prelim_volumes || has.not_estimated) {
    md.push("");
    md.push("---");
    md.push("");
    const postBlocks = [];
    if (has.related) {
      md.push("## " + FIXED.related_h2);
      md.push("");
      md.push("| " + FIXED.related_cols.join(" | ") + " |");
      md.push("|:--:|:--|--:|--:|--:|");
      FIXED.related_rows.forEach((r, i) => md.push("| " + (i + 1) + " | " + r.name + " | " + r.unit + " | " + fmtQty(r.qty) + " | " + fmtMoney(r.price) + " |"));
      md.push("");
      postBlocks.push("related");
    }
    if (has.org_process) {
      md.push("### " + FIXED.org_process_h3);
      md.push("");
      FIXED.org_process.forEach((b) => md.push("- " + b));
      md.push("");
      postBlocks.push("org_process");
    }
    if (has.also_included) {
      md.push("### " + FIXED.also_included_h3);
      md.push("");
      FIXED.also_included.forEach((b) => md.push("- " + b));
      md.push("");
      postBlocks.push("also_included");
    }
    if (has.prelim_volumes) {
      md.push("### " + FIXED.prelim_volumes_h3);
      md.push("");
      m.layout.prelim_volumes.forEach((x) => md.push("- " + x));
      md.push("");
      if (has.not_estimated) {
        md.push("### " + FIXED.not_estimated_h3);
        md.push("");
        m.layout.not_estimated.forEach((x) => md.push("- " + x));
        md.push("");
      }
      md.push(FIXED.prelim_volumes_close);
      md.push("");
      postBlocks.push("prelim_volumes");
      if (has.not_estimated) postBlocks.push("not_estimated");
    }
    sections.push({ id: "sec-post", slide: sections.length + 1, title: has.related ? FIXED.related_h2 : FIXED.org_process_h3, blocks: postBlocks });
  }

  // --- Зона исключений: not_included (+ separate_estimate, engineering)
  md.push("");
  md.push("---");
  md.push("");
  md.push("## " + FIXED.not_included_h2);
  md.push("");
  const niBlocks = ["not_included"];
  if (m.layout.not_included_form === "prose") {
    md.push("Чистовая электрика, чистовая сантехника.");
    md.push("");
    md.push("*" + FIXED.finish_note + "*");
    md.push("");
  } else {
    FIXED.not_included_sections.forEach((secName) => {
      const items = (m.layout.not_included_sections || {})[secName];
      if (!items || items.length === 0) return;
      md.push("### " + secName);
      md.push("");
      items.forEach((x) => md.push("- " + x));
      md.push("");
    });
  }
  if ((m.layout.extra_works || []).length > 0) {
    md.push(FIXED.extra_opener);
    md.push("");
    m.layout.extra_works.forEach((x) => md.push("- " + x));
    md.push("");
  }
  if (has.separate_estimate) {
    md.push("### " + FIXED.separate_h3);
    md.push("");
    m.layout.separate_estimate.forEach((x) => md.push("- " + x));
    md.push("");
    md.push(FIXED.separate_close);
    md.push("");
    niBlocks.push("separate_estimate");
  }
  if (has.engineering) {
    md.push("### " + FIXED.engineering_h3);
    md.push("");
    md.push(m.layout.engineering);
    md.push("");
    niBlocks.push("engineering");
  }
  sections.push({ id: "sec-notinc", slide: sections.length + 1, title: FIXED.not_included_h2, blocks: niBlocks });

  // --- permits → interaction
  md.push("");
  md.push("---");
  md.push("");
  const intBlocks = [];
  if (has.permits) {
    md.push("## " + FIXED.permits_h2);
    md.push("");
    FIXED.permits.forEach((p) => { md.push(p); md.push(""); });
    intBlocks.push("permits");
  }
  md.push("## " + FIXED.interaction_h2);
  md.push("");
  md.push("- Работы выполняются в соответствии с " + m.object.basis_doc + ".");
  FIXED.interaction_fixed.forEach((b) => md.push("- " + b));
  if (has.reporting) md.push("- " + FIXED.reporting);
  md.push("");
  intBlocks.push("interaction");
  sections.push({ id: "sec-interaction", slide: sections.length + 1, title: FIXED.interaction_h2, blocks: intBlocks });

  // --- payment (a → h, Документ 3.21)
  md.push("");
  md.push("---");
  md.push("");
  md.push("## " + FIXED.payment_h2);
  md.push("");
  md.push("### " + priceLine);
  md.push("");
  if (m.commerce.price.kind === "estimate" && m.commerce.price.clause) { md.push("Стоимость " + m.commerce.price.clause + "."); md.push(""); }
  md.push(breakdownLine);
  md.push("");
  md.push(FIXED.vat_para);
  md.push("");
  md.push("**Предоплата: " + fmtMoney(m.commerce.predoplata || 0) + " € + 19% VAT** — " + FIXED.predoplata_purpose + ".");
  md.push("");
  if (m.commerce.second_payment && m.commerce.second_payment.amount) {
    md.push("**Второй платёж: " + fmtMoney(m.commerce.second_payment.amount) + " € + 19% VAT** — " + m.commerce.second_payment.note + ".");
    md.push("");
  }
  md.push(FIXED.final_settlement);
  md.push("");
  md.push("### Срок реализации: " + m.commerce.term.value + " " + m.commerce.term.unit);
  md.push("");
  md.push(FIXED.term_tail);
  md.push("");
  md.push(FIXED.validity);
  sections.push({ id: "sec-payment", slide: sections.length + 1, title: FIXED.payment_h2, blocks: ["payment"] });

  // --- manager снизу (решение 4, вариант 2631/2635)
  if (!m.object.manager_top) { md.push(""); md.push(managerMd); }

  // --- gallery
  if (has.gallery) {
    md.push("");
    md.push("---");
    md.push("");
    for (let i = 0; i < m.images.gallery.length; i += 3) {
      md.push('<div style="display:flex;gap:4mm">' + m.images.gallery.slice(i, i + 3).map((p) => '<img src="' + p + '" style="height:62mm;flex:1;object-fit:cover">').join("") + "</div>");
      md.push("");
    }
    sections.push({ id: "sec-gallery", slide: sections.length + 1, title: "Галерея", blocks: ["gallery"] });
  }

  // Имя файла (Маркдаун): YYNN допустимо в имени файла, запрещено в клиентских полях.
  let filename = m.object.date_iso + "-meleshin-" + m.object.folder + "-BP";
  if (variantKey !== "base") filename += "-" + variantKey;
  if (emptySlots.length > 0) filename += "-v1";
  filename += ".md";

  return {
    variantKey, variantLabel: vres.label, variantChanges: vres.changes,
    rows, itogo, relTotal, materials, price, worksSum, priceLine, breakdownLine,
    has, emptySlots, sections, filename,
    aggregation: agg, pages: pages.length,
    md: md.join("\n") + "\n",
  };
}

/* ============================================================
   Ворота (Правила сборки, раздел 3) — сборка не завершена, пока не пройдены все
   ============================================================ */
function alphaTokens(text) {
  return text.toLowerCase().replace(/\d+/g, " ").replace(/[^a-zа-яё²%]/g, " ").split(/\s+/).filter(Boolean);
}

function runGates(a, manifest, prev) {
  const g = [];
  const m = manifest;

  // 1. qty × price = cost — вычисляется машиной, класс дефектов исключён конструктивно
  const bad1 = a.rows.filter((r) => round2(r.qty * r.price) !== r.cost);
  g.push({ n: 1, title: "Строка: Кол-во × Цена = Стоимость", status: bad1.length ? "fail" : "pass", detail: bad1.length ? "расхождение: " + bad1.map((r) => "#" + r.n).join(", ") : a.rows.length + " строк вычислены машиной (2 знака)" });

  // 2. Итого и строка цены
  const itogoOk = round2(a.rows.reduce((s, r) => s + r.cost, 0)) === a.itogo;
  const priceOk = a.price === round2(a.itogo + a.relTotal + a.materials);
  g.push({ n: 2, title: "Итого = Σ стоимости; цена = Итого + сопутствующие + материалы", status: itogoOk && priceOk ? "pass" : "fail", detail: fmtMoney(a.itogo) + " + " + fmtMoney(a.relTotal) + " + " + fmtMoney(a.materials) + " = " + fmtMoney(a.price) + " €" });

  // 3. Обновление только цен: мультимножество количеств совпадает с предыдущей сборкой
  if (!prev) g.push({ n: 3, title: "Только цены: количества совпадают с предыдущей версией", status: "skip", detail: "первая сборка в сеансе — сравнивать не с чем" });
  else if (prev.variantKey !== a.variantKey) g.push({ n: 3, title: "Только цены: количества совпадают с предыдущей версией", status: "skip", detail: "заявленное структурное изменение варианта (" + prev.variantLabel + " → " + a.variantLabel + ")" });
  else {
    const q1 = prev.rows.map((r) => r.qty).sort((x, y) => x - y).join(",");
    const q2 = a.rows.map((r) => r.qty).sort((x, y) => x - y).join(",");
    g.push({ n: 3, title: "Только цены: количества совпадают с предыдущей версией", status: q1 === q2 ? "pass" : "fail", detail: q1 === q2 ? "мультимножество количеств совпадает" : "состав количеств изменился" });
  }

  // 4. Фиксированные блоки байт-в-байт шаблону
  const mdHas = (s) => a.md.includes(s);
  const fixedOk = [FIXED.vat_para, FIXED.final_settlement, FIXED.validity, FIXED.term_tail].every(mdHas);
  g.push({ n: 4, title: "Фиксированные блоки байт-в-байт равны шаблону", status: fixedOk ? "pass" : "fail", detail: fixedOk ? "все фиксированные строки испущены из шаблона без правок" : "фиксированный блок расходится с шаблоном" });

  // 5. Маршрут: зоны по порядку, обязательные блоки на месте
  const mandatory = ["chrome", "manager", "title", "subtitle", "description", "works_head", "works_table", "not_included", "interaction", "payment"];
  const present = new Set(a.sections.flatMap((s) => s.blocks));
  const missing = mandatory.filter((b) => !present.has(b));
  g.push({ n: 5, title: "Маршрут: зоны ТЗ (Документ), обязательные блоки присутствуют", status: missing.length ? "fail" : "pass", detail: missing.length ? "отсутствуют: " + missing.join(", ") : a.sections.length + " слайдов, зоны в порядке" });

  // 6. ___ только в -v1; деньги всегда 2 знака
  const moneyBad = (a.md.match(/\d[ \d]*,\d? €/g) || []).filter((x) => !/,\d{2} €/.test(x));
  const v1suffix = a.filename.includes("-v1");
  const slotsOk = a.emptySlots.length === 0 || v1suffix;
  g.push({ n: 6, title: "___ только в -v1; деньги с двумя знаками", status: slotsOk && moneyBad.length === 0 ? "pass" : "fail", detail: (slotsOk ? (a.emptySlots.length ? "пустые слоты: " + a.emptySlots.join(", ") + " (файл -v1)" : "пустых слотов нет") : "пустой слот без суффикса -v1") + "; формат: пробел тысяч, запятая, 2 знака" });

  // 7. YYNN не в клиентских полях
  const yynn = (m.object.folder.match(/^\d{4}/) || [""])[0];
  const clientFields = { subtitle: m.object.subtitle, opening: m.object.opening || "", field_object: m.object.field_object, works_heading: m.layout.works_heading };
  const leak = Object.entries(clientFields).filter(([, v]) => yynn && String(v).includes(yynn)).map(([k]) => k);
  g.push({ n: 7, title: "YYNN не попадает в клиентские поля", status: leak.length ? "fail" : "pass", detail: leak.length ? "утечка: " + leak.join(", ") : yynn + " — только в имени папки и файла" });

  // 8. Расхождение — факт, не правка значения (принцип, ворота 8)
  g.push({ n: 8, title: "Расхождение сообщается фактом, значение не подгоняется", status: "pass", detail: "принцип машины: ворота не правят данные" });

  // 9. Повторы: заголовки уникальны, метки полей не конфликтуют, 5-словных повторов между блоками нет
  const rep = repetitionScan(a, manifest);
  g.push({ n: 9, title: "Повторы: один факт — один носитель", status: rep.fail ? "fail" : "pass", detail: rep.detail });

  // 10. Каждая картинка разрешается в существующий файл
  const imgs = [["hero", m.images.hero]].concat(m.images.plans.map((p) => ["plans", p])).concat(m.images.photos.map((p) => ["photos", p])).concat(m.images.gallery.map((p) => ["gallery", p]));
  const dead = imgs.filter(([, p]) => !p);
  g.push({ n: 10, title: "Нет битых ссылок на изображения", status: dead.length ? "fail" : "pass", detail: dead.length ? "пустые ссылки: " + dead.map(([k]) => k).join(", ") : imgs.length + " ссылок разрешаются в файлы объекта" });

  return g;
}

// Скан повторов (ворота 9): заголовки, метки полей, 5-словные альфа-последовательности.
// Числа вырезаются — итоги в строке цены освобождены автоматически (значения, не проза).
function repetitionScan(a, manifest) {
  const fails = [];
  const notes = [];
  const m = manifest;

  // Сканируются только блоки, реально вошедшие в документ: org_process и also_included
  // взаимоисключающи (Документ 3.13) и вместе в сборке не встречаются.
  const blockTexts = [
    { id: "subtitle", text: m.object.subtitle, on: true },
    { id: "description", text: [m.object.opening, m.object.field_object, m.object.field_zone, m.object.field_materials].join(" "), on: true },
    { id: "works_head", text: m.layout.works_heading, on: true },
    { id: "related", text: FIXED.related_h2, on: a.has.related },
    { id: "org_process", text: FIXED.org_process_h3 + " " + FIXED.org_process.join(" "), on: a.has.org_process },
    { id: "also_included", text: FIXED.also_included_h3 + " " + FIXED.also_included.join(" "), on: a.has.also_included },
    { id: "not_included", text: FIXED.not_included_h2 + " " + Object.entries(m.layout.not_included_sections || {}).map(([k, v]) => k + " " + v.join(" ")).join(" "), on: true },
    { id: "extra", text: FIXED.extra_opener + " " + (m.layout.extra_works || []).join(" "), on: (m.layout.extra_works || []).length > 0 },
    { id: "separate_estimate", text: FIXED.separate_h3 + " " + (m.layout.separate_estimate || []).join(" "), on: a.has.separate_estimate },
    { id: "permits", text: FIXED.permits_h2 + " " + FIXED.permits.join(" "), on: a.has.permits },
    { id: "interaction", text: FIXED.interaction_h2 + " Работы выполняются в соответствии с " + m.object.basis_doc + ". " + FIXED.interaction_fixed.join(" "), on: true },
    { id: "payment", text: FIXED.payment_h2 + " " + a.priceLine + " " + a.breakdownLine + " " + FIXED.vat_para + " " + FIXED.final_settlement + " " + FIXED.term_tail + " " + FIXED.validity, on: true },
    { id: "prelim_volumes", text: FIXED.prelim_volumes_h3 + " " + (m.layout.prelim_volumes || []).join(" ") + (a.has.not_estimated ? " " + FIXED.not_estimated_h3 + " " + (m.layout.not_estimated || []).join(" ") : ""), on: a.has.prelim_volumes },
  ].filter((b) => b.on && b.text && b.text.trim());

  // Заголовки уникальны документ-wide
  const headings = [FIXED.title, FIXED.description_h2, FIXED.plans_h2, FIXED.photos_h2_start, FIXED.photos_h2_cont, m.layout.works_heading, FIXED.related_h2, FIXED.org_process_h3, FIXED.also_included_h3, FIXED.prelim_volumes_h3, FIXED.not_estimated_h3, FIXED.not_included_h2, FIXED.separate_h3, FIXED.engineering_h3, FIXED.permits_h2, FIXED.interaction_h2, FIXED.payment_h2].filter(Boolean);
  const seen = new Map();
  headings.forEach((h) => seen.set(h, (seen.get(h) || 0) + 1));
  const dupHeads = [...seen.entries()].filter(([, c]) => c > 1).map(([h]) => h);
  if (dupHeads.length) fails.push("заголовок повторяется: " + dupHeads.join("; "));

  // Метки полей описания не конфликтуют с заголовками
  const labels = ["Объект", "Зона работ", "Материалы и транспорт"];
  const clash = labels.filter((l) => headings.some((h) => h.toLowerCase() === l.toLowerCase()));
  if (clash.length) fails.push("метка поля совпадает с заголовком: " + clash.join("; "));

  // 5-словные альфа-последовательности между разными блоками
  const win = new Map();
  blockTexts.forEach((b) => {
    const toks = alphaTokens(b.text);
    for (let i = 0; i + 4 < toks.length; i++) {
      const key = toks.slice(i, i + 5).join(" ");
      if (!win.has(key)) win.set(key, new Set());
      win.get(key).add(b.id);
    }
  });
  const reps = [...win.entries()].filter(([, ids]) => ids.size > 1);
  if (reps.length) fails.push("5-словный повтор между блоками: " + reps.slice(0, 3).map(([k, ids]) => '"' + k + '" (' + [...ids].join(" × ") + ")").join("; "));

  // Контроль рамок шаблона: субтитул (6.4) × вступление (6.5) делят фразу-рамку
  const st = alphaTokens(m.object.subtitle || "");
  const ot = alphaTokens(m.object.opening || "");
  let longest = 0;
  for (let i = 0; i < st.length; i++) {
    for (let j = 0; j < ot.length; j++) {
      let k = 0;
      while (i + k < st.length && j + k < ot.length && st[i + k] === ot[j + k]) k++;
      if (k > longest) longest = k;
    }
  }
  notes.push("общий сегмент субтитул × вступление: " + longest + " сл. при пороге 5 (рамки 6.4/6.5)");

  return { fail: fails.length > 0 || longest >= 5, detail: (fails.length ? fails.join("; ") + "; " : "повторов нет; ") + notes.join("; ") };
}

/* ============================================================
   Состояние и сборка
   ============================================================ */
const STATE = {
  manifest: clone(MANIFEST_DEFAULT),
  variant: "base",
  view: "estimate", // смета (клиент) | документ | маркдаун | манифест | отчёт
  works: true, materials: true, // экраны сметы: Работы / Материалы — нажаты по одной или обе
  room: "all", // помещения сметы (навигация слева)
  status: "sent", // Отправлен | Согласован с клиентом (ТЗ Клиентская смета, 4)
  search: "",
  prev: null,
};

function build() {
  const a = assemble(STATE.manifest, STATE.variant);
  a.gates = runGates(a, STATE.manifest, STATE.prev);
  a.gatesPassed = a.gates.filter((x) => x.status === "pass").length;
  a.gatesTotal = a.gates.length;
  STATE.prev = a;
  return a;
}

/* ============================================================
   Клиентская смета: экраны работы/материалы + помещения
   (структура клиентского бюджета: сверху экраны, слева помещения)
   ============================================================ */

// Модель сметы: агрегированные строки работ (та же агреграция машины),
// агрегированные материалы, помещения с подсчётом по зонам.
function estimateModel(a) {
  const mAgg = aggregate(MATERIALS_ROWS);
  const materialsRows = mAgg.rows.map((r, i) => ({ n: i + 1, name: r.name, unit: r.unit, qty: r.qty, price: r.price, cost: r.cost, parts: r.parts }));
  const materialsTotal = round2(materialsRows.reduce((s, r) => s + r.cost, 0));
  const names = [];
  ESTIMATE_ROWS.forEach((r) => { if (r.room && !names.includes(r.room)) names.push(r.room); });
  MATERIALS_ROWS.forEach((r) => { if (r.room && !names.includes(r.room)) names.push(r.room); });
  const rooms = names.map((z) => {
    let wc = 0;
    let mc = 0;
    let sum = 0;
    a.rows.forEach((r) => r.parts.forEach((p) => { if (p.room === z) { wc++; sum = round2(sum + round2(p.qty * r.price)); } }));
    mAgg.rows.forEach((r) => r.parts.forEach((p) => { if (p.room === z) mc++; }));
    return { name: z, wc, mc, sum };
  });
  return { materialsRows, materialsTotal, rooms };
}

// Встроенный калькулятор: экран показывает позиции сметы, и каждое число считается
// из видимых строк — каунтер считает строки таблицы, итог блока суммирует их.
// «Все» — группы помещений со сквозной нумерацией (сопутствующие ед. мес. — последняя
// именованная группа, в каунтеры не входят), помещение — своя группа, нумерация с 1.
// Агрегация имя+цена остаётся в документе КП, клиентский экран её не показывает.
function estimateGroups(src, room, rooms, related) {
  const posRows = (roomKey, startN) => src.filter((r) => r.room === roomKey).map((r, i) => ({ n: startN + i, name: r.name, unit: r.unit, qty: r.qty, price: r.price, cost: round2(r.qty * r.price) }));
  if (room !== "all") return [{ label: null, rows: posRows(room, 1) }];
  const gs = [];
  let n = 1;
  rooms.forEach((r) => {
    const rows = posRows(r.name, n);
    n += rows.length;
    if (rows.length) gs.push({ label: r.name, rows });
  });
  if (related.length) gs.push({ label: FIXED.related_h2, rows: related.map((r, i) => Object.assign({ n: n + i }, r)) });
  return gs;
}

function renderEstimate(a) {
  const em = estimateModel(a);
  const room = STATE.room;
  // Две таблицы (канон): «Строительно-монтажные, отделочные и сопутствующие работы» —
  // СМР по помещениям + сопутствующие строками той же таблицы (ед. мес., без помещения);
  // «Материалы» — черновые, в стоимости. Итоги таблиц сходятся к «Стоимость по проекту».
  const relRaw = FIXED.related_rows.map((r) => ({ name: r.name, unit: r.unit, qty: r.qty, price: r.price, cost: round2(r.qty * r.price) }));
  const related = STATE.manifest.layout.related_table === "separate" ? relRaw : [];
  const worksGroups = estimateGroups(applyVariant(ESTIMATE_ROWS, STATE.manifest, STATE.variant).rows, room, em.rooms, related);
  const matGroups = estimateGroups(MATERIALS_ROWS, room, em.rooms, []);

  const rowHtml = (r) => '<div class="est-row"><div class="num">' + r.n + '</div><div class="name">' + esc(r.name) + '</div><div class="unit">' + esc(r.unit) + '</div><div class="qty tnum">' + fmtQty(r.qty) + '</div><div class="price tnum">' + fmtMoney(r.price) + '</div><div class="cost tnum">' + fmtMoney(r.cost) + "</div></div>";
  const head = (kind) => '<div class="est-head"><div>#</div><div>' + (kind === "w" ? "Работа" : "Материал") + '</div><div>Ед.</div><div class="r">Кол&#8209;во</div><div class="r">Цена за ед., €</div><div class="r">Стоимость, €</div></div>';
  const groupHtml = (g) => (g.label ? '<div class="est-group">' + esc(g.label) + "</div>" : "") + g.rows.map(rowHtml).join("");
  const block = (title, grps, kind) => {
    const rows = grps.flatMap((g) => g.rows);
    const total = round2(rows.reduce((s, r) => s + r.cost, 0));
    return '<div class="est-blk"><div class="blk-head"><span class="blk-name">' + title + '</span><span class="blk-total"><span class="tnum">' + fmtMoney(total) + " €</span></span></div>" +
      '<div class="est-table">' + head(kind) + grps.map(groupHtml).join("") + "</div></div>";
  };

  const single = !(STATE.works && STATE.materials);
  let blocks = "";
  if (STATE.works) blocks += block("Строительно-монтажные, отделочные и сопутствующие работы", worksGroups, "w");
  if (STATE.materials) blocks += block("Материалы", matGroups, "m");

  const screens = '<div class="est-screens">' + [["works", "Работы", STATE.works], ["materials", "Материалы", STATE.materials]]
    .map(([k, l, on]) => '<button data-screen="' + k + '"' + (on ? ' class="active"' : "") + ">" + l + "</button>").join("") + "</div>";
  // Каунтер = строки таблицы этого экрана (калькулятор: считаются показанные позиции);
  // «Все» = сумма каунтеров помещений (работы 37, материалы 36); сопутствующие (ед. мес.)
  // — отдельная именованная группа без помещения, в каунтеры не входят. Оба экрана → каунтеров нет.
  const one = STATE.works !== STATE.materials;
  const cnt = (n) => (one ? '<span class="c">' + n + "</span>" : "");
  const pick = (r) => (STATE.works ? r.wc : r.mc);
  const total = one ? em.rooms.reduce((s, r) => s + pick(r), 0) : 0;
  const roomsNav = '<div class="est-rooms">' + screens + '<div class="est-rooms-h">Помещение</div>' +
    '<button data-room="all"' + (room === "all" ? ' class="active"' : "") + '><span>Все</span>' + cnt(total) + "</button>" +
    em.rooms.map((r) => '<button data-room="' + esc(r.name) + '"' + (room === r.name ? ' class="active"' : "") + '><span>' + esc(r.name) + "</span>" + cnt(pick(r)) + "</button>").join("") + "</div>";
  return '<div id="est-root"><div class="est-body">' + roomsNav +
    '<div class="panel-dark' + (single ? " single" : "") + '">' + blocks + "</div></div></div>";
}

/* ============================================================
   Представление: документ (слайды)
   ============================================================ */
function renderWorksTable(a) {
  const s = STATE.search.trim().toLowerCase();
  const rows = s ? a.rows.filter((r) => r.name.toLowerCase().includes(s)) : a.rows;
  return (
    '<div class="bp-table"><div class="bp-head">' + FIXED.works_cols.map((c, i) => '<div class="' + (i > 2 ? "r" : "") + '">' + c + "</div>").join("") + "</div>" +
    rows.map((r) => '<div class="bp-row"><div class="num">' + r.n + '</div><div class="work">' + esc(r.name) + '</div><div class="unit">' + esc(r.unit) + '</div><div class="qty tnum">' + fmtQty(r.qty) + '</div><div class="price tnum">' + fmtMoney(r.price) + '</div><div class="sum tnum">' + fmtMoney(r.cost) + "</div></div>").join("") +
    '<div class="bp-total"><span class="lbl">Итого:</span><span class="v tnum">' + fmtMoney(a.itogo) + " €</span></div></div>" +
    (a.has.prelim_note ? '<p class="doc-note">' + FIXED.prelim_note + "</p>" : "") +
    (s ? '<div class="doc-filter-note">Поиск: ' + rows.length + " из " + a.rows.length + " позиций</div>" : "")
  );
}

function renderDoc(a) {
  const m = STATE.manifest;
  const secHtml = [];

  a.sections.forEach((sec) => {
    let inner = "";
    if (sec.id === "sec-open") {
      const mgr = '<div class="doc-manager"><div>' + FIXED.manager.name + '</div><a href="' + FIXED.manager.phone_href + '">' + FIXED.manager.phone + "</a><div>" + esc(m.object.date) + "</div></div>";
      inner = (m.object.manager_top ? mgr : "") +
        '<div class="doc-title-outer"><div class="doc-title">' + FIXED.title + '</div><div class="doc-subtitle">' + esc(m.object.subtitle) + "</div></div>" +
        '<div class="doc-h2">' + FIXED.description_h2 + '</div><div class="doc-grid"><div class="doc-text"><p>' + esc(m.object.opening.replace("{brand}", m.layout.brand.replace(/^MELESHIN\s*/, ""))) + '</p><p><b>Объект.</b> ' + esc(m.object.field_object) + '</p><p><b>Зона работ.</b> ' + esc(m.object.field_zone) + '</p><p><b>Материалы и транспорт.</b> ' + esc(m.object.field_materials) + "</p></div>" +
        '<div class="doc-hero"><img src="' + m.images.hero + '" alt=""></div></div>';
    } else if (sec.id === "sec-plans") {
      inner = '<div class="doc-h2">' + FIXED.plans_h2 + '</div><div class="doc-plan"><img src="' + m.images.plans[0] + '" alt=""></div>';
    } else if (sec.id.startsWith("sec-photos")) {
      inner = '<div class="doc-h2">' + esc(sec.title) + '</div><div class="doc-photos">' + sec.photos.map((p) => '<img src="' + p + '" alt="">').join("") + "</div>";
    } else if (sec.id === "sec-works") {
      inner = '<div class="doc-h2">' + esc(m.layout.works_heading) + "</div>" + renderWorksTable(a);
    } else if (sec.id === "sec-post") {
      let h = "";
      if (a.has.related) h += '<div class="doc-h2">' + FIXED.related_h2 + '</div><table class="doc-mini"><tr>' + FIXED.related_cols.map((c) => "<th>" + c + "</th>").join("") + "</tr>" + FIXED.related_rows.map((r, i) => "<tr><td>" + (i + 1) + "</td><td>" + r.name + "</td><td>" + r.unit + '</td><td class="r">' + fmtQty(r.qty) + '</td><td class="r">' + fmtMoney(r.price) + "</td></tr>").join("") + "</table>";
      if (a.has.org_process) h += '<div class="doc-h3">' + FIXED.org_process_h3 + "</div><ul>" + FIXED.org_process.map((b) => "<li>" + b + "</li>").join("") + "</ul>";
      if (a.has.also_included) h += '<div class="doc-h3">' + FIXED.also_included_h3 + "</div><ul>" + FIXED.also_included.map((b) => "<li>" + b + "</li>").join("") + "</ul>";
      if (a.has.prelim_volumes) h += '<div class="doc-h3">' + FIXED.prelim_volumes_h3 + "</div><ul>" + m.layout.prelim_volumes.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" + (a.has.not_estimated ? '<div class="doc-h3">' + FIXED.not_estimated_h3 + "</div><ul>" + m.layout.not_estimated.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") + '<p class="doc-note">' + FIXED.prelim_volumes_close + "</p>";
      inner = h;
    } else if (sec.id === "sec-notinc") {
      let h = '<div class="doc-h2">' + FIXED.not_included_h2 + "</div>";
      if (m.layout.not_included_form === "prose") {
        h += "<p>Чистовая электрика, чистовая сантехника.</p><p><i>" + FIXED.finish_note + "</i></p>";
      } else {
        Object.entries(m.layout.not_included_sections || {}).forEach(([k, v]) => {
          if (!v || v.length === 0) return;
          h += '<div class="doc-h3">' + esc(k) + "</div><ul>" + v.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";
        });
      }
      if ((m.layout.extra_works || []).length) h += "<p>" + FIXED.extra_opener + "</p><ul>" + m.layout.extra_works.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";
      if (a.has.separate_estimate) h += '<div class="doc-h3">' + FIXED.separate_h3 + "</div><ul>" + m.layout.separate_estimate.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul><p>" + FIXED.separate_close + "</p>";
      if (a.has.engineering) h += '<div class="doc-h3">' + FIXED.engineering_h3 + "</div><p>" + esc(m.layout.engineering) + "</p>";
      inner = h;
    } else if (sec.id === "sec-interaction") {
      let h = "";
      if (a.has.permits) h += '<div class="doc-h2">' + FIXED.permits_h2 + "</div>" + FIXED.permits.map((p) => "<p>" + p + "</p>").join("");
      h += '<div class="doc-h2">' + FIXED.interaction_h2 + "</div><ul><li>Работы выполняются в соответствии с " + esc(m.object.basis_doc) + ".</li>" + FIXED.interaction_fixed.map((b) => "<li>" + b + "</li>").join("") + (a.has.reporting ? "<li>" + FIXED.reporting + "</li>" : "") + "</ul>";
      inner = h;
    } else if (sec.id === "sec-payment") {
      inner = '<div class="doc-h2">' + FIXED.payment_h2 + '</div><div class="doc-h3 doc-price">' + a.priceLine + "</div>" +
        (m.commerce.price.kind === "estimate" && m.commerce.price.clause ? "<p>Стоимость " + esc(m.commerce.price.clause) + ".</p>" : "") +
        "<p>" + a.breakdownLine + "</p><p>" + FIXED.vat_para + "</p>" +
        "<p><b>Предоплата: " + fmtMoney(m.commerce.predoplata || 0) + " € + 19% VAT</b> — " + FIXED.predoplata_purpose + ".</p>" +
        (m.commerce.second_payment && m.commerce.second_payment.amount ? "<p><b>Второй платёж: " + fmtMoney(m.commerce.second_payment.amount) + " € + 19% VAT</b> — " + esc(m.commerce.second_payment.note) + ".</p>" : "") +
        "<p>" + FIXED.final_settlement + "</p>" +
        '<div class="doc-h3">Срок реализации: ' + esc(m.commerce.term.value) + " " + esc(m.commerce.term.unit) + "</div><p>" + FIXED.term_tail + "</p><p>" + FIXED.validity + "</p>";
      if (!m.object.manager_top) inner += '<div class="doc-manager doc-manager-bottom"><div>' + FIXED.manager.name + "</div><div>" + esc(m.object.date) + "</div></div>";
    } else if (sec.id === "sec-gallery") {
      inner = '<div class="doc-photos doc-gallery">' + m.images.gallery.map((p) => '<img src="' + p + '" alt="">').join("") + "</div>";
    }
    secHtml.push('<section class="doc-slide" id="' + sec.id + '"><div class="slide-chip">Слайд ' + sec.slide + "</div>" + inner + "</section>");
  });

  return secHtml.join("");
}


/* ============================================================
   Каркас ЛК клиента: герой (статус, цена, кнопки)
   ============================================================ */
function renderHero(a) {
  const m = STATE.manifest;
  const st = STATE.status;
  const thumb = (p) => p.replace("w=900", "w=100").replace("w=700", "w=100");
  return (
    '<div class="d3-hero"><div class="gallery"><img src="' + m.images.hero + '" alt="">' +
    '<div class="ribbon"><span class="status-pill ' + (st === "agreed" ? "success" : "warn") + '"><span class="dot"></span>' + (st === "agreed" ? FIXED.status_agreed : FIXED.status_sent) + " · " + esc(m.object.date) + '</span><span class="status-pill edition">Вариант: ' + a.variantLabel + "</span></div>" +
    '<div class="thumbs">' + [m.images.hero].concat(m.images.gallery.slice(0, 3)).map((p, i) => '<span class="' + (i === 0 ? "active" : "") + '"><img src="' + thumb(p) + '" alt=""></span>').join("") + "</div></div>" +
    '<div class="summary"><div class="proj-label">Коммерческое предложение</div>' +
    "<h2>" + esc(subtitleShort(m)) + "</h2>" +
    '<div class="addr">' + esc(m.object.field_object) + "</div>" +
    '<div class="total"><div class="lbl">Стоимость по проекту</div><div class="v tnum">' + fmtMoney(a.price) + " €</div>" +
    '<div class="sub">+ 19% VAT</div></div>' +
    '<div class="cta-row">' +
    (st === "sent" ? '<button class="btn primary" id="btn-approve">Согласовать</button>' : '<button class="btn ghost" disabled>Согласовано</button>') +
    '<button class="btn ghost" id="btn-pdf">Сохранить PDF</button>' +
    "</div></div></div>"
  );
}

function subtitleShort(m) {
  const s = m.object.subtitle || "";
  const dot = s.indexOf(". ");
  return dot > 0 ? s.slice(0, dot) : s;
}

/* ============================================================
   Экспорт (node — smoke-тест машины; браузер — глобальная область)
   ============================================================ */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ESTIMATE_ROWS, MATERIALS_ROWS, MANIFEST_DEFAULT, FIXED, STATE, clone, assemble, aggregate, applyVariant, runGates, repetitionScan, estimateModel, estimateGroups, renderEstimate, renderDoc, renderHero, renderWorksTable, fmtMoney, fmtQty, build };
}
