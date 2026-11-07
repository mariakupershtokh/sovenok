import "./style.css";
import { validateDimensions, validateRatio, MAX_SIDE, PATTERNS } from "../solver.js";

const $ = (id) => document.getElementById(id);
const ratioInputs = { H: $("ratio-h"), D: $("ratio-d"), V: $("ratio-v") };
const columnsInput = $("columns");
const rowsInput = $("rows");
const timeline = $("timeline");
const colors = { H: "#c17a48", V: "#3d7766", D: "#6a85b4" };
let columns = 3;
let rows = 5;
let ratio = null;
let solution = null;
let worker = null;
let step = 0;
let timer = null;
let busy = false;
let checkTimer = null;
let suggestWorker = null;
let suggestionKey = "";
let ratioSuggestWorker = null;
let ratioSuggestionKey = "";
let routeEnumWorker = null;
let routeEnumKey = "";
let routeNav = null;

const moveType = (a, b) => (a.x === b.x ? "V" : a.y === b.y ? "H" : "D");
const playIcon =
  '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m6 3 11 7-11 7Z" fill="currentColor"/></svg>';
const pauseIcon =
  '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 3h4v14H5zm7 0h4v14h-4z" fill="currentColor"/></svg>';
const verdictIcons = {
  idle: "?",
  checking: "…",
  yes: "✓",
  no: "×",
  unknown: "?",
  error: "!",
};

function setVerdict(state, title, text) {
  $("verdict").dataset.state = state;
  $("verdict-icon").textContent = verdictIcons[state] ?? "?";
  $("verdict-title").textContent = title;
  $("verdict-text").textContent = text;
}

function hideSuggestions() {
  $("suggestions").hidden = true;
  $("suggestions-list").innerHTML = "";
  $("suggestions-hint").hidden = false;
}

function showSuggestions(boards) {
  const list = $("suggestions-list");
  $("suggestions").hidden = false;
  list.innerHTML = "";
  if (!boards.length) {
    list.innerHTML =
      '<span class="suggestions-empty">Пока не удалось подобрать проходимую доску для этого соотношения.</span>';
    $("suggestions-hint").hidden = true;
    return;
  }
  $("suggestions-hint").hidden = false;
  for (const board of boards) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${board.columns} × ${board.rows}`;
    button.title = `${board.columns * board.rows} клеток`;
    button.addEventListener("click", () => {
      columnsInput.value = board.columns;
      rowsInput.value = board.rows;
      check();
    });
    list.append(button);
  }
}

function hideRatioSuggestions() {
  $("ratio-suggestions").hidden = true;
  $("ratio-suggestions-list").innerHTML = "";
  $("ratio-suggestions-hint").hidden = false;
}

function clearRatioSuggestions() {
  ratioSuggestWorker?.terminate();
  ratioSuggestWorker = null;
  ratioSuggestionKey = "";
  hideRatioSuggestions();
}

function showRatioSuggestions(ratios) {
  const list = $("ratio-suggestions-list");
  $("ratio-suggestions").hidden = false;
  list.innerHTML = "";
  if (!ratios.length) {
    list.innerHTML =
      '<span class="suggestions-empty">Пока не удалось подобрать соотношение для этой доски.</span>';
    $("ratio-suggestions-hint").hidden = true;
    return;
  }
  $("ratio-suggestions-hint").hidden = false;
  for (const next of ratios) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${next.H} : ${next.D} : ${next.V}`;
    button.title = "Подставить это соотношение ходов";
    button.addEventListener("click", () => {
      for (const kind of ["H", "D", "V"])
        ratioInputs[kind].value = next[kind];
      check();
    });
    list.append(button);
  }
}

// Board -> ratio suggestions depend only on the entered size.
function requestRatioSuggestions() {
  const nextColumns = columnsInput.valueAsNumber;
  const nextRows = rowsInput.valueAsNumber;
  if (
    !Number.isInteger(nextColumns) ||
    !Number.isInteger(nextRows) ||
    nextColumns < 1 ||
    nextRows < 1 ||
    nextColumns > MAX_SIDE ||
    nextRows > MAX_SIDE
  ) {
    clearRatioSuggestions();
    return;
  }
  const key = `${nextColumns}x${nextRows}`;
  if (key === ratioSuggestionKey) return;
  ratioSuggestionKey = key;
  hideRatioSuggestions();
  ratioSuggestWorker?.terminate();
  const activeWorker = new Worker(
    new URL("./solver.worker.js", import.meta.url),
    { type: "module" },
  );
  ratioSuggestWorker = activeWorker;
  const settle = () => {
    if (ratioSuggestWorker !== activeWorker) return false;
    activeWorker.terminate();
    ratioSuggestWorker = null;
    return true;
  };
  activeWorker.onmessage = ({ data }) => {
    if (!settle()) return;
    if (data.valid === false) {
      ratioSuggestionKey = "";
      hideRatioSuggestions();
      return;
    }
    showRatioSuggestions(data.ratios ?? []);
  };
  activeWorker.onerror = () => {
    if (!settle()) return;
    ratioSuggestionKey = "";
    hideRatioSuggestions();
  };
  activeWorker.postMessage({
    type: "ratio-suggest",
    columns: nextColumns,
    rows: nextRows,
    limit: 4,
  });
}

// Suggestions only depend on the ratio, so an already requested set is reused
// while the user changes the size.
function requestSuggestions() {
  const next = readRatio();
  if (!validateRatio(next).valid) {
    suggestWorker?.terminate();
    suggestWorker = null;
    suggestionKey = "";
    hideSuggestions();
    return;
  }
  const key = `${next.H}:${next.D}:${next.V}`;
  if (key === suggestionKey) return;
  suggestionKey = key;
  suggestWorker?.terminate();
  const activeWorker = new Worker(
    new URL("./solver.worker.js", import.meta.url),
    { type: "module" },
  );
  suggestWorker = activeWorker;
  const settle = () => {
    if (suggestWorker !== activeWorker) return false;
    activeWorker.terminate();
    suggestWorker = null;
    return true;
  };
  activeWorker.onmessage = ({ data }) => {
    if (!settle()) return;
    if (data.valid === false) {
      suggestionKey = "";
      hideSuggestions();
      return;
    }
    showSuggestions(data.boards ?? []);
  };
  activeWorker.onerror = () => {
    if (!settle()) return;
    suggestionKey = "";
    hideSuggestions();
  };
  activeWorker.postMessage({ type: "suggest", ratio: next, limit: 4 });
}

const readRatio = () =>
  Object.fromEntries(
    Object.entries(ratioInputs).map(([kind, input]) => [
      kind,
      input.valueAsNumber,
    ]),
  );

function renderRatio(next, checked) {
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
  $("ratio-sum").textContent = checked.valid ? checked.sum + "x" : "Sx";
}

// The quota is known as soon as the number of cells is divisible by the ratio
// sum, even when the border parity rules reject the board.
function renderQuota(validation) {
  if (!validation.quota) {
    $("quota-panel").hidden = true;
    return;
  }
  $("quota-panel").hidden = false;
  for (const kind of ["H", "D", "V"])
    $("quota-" + kind.toLowerCase()).textContent = validation.quota[kind];
  $("quota-total").textContent = validation.moves;
  $("multiplier").textContent =
    "x = " + validation.multiplier + "; H + D + V = " + validation.moves;
}

function stopPlayback() {
  clearInterval(timer);
  timer = null;
  $("play").innerHTML = playIcon;
  $("play").setAttribute("aria-label", "Воспроизвести маршрут");
  $("play").title = "Воспроизвести";
}

function updateControls() {
  $("check").disabled = busy;
  const disabled = !solution || busy;
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
  const path = solution?.path ?? [];
  timeline.max = Math.max(0, path.length - 1);
  $("step-total").textContent = Math.max(0, path.length - 1);
  const target = { x: columns - 1, y: rows - 1 };
  const finishLabel = `финиш (${columns}, ${rows})`;
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
  $("board-wrap").innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-.65 -.25 ${columns + 1} ${rows + 0.9}" class="board-svg ${$("show-numbers").checked ? "" : "hide-numbers"}" role="img" aria-label="Шахматная доска: ${columns} столбцов, ${rows} строк. Старт снизу слева, ${finishLabel}."><title>Маршрут по клеткам доски ${columns} × ${rows}</title>${cells}<rect x="0" y="0" width="${columns}" height="${rows}" class="grid-frame"/>${edges}${dots}${labels}<circle cx=".5" cy="${rows - 0.5}" r=".23" class="endpoint"/><text x=".5" y="${rows - 0.5}" class="endpoint-label">С</text><circle cx="${target.x + 0.5}" cy="${rows - target.y - 0.5}" r=".23" class="endpoint finish"/><text x="${target.x + 0.5}" y="${rows - target.y - 0.5}" class="endpoint-label">Ф</text><circle id="current-node" r=".13" class="current-node" hidden/>${xAxis}${yAxis}</svg>`;
  $("board-title").textContent = `Доска ${columns} × ${rows}`;
  $("board-subtitle").textContent =
    `${columns * rows} клеток · ${columns * rows - 1} переходов · ${finishLabel}${solution?.transposed ? " · транспонировано" : ""}`;
}

function showSolution(data) {
  solution = data;
  $("board-message").hidden = true;
  $("route-status").classList.remove("error");
  $("route-status").textContent =
    "Маршрут проверен · " + columns * rows + " клеток без повторов";
  drawBoard();
  setStep(data.path.length - 1);
  requestRouteEnumeration();
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
  const settle = (data) => {
    if (worker !== activeWorker) return;
    activeWorker.terminate();
    worker = null;
    busy = false;
    onResult(data);
    updateControls();
  };
  activeWorker.onmessage = (event) => settle(event.data);
  activeWorker.onerror = () =>
    settle({
      status: "error",
      message:
        "Не удалось выполнить расчёт. Измените параметры и попробуйте снова.",
    });
  activeWorker.postMessage(message);
}

function showBoard() {
  $("board-empty").hidden = true;
  $("board-panel").hidden = false;
}

function hideRouteNav() {
  routeEnumWorker?.terminate();
  routeEnumWorker = null;
  routeEnumKey = "";
  routeNav = null;
  $("route-nav").hidden = true;
}

const samePath = (a, b) =>
  a.length === b.length &&
  a.every((cell, index) => cell.x === b[index].x && cell.y === b[index].y);

function updateRouteNav() {
  if (!routeNav) return;
  $("route-counter").textContent =
    `Обход ${routeNav.index + 1} из ${routeNav.routes.length}`;
  $("route-prev").disabled = routeNav.index === 0;
  $("route-next").disabled =
    routeNav.index === routeNav.routes.length - 1;
}

function showRoute(index) {
  if (!routeNav || !solution) return;
  stopPlayback();
  routeNav.index = index;
  solution = { ...solution, path: routeNav.routes[index] };
  drawBoard();
  setStep(solution.path.length - 1);
  updateRouteNav();
}

// Flip-through is offered only when the exact number of traversals is known
// and small: the worker enumerates every route and reports complete = false
// as soon as there are more than 20 of them or the time budget runs out.
function requestRouteEnumeration() {
  const key = `${columns}x${rows}:${ratio.H}:${ratio.D}:${ratio.V}`;
  if (routeEnumKey === key) return;
  hideRouteNav();
  routeEnumKey = key;
  const activeWorker = new Worker(
    new URL("./solver.worker.js", import.meta.url),
    { type: "module" },
  );
  routeEnumWorker = activeWorker;
  const settle = () => {
    if (routeEnumWorker !== activeWorker) return false;
    activeWorker.terminate();
    routeEnumWorker = null;
    return true;
  };
  activeWorker.onmessage = ({ data }) => {
    if (!settle()) return;
    if (data.valid === false || !data.complete || data.routes.length < 2) {
      routeEnumKey = "";
      return;
    }
    const index = solution
      ? Math.max(
          0,
          data.routes.findIndex((route) => samePath(route, solution.path)),
        )
      : 0;
    routeNav = { routes: data.routes, index };
    $("route-nav").hidden = false;
    updateRouteNav();
  };
  activeWorker.onerror = () => {
    if (!settle()) return;
    routeEnumKey = "";
  };
  activeWorker.postMessage({
    type: "enumerate",
    columns,
    rows,
    ratio,
    limit: 30,
  });
}

function showEmptyState(title, description) {
  $("board-panel").hidden = true;
  $("board-empty").hidden = false;
  $("empty-title").textContent = title;
  $("empty-description").textContent = description;
}

function abortResult() {
  clearTimeout(checkTimer);
  worker?.terminate();
  worker = null;
  busy = false;
  stopPlayback();
  hideRouteNav();
  solution = null;
  step = 0;
  $("board-message").hidden = true;
  $("route-status").classList.remove("error");
  $("route-status").textContent = "Проверяем поле…";
}

// The finish never moves: it is always the top-right corner of the board.
function check() {
  clearTimeout(checkTimer);
  // A new answer supersedes any route still being built for older inputs.
  worker?.terminate();
  worker = null;
  busy = false;
  const next = readRatio();
  const checkedRatio = validateRatio(next);
  renderRatio(next, checkedRatio);
  requestSuggestions();
  requestRatioSuggestions();
  if (!checkedRatio.valid) {
    abortResult();
    showEmptyState("Задайте соотношение", checkedRatio.message);
    setVerdict("error", "Соотношение задано неверно", checkedRatio.message);
    $("quota-panel").hidden = true;
    updateControls();
    return;
  }
  ratio = next;
  const nextColumns = columnsInput.valueAsNumber;
  const nextRows = rowsInput.valueAsNumber;
  const sizeReason = `Стороны — целые числа от 1 до ${MAX_SIDE}.`;
  for (const input of [columnsInput, rowsInput]) {
    const value = input.valueAsNumber;
    input.setAttribute(
      "aria-invalid",
      String(
        input.value !== "" &&
          (!Number.isSafeInteger(value) || value < 1 || value > MAX_SIDE),
      ),
    );
  }
  if (
    !Number.isInteger(nextColumns) ||
    !Number.isInteger(nextRows) ||
    nextColumns < 1 ||
    nextRows < 1 ||
    nextColumns > MAX_SIDE ||
    nextRows > MAX_SIDE
  ) {
    abortResult();
    showEmptyState("Задайте размер поля", sizeReason);
    setVerdict("error", "Размер поля задан неверно", sizeReason);
    $("quota-panel").hidden = true;
    updateControls();
    return;
  }
  columns = nextColumns;
  rows = nextRows;
  const validation = validateDimensions(columns, rows, ratio);
  renderQuota(validation);
  stopPlayback();
  hideRouteNav();
  solution = null;
  step = 0;
  showBoard();
  if (!validation.valid) {
    drawBoard();
    showMessage("Поле пройти нельзя", validation.message);
    setVerdict("no", "Нет, поле пройти нельзя", validation.message);
    $("route-status").textContent = "Поле пройти нельзя";
    $("route-status").classList.add("error");
    updateControls();
    return;
  }
  $("board-message").hidden = true;
  $("route-status").classList.remove("error");
  $("route-status").textContent = "Проверяем поле…";
  setVerdict(
    "checking",
    "Проверяем поле…",
    "Строим маршрут из разрешённых блоков.",
  );
  drawBoard();
  updateControls();
  calculate({ type: "solve", columns, rows, ratio }, (data) => {
    if (data.status === "solved") {
      showSolution(data);
      setVerdict(
        "yes",
        "Да, поле можно пройти",
        `Маршрут из ${data.path.length - 1} переходов проверен: ` +
          `H = ${data.counts.H}, D = ${data.counts.D}, V = ${data.counts.V}.`,
      );
    } else if (data.status === "error") {
      solution = null;
      drawBoard();
      showMessage("Ошибка расчёта", data.message);
      setVerdict("error", "Ошибка расчёта", data.message);
      $("route-status").textContent = "Проверка не завершилась";
      $("route-status").classList.add("error");
    } else {
      solution = null;
      drawBoard();
      const text =
        "Ни один обход из разрешённых блоков не дал результата. " +
        "Это не значит, что обхода не существует.";
      showMessage("Обход не найден", text);
      setVerdict("unknown", "Обход не найден", text);
      $("route-status").textContent = "Обход не найден";
      $("route-status").classList.add("error");
    }
    updateControls();
  });
}

function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(check, 350);
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
  const variants =
    name === "VHVD"
      ? [PATTERNS[name], [...PATTERNS[name].slice(0, 3), [1, 1]]]
      : [PATTERNS[name]];
  for (const [i, deltas] of variants.entries()) {
    const points = [[0, 0]];
    for (const [dx, dy] of deltas) {
      const [x, y] = points.at(-1);
      points.push([x + dx, y + dy]);
    }
    const minX = Math.min(...points.map(([x]) => x)),
      minY = Math.min(...points.map(([, y]) => y));
    const width = Math.max(...points.map(([x]) => x)) - minX + 1;
    const height = Math.max(...points.map(([, y]) => y)) - minY + 1;
    patterns.push({
      name: name + (name === "VHVD" ? (i ? " ↑" : " ↓") : ""),
      subtitle: "Блок 2×2 с выходом",
      points: points.map(([x, y]) => [x - minX, y - minY]),
      width,
      height,
    });
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
  check();
});
for (const input of Object.values(ratioInputs))
  input.addEventListener("input", scheduleCheck);
for (const input of [columnsInput, rowsInput])
  input.addEventListener("input", scheduleCheck);
$("check").addEventListener("click", check);
$("show-numbers").addEventListener("change", () =>
  document
    .querySelector(".board-svg")
    ?.classList.toggle("hide-numbers", !$("show-numbers").checked),
);
$("play").addEventListener("click", startPlayback);
$("route-prev").addEventListener("click", () => {
  if (routeNav && routeNav.index > 0) showRoute(routeNav.index - 1);
});
$("route-next").addEventListener("click", () => {
  if (routeNav && routeNav.index < routeNav.routes.length - 1)
    showRoute(routeNav.index + 1);
});
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
renderRatio(readRatio(), validateRatio(readRatio()));
check();
