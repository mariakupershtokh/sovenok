import "./style.css";
import { validateDimensions, validateRatio, MAX_SIDE, PATTERNS, getFinishCells } from "../solver.js";

const $ = (id) => document.getElementById(id);
const ratioInputs = { H: $("ratio-h"), D: $("ratio-d"), V: $("ratio-v") };
const columnsInput = $("columns");
const rowsInput = $("rows");
const timeline = $("timeline");
const colors = { H: "#c17a48", V: "#3d7766", D: "#6a85b4" };
let columns = 3;
let rows = 5;
let ratio = null;
let boards = [];
let axisValues = { columns: [], rows: [] };
let solution = null;
let worker = null;
let step = 0;
let timer = null;
let busy = false;
let finish = null;
let finishChoices = null;
let choosingFinish = false;

const moveType = (a, b) => (a.x === b.x ? "V" : a.y === b.y ? "H" : "D");
const escapeAttribute = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const playIcon =
  '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m6 3 11 7-11 7Z" fill="currentColor"/></svg>';
const pauseIcon =
  '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 3h4v14H5zm7 0h4v14h-4z" fill="currentColor"/></svg>';

function setValidation(message, error = false) {
  $("validation").textContent = message;
  $("validation").classList.toggle("error", error);
}

function syncSizeControls() {
  columnsInput.value = columns;
  rowsInput.value = rows;
  for (const axis of ["columns", "rows"]) {
    const other = axis === "columns" ? "rows" : "columns";
    const current = axis === "columns" ? columns : rows;
    const fixed = axis === "columns" ? rows : columns;
    const values = [
      ...new Set(
        boards
          .filter((board) => board[other] === fixed)
          .map((board) => board[axis]),
      ),
    ].sort((a, b) => a - b);
    axisValues[axis] = values;
    const range = $(axis + "-range");
    range.max = Math.max(0, values.length - 1);
    range.value = values.indexOf(current);
    range.disabled = values.length < 2;
    range.setAttribute("aria-valuetext", String(current));
    range.setAttribute(
      "aria-label",
      (axis === "columns" ? "Столбцы: " : "Строки: ") +
        current +
        ". Допустимые значения: " +
        values.join(", "),
    );
    $(axis + "-help").textContent = "Доступны: " + values.join(", ");
    $(axis).setAttribute("aria-invalid", "false");
  }
  const validation = validateDimensions(columns, rows, ratio, finish ?? undefined);
  for (const kind of ["H", "D", "V"])
    $("quota-" + kind.toLowerCase()).textContent = validation.quota[kind];
  $("quota-total").textContent = validation.moves;
  $("multiplier").textContent =
    "x = " + validation.multiplier + "; H + D + V = " + validation.moves;
  document
    .querySelectorAll("[data-size]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.size === columns + "," + rows,
      ),
    );
}

function selectBoard(board) {
  if (!board) return;
  hideFinishTooltip();
  columns = board.columns;
  rows = board.rows;
  finish = { x: columns - 1, y: rows - 1 };
  finishChoices = null;
  choosingFinish = false;
  $("finish-prompt").hidden = true;
  syncSizeControls();
  setValidation(
    "Размер " +
      columns +
      " × " +
      rows +
      ": есть проверенный обход. Стороны 1–" +
      MAX_SIDE +
      ".",
  );
  buildRoute();
}

function chooseManualSize(axis) {
  const value = $(axis).valueAsNumber;
  const board = boards.find((item) => item[axis] === value);
  if (!board) {
    $(axis).setAttribute("aria-invalid", "true");
    $("build").disabled = true;
    setValidation(
      "Для значения " +
        ($(axis).value || "—") +
        " нет найденной пары в пределах " +
        MAX_SIDE +
        " × " +
        MAX_SIDE +
        ". Выберите значение из списка под бегунком.",
      true,
    );
    return;
  }
  selectBoard(board);
}

function calculate(message, onResult) {
  worker?.terminate();
  const activeWorker = new Worker(
    new URL("./solver.worker.js", import.meta.url),
    { type: "module" },
  );
  worker = activeWorker;
  busy = true;
  updateControls();
  const finish = (data) => {
    if (worker !== activeWorker) return;
    activeWorker.terminate();
    worker = null;
    busy = false;
    onResult(data);
    updateControls();
  };
  activeWorker.onmessage = (event) => finish(event.data);
  activeWorker.onerror = () =>
    finish({
      status: "error",
      message:
        "Не удалось выполнить расчёт. Измените параметры и попробуйте снова.",
    });
  activeWorker.postMessage(message);
}

function updateRatio() {
  hideFinishTooltip();
  stopPlayback();
  worker?.terminate();
  worker = null;
  busy = false;
  solution = null;
  boards = [];
  finish = null;
  finishChoices = null;
  choosingFinish = false;
  $("finish-prompt").hidden = true;
  $("board-panel").hidden = true;
  $("board-empty").hidden = false;
  $("quota-panel").hidden = true;
  const next = Object.fromEntries(
    Object.entries(ratioInputs).map(([kind, input]) => [
      kind,
      input.valueAsNumber,
    ]),
  );
  const checked = validateRatio(next);
  ratio = checked.valid ? next : null;
  for (const [kind, input] of Object.entries(ratioInputs)) {
    $("display-" + kind.toLowerCase()).textContent =
      Number.isSafeInteger(next[kind]) && next[kind] >= 0 ? next[kind] : "—";
    input.setAttribute(
      "aria-invalid",
      String(
        input.value !== "" &&
          (!Number.isSafeInteger(next[kind]) || next[kind] < 0),
      ),
    );
  }
  $("empty-title").textContent = "Сначала задайте соотношение";
  $("empty-description").textContent =
    "Три неотрицательных целых коэффициента; хотя бы один больше нуля.";
  if (!ratio) {
    const complete = Object.values(ratioInputs).every(
      (input) => input.value !== "",
    );
    setValidation(
      complete ? checked.message : "Заполните три поля или выберите пример.",
      complete,
    );
    $("ratio-sum").textContent = "Sx";
    updateControls();
    return;
  }
  $("ratio-sum").textContent = checked.sum + "x";
  $("empty-title").textContent = "Подбираем минимальную доску";
  $("empty-description").textContent =
    "Проверяем арифметику и строим обходы из разрешённых блоков.";
  setValidation("Подбираем размеры…");
  calculate({ type: "choices", ratio }, (data) => {
    if (data.status === "error") {
      setValidation(data.message, true);
      $("empty-title").textContent = "Ошибка расчёта";
      return;
    }
    boards = data.boards;
    if (!boards.length) {
      setValidation(
        "В пределах " +
          MAX_SIDE +
          " × " +
          MAX_SIDE +
          " подходящий обход не найден.",
        true,
      );
      $("empty-title").textContent = "Подходящий размер не найден";
      $("empty-description").textContent = data.unresolved
        ? "Некоторые размеры проходят необходимые условия, но разрешённые блоки пока не дали маршрута."
        : `В пределах ${MAX_SIDE} × ${MAX_SIDE} нет размеров, проходящих необходимые условия. Измените соотношение.`;
      return;
    }
    $("board-empty").hidden = true;
    $("board-panel").hidden = false;
    $("quota-panel").hidden = false;
    $("examples-title").textContent = "Проверенные размеры · " + boards.length;
    $("presets").innerHTML = boards
      .map(
        (board) =>
          '<button type="button" data-size="' +
          board.columns +
          "," +
          board.rows +
          '">' +
          board.columns +
          " × " +
          board.rows +
          "</button>",
      )
      .join("");
    selectBoard(boards[0]);
    const minimum = boards[0];
    setValidation(
      "Минимальный найденный: " +
        minimum.columns +
        " × " +
        minimum.rows +
        ". При равной площади выбираем меньшую сторону.",
    );
    if (data.unresolved)
      setValidation(
        $("validation").textContent +
          " Ещё " +
          data.unresolved +
          " размеров прошли арифметику, но обход для них не найден.",
      );
  });
}

function stopPlayback() {
  clearInterval(timer);
  timer = null;
  $("play").innerHTML = playIcon;
  $("play").setAttribute("aria-label", "Воспроизвести маршрут");
  $("play").title = "Воспроизвести";
}

function updateControls() {
  $("build").disabled =
    busy || choosingFinish ||
    !ratio ||
    !boards.some(
      (board) =>
        board.columns === columnsInput.valueAsNumber &&
        board.rows === rowsInput.valueAsNumber,
    );
  $("choose-finish").disabled = !solution || (busy && !choosingFinish);
  $("choose-finish").setAttribute("aria-pressed", String(choosingFinish));
  const disabled = !solution || busy || choosingFinish;
  for (const id of ["rewind", "play", "next", "timeline", "show-all"])
    $(id).disabled = disabled;
  if (!disabled) {
    $("next").disabled = step === solution.path.length - 1;
    $("rewind").disabled = step === 0;
    $("play").disabled = solution.path.length === 1;
  }
}

function showMessage(title, description) {
  $("board-message").hidden = false;
  $("message-title").textContent = title;
  $("message-description").textContent = description;
}

function drawBoard() {
  hideFinishTooltip();
  const path = choosingFinish ? [] : solution?.path ?? [];
  const target = finish ?? { x: columns - 1, y: rows - 1 };
  const order = new Map(
    path.map((cell, index) => [`${cell.x},${cell.y}`, index + 1]),
  );
  let cells = "";
  let labels = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const screenY = rows - 1 - y;
      cells += `<rect x="${x}" y="${screenY}" width="1" height="1" class="${(x + y) % 2 ? "cell-dark" : "cell-light"}"/>`;
      const number = order.get(`${x},${y}`);
      if (number)
        labels += `<text x="${x + 0.79}" y="${screenY + 0.83}" text-anchor="end" class="cell-number" data-order="${number}">${number}</text>`;
    }
  }
  const edges = path
    .slice(1)
    .map((point, index) => {
      const previous = path[index];
      const type = moveType(previous, point);
      return `<line class="route-edge route-${type.toLowerCase()}" data-edge="${index + 1}" x1="${previous.x + 0.5}" y1="${rows - previous.y - 0.5}" x2="${point.x + 0.5}" y2="${rows - point.y - 0.5}"/>`;
    })
    .join("");
  const dots = path
    .slice(1, -1)
    .map(
      (point, index) =>
        `<circle class="route-node" data-node="${index + 1}" cx="${point.x + 0.5}" cy="${rows - point.y - 0.5}" r=".065"/>`,
    )
    .join("");
  const xAxis = Array.from(
    { length: columns },
    (_, x) =>
      `<text class="axis-label" x="${x + 0.5}" y="${rows + 0.37}" text-anchor="middle">${x + 1}</text>`,
  ).join("");
  const yAxis = Array.from(
    { length: rows },
    (_, y) =>
      `<text class="axis-label" x="-.24" y="${rows - y - 0.44}" text-anchor="end">${y + 1}</text>`,
  ).join("");
  const targets = choosingFinish && finishChoices?.finishes ? getFinishCells(columns, rows, ratio, finishChoices.finishes).map((p) =>
    `<rect class="${p.available ? "finish-option" : "finish-blocked"}" ${p.available ? "data-finish" : "data-finish-blocked"}="${p.x},${p.y}" data-reason="${escapeAttribute(p.reason)}" x="${p.x + .1}" y="${rows - 1 - p.y + .1}" width=".8" height=".8" rx=".12" tabindex="0" role="button"${p.available ? "" : ' aria-disabled="true"'} aria-label="Финиш: столбец ${p.x + 1}, строка ${p.y + 1}. ${escapeAttribute(p.reason)}"/>`,
  ).join("") : "";
  $("board-wrap").innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-.65 -.25 ${columns + 1} ${rows + 0.9}" class="board-svg ${$("show-numbers").checked ? "" : "hide-numbers"}" role="${choosingFinish ? "group" : "img"}" aria-label="Шахматная доска: ${columns} столбцов, ${rows} строк. Старт снизу слева. Финиш: столбец ${target.x + 1}, строка ${target.y + 1}."><title>Маршрут по клеткам доски ${columns} × ${rows}</title>${cells}<rect x="0" y="0" width="${columns}" height="${rows}" class="grid-frame"/>${edges}${dots}${labels}${targets}<circle cx=".5" cy="${rows - 0.5}" r=".23" class="endpoint"/><text x=".5" y="${rows - 0.5}" class="endpoint-label">С</text>${!choosingFinish ? `<circle cx="${target.x + 0.5}" cy="${rows - target.y - 0.5}" r=".23" class="endpoint finish"/><text x="${target.x + 0.5}" y="${rows - target.y - 0.5}" class="endpoint-label">Ф</text>` : ""}<circle id="current-node" r=".13" class="current-node" hidden/>${xAxis}${yAxis}</svg>`;
  $("board-title").textContent = `Доска ${columns} × ${rows}`;
  $("board-subtitle").textContent =
    `${columns * rows} клеток · ${columns * rows - 1} переходов · финиш (${target.x + 1}, ${target.y + 1})${solution?.transposed ? " · транспонировано" : ""}`;
}

function showSolution(data) {
  solution = data;
  finish = data.path.at(-1);
  $("board-message").hidden = true;
  $("route-status").classList.remove("error");
  $("route-status").textContent = "Маршрут проверен · " + columns * rows + " клеток без повторов";
  drawBoard();
  setStep(data.path.length - 1);
}

function hideFinishTooltip() {
  $("finish-tooltip").hidden = true;
}

function showFinishTooltip(event) {
  const cell = event.target.closest("[data-finish-blocked]");
  if (!choosingFinish || !cell) { hideFinishTooltip(); return; }
  const tooltip = $("finish-tooltip");
  tooltip.textContent = cell.dataset.reason;
  tooltip.hidden = false;
  const anchor = cell.getBoundingClientRect(), bounds = tooltip.getBoundingClientRect();
  tooltip.style.left = Math.max(12, Math.min(innerWidth - bounds.width - 12,
    anchor.left + anchor.width / 2 - bounds.width / 2)) + "px";
  const top = anchor.top - bounds.height - 10;
  tooltip.style.top = Math.max(8, Math.min(innerHeight - bounds.height - 8,
    top >= 8 ? top : anchor.bottom + 10)) + "px";
}

function chooseFinish() {
  stopPlayback();
  choosingFinish = !choosingFinish;
  $("finish-prompt").hidden = !choosingFinish;
  if (!choosingFinish) {
    worker?.terminate(); worker = null; busy = false;
    drawBoard(); setStep(step); updateControls();
    return;
  }
  const showChoices = (data) => {
    finishChoices = data;
    $("finish-help").textContent = data.status === "error" ? data.message :
      `Нажмите на зелёную клетку. Проверенных финишей: ${data.finishes.length}. Наведите на красную клетку, чтобы узнать причину.`;
    drawBoard(); updateControls();
  };
  $("finish-help").textContent = "Подбираем маршруты до клеток на границе…";
  drawBoard(); updateControls();
  if (finishChoices) showChoices(finishChoices);
  else calculate({ type: "finishes", columns, rows, ratio }, showChoices);
}

function selectFinish(event) {
  if (event.type === "keydown" && event.key === "Escape") { hideFinishTooltip(); return; }
  if (event.target.closest("[data-finish-blocked]")) {
    if (event.type !== "keydown" || ["Enter", " "].includes(event.key)) {
      event.preventDefault(); showFinishTooltip(event);
    }
    return;
  }
  const cell = event.target.closest("[data-finish]");
  if (!choosingFinish || !cell || !finishChoices?.finishes) return;
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  const data = finishChoices.finishes.find(({ finish: p }) => `${p.x},${p.y}` === cell.dataset.finish);
  if (!data) return;
  choosingFinish = false;
  $("finish-prompt").hidden = true;
  finish = { x: data.finish.x, y: data.finish.y };
  buildRoute();
  $("choose-finish").focus();
}

function setStep(value) {
  if (!solution) return;
  step = Math.max(0, Math.min(solution.path.length - 1, Number(value)));
  timeline.value = step;
  timeline.style.setProperty(
    "--progress",
    `${solution.path.length > 1 ? (step / (solution.path.length - 1)) * 100 : 100}%`,
  );
  $("step-value").textContent = step;
  $("visited-count").textContent =
    `Посещено ${step + 1} из ${columns * rows} клеток`;
  document.querySelectorAll("[data-edge]").forEach((edge) => {
    edge.style.display = Number(edge.dataset.edge) <= step ? "" : "none";
  });
  document.querySelectorAll("[data-node]").forEach((node) => {
    node.style.display = Number(node.dataset.node) <= step ? "" : "none";
  });
  document.querySelectorAll("[data-order]").forEach((label) => {
    label.style.opacity = Number(label.dataset.order) <= step + 1 ? "1" : ".25";
  });
  const point = solution.path[step];
  const marker = $("current-node");
  marker.setAttribute("cx", point.x + 0.5);
  marker.setAttribute("cy", rows - point.y - 0.5);
  marker.style.display =
    step > 0 && step < solution.path.length - 1 ? "" : "none";
  marker.removeAttribute("hidden");
  const counts = { H: 0, V: 0, D: 0 };
  for (let i = 1; i <= step; i++)
    counts[moveType(solution.path[i - 1], solution.path[i])]++;
  for (const type of ["H", "V", "D"])
    $("used-" + type.toLowerCase()).textContent =
      `${counts[type]}/${solution.quota[type]}`;
  if (step === solution.path.length - 1) stopPlayback();
  updateControls();
}

function startPlayback() {
  if (!solution || solution.path.length < 2) return;
  if (timer) {
    stopPlayback();
    return;
  }
  if (step === solution.path.length - 1) setStep(0);
  $("play").innerHTML = pauseIcon;
  $("play").setAttribute("aria-label", "Приостановить маршрут");
  $("play").title = "Приостановить";
  timer = setInterval(() => setStep(step + 1), Number($("speed").value));
}

function buildRoute() {
  if (!ratio || !validateDimensions(columns, rows, ratio, finish ?? undefined).valid) return;
  stopPlayback();
  solution = null;
  step = 0;
  $("build").querySelector("span").textContent = "Подбираем маршрут…";
  $("route-status").textContent = "Собираем разрешённые блоки…";
  $("route-status").classList.remove("error");
  $("step-total").textContent = columns * rows - 1;
  $("step-value").textContent = "0";
  $("visited-count").textContent = "Проверяем клетки и квоты";
  timeline.max = columns * rows - 1;
  timeline.value = "0";
  timeline.style.setProperty("--progress", "0%");
  for (const kind of ["h", "v", "d"]) $("used-" + kind).textContent = "—";
  drawBoard();
  showMessage(
    "Строим непрерывный путь",
    "Проверяем все клетки и точное соотношение ходов.",
  );
  calculate({ type: "solve", columns, rows, ratio, finish }, (data) => {
    $("build").querySelector("span").textContent = "Построить маршрут";
    if (data.status === "solved") {
      showSolution(data);
    } else {
      showMessage(
        data.status === "error" ? "Ошибка расчёта" : "Маршрут пока не найден",
        data.message,
      );
      $("route-status").textContent = "Построение не завершилось решением";
      $("route-status").classList.add("error");
    }
  });
}

const patterns = [
  {
    name: "HVHV",
    subtitle: "Подъём с горизонталями",
    points: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 2],
    ],
    width: 2,
    height: 3,
  },
  {
    name: "HDHD",
    subtitle: "Подъём по диагонали",
    points: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
    ],
    width: 2,
    height: 3,
  },
  {
    name: "VDVD",
    subtitle: "Экономим горизонтали",
    points: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 2],
    ],
    width: 2,
    height: 3,
  },
  {
    name: "HH",
    subtitle: "Переход в новую полосу",
    points: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    width: 3,
    height: 1,
  },
  {
    name: "DDVVHVVDDH",
    subtitle: "Шнуровка и возврат",
    points: [
      [0, 0],
      [1, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 4],
      [1, 3],
      [1, 2],
      [0, 1],
      [1, 0],
      [2, 0],
    ],
    width: 3,
    height: 5,
  },
  {
    name: "VV",
    subtitle: "Завершающий проход",
    points: [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
    width: 1,
    height: 3,
  },
];
patterns.push(
  {
    name: "VDVH",
    subtitle: "Выход из чётного блока",
    points: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    width: 3,
    height: 2,
  },
  {
    name: "HDHH",
    subtitle: "Выход с горизонталями",
    points: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    width: 3,
    height: 2,
  },
);
const verticalLace = patterns.find((pattern) => pattern.name === "DDVVHVVDDH");
patterns.push({
  name: "DDHHVHHDDV",
  subtitle: "Горизонтальная шнуровка",
  points: verticalLace.points.map(([x, y]) => [y, x]),
  width: verticalLace.height,
  height: verticalLace.width,
});
for (const name of ["VHVH", "VHVV", "VHVD", "DHDH", "DHDV"]) {
  const variants = name === "VHVD" ? [PATTERNS[name], [...PATTERNS[name].slice(0, 3), [1, 1]]] : [PATTERNS[name]];
  for (const [i, deltas] of variants.entries()) {
    const points = [[0, 0]];
    for (const [dx, dy] of deltas) {
      const [x, y] = points.at(-1); points.push([x + dx, y + dy]);
    }
    const minX = Math.min(...points.map(([x]) => x)), minY = Math.min(...points.map(([, y]) => y));
    const width = Math.max(...points.map(([x]) => x)) - minX + 1;
    const height = Math.max(...points.map(([, y]) => y)) - minY + 1;
    patterns.push({ name: name + (name === "VHVD" ? (i ? " ↑" : " ↓") : ""), subtitle: "Блок 2×2 с выходом", points: points.map(([x, y]) => [x - minX, y - minY]), width, height });
  }
}
$("pattern-grid").innerHTML = patterns
  .map((pattern, index) => {
    const scale = Math.min(20, 56 / pattern.height, 100 / pattern.width);
    const offsetX = (110 - pattern.width * scale) / 2;
    const offsetY = (63 - pattern.height * scale) / 2;
    const position = ([x, y]) => [
      offsetX + (x + 0.5) * scale,
      offsetY + (pattern.height - y - 0.5) * scale,
    ];
    let grid = "";
    for (let y = 0; y < pattern.height; y++)
      for (let x = 0; x < pattern.width; x++)
        grid += `<rect x="${offsetX + x * scale}" y="${offsetY + y * scale}" width="${scale}" height="${scale}" fill="${(x + y) % 2 ? "#e0e6d4" : "#fafbf5"}"/>`;
    const lines = pattern.points
      .slice(1)
      .map((point, i) => {
        const a = position(pattern.points[i]),
          b = position(point);
        const kind = moveType(
          { x: pattern.points[i][0], y: pattern.points[i][1] },
          { x: point[0], y: point[1] },
        );
        return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${colors[kind]}" stroke-width="1.5" stroke-linecap="round"/>`;
      })
      .join("");
    const start = position(pattern.points[0]);
    const end = position(pattern.points.at(-1));
    return `<article class="pattern-card"><div class="pattern-art"><svg viewBox="0 0 110 63" aria-hidden="true">${grid}${lines}<circle cx="${start[0]}" cy="${start[1]}" r="2.2" fill="#28574a"/><circle cx="${end[0]}" cy="${end[1]}" r="2" fill="#fcfcf8" stroke="#8b9b7b" stroke-width="1"/></svg></div><div class="pattern-description"><h3>${pattern.name}<span>${String(index + 1).padStart(2, "0")}</span></h3><p>${pattern.subtitle}</p></div></article>`;
  })
  .join("");

// Show exact progress alongside the three move colors.
for (const type of ["h", "v", "d"]) {
  const label = document.querySelector(`.legend .${type}-bg`).parentElement;
  label.insertAdjacentHTML("beforeend", ` <span id="used-${type}">—</span>`);
}

$("ratio-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateRatio();
});
for (const input of Object.values(ratioInputs))
  input.addEventListener("input", updateRatio);
for (const button of document.querySelectorAll("[data-ratio]"))
  button.addEventListener("click", () => {
    const values = button.dataset.ratio.split(",");
    ["H", "D", "V"].forEach((kind, index) => {
      ratioInputs[kind].value = values[index];
    });
    updateRatio();
  });
for (const axis of ["columns", "rows"]) {
  $(axis).addEventListener("input", () => chooseManualSize(axis));
  $(axis + "-range").addEventListener("input", () => {
    const value = axisValues[axis][Number($(axis + "-range").value)];
    const other = axis === "columns" ? "rows" : "columns";
    selectBoard(
      boards.find(
        (board) =>
          board[axis] === value &&
          board[other] === (other === "rows" ? rows : columns),
      ),
    );
  });
}
$("presets").addEventListener("click", (event) => {
  const button = event.target.closest("[data-size]");
  if (!button) return;
  const [m, n] = button.dataset.size.split(",").map(Number);
  selectBoard(boards.find((board) => board.columns === m && board.rows === n));
});
$("build").addEventListener("click", buildRoute);
$("choose-finish").addEventListener("click", chooseFinish);
$("board-wrap").addEventListener("click", selectFinish);
$("board-wrap").addEventListener("keydown", selectFinish);
$("board-wrap").addEventListener("pointerover", showFinishTooltip);
$("board-wrap").addEventListener("pointerleave", hideFinishTooltip);
$("board-wrap").addEventListener("focusin", showFinishTooltip);
$("board-wrap").addEventListener("focusout", hideFinishTooltip);
window.addEventListener("resize", hideFinishTooltip);
document.addEventListener("scroll", hideFinishTooltip, true);
$("show-numbers").addEventListener("change", () =>
  document
    .querySelector(".board-svg")
    ?.classList.toggle("hide-numbers", !$("show-numbers").checked),
);
$("play").addEventListener("click", startPlayback);
$("rewind").addEventListener("click", () => {
  stopPlayback();
  setStep(0);
});
$("next").addEventListener("click", () => {
  stopPlayback();
  setStep(step + 1);
});
$("show-all").addEventListener("click", () => {
  stopPlayback();
  setStep(solution.path.length - 1);
});
timeline.addEventListener("input", () => {
  stopPlayback();
  setStep(timeline.value);
});
$("speed").addEventListener("change", () => {
  if (timer) {
    stopPlayback();
    startPlayback();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPlayback();
});
updateRatio();
