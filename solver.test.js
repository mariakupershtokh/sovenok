import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RATIO,
  MAX_SIDE,
  PATTERNS,
  enumerateCornerRoutes,
  findBoardChoices,
  findCornerBoardSuggestions,
  findCornerRatioSuggestions,
  findFinishChoices,
  getFinishCells,
  solveBoard,
  solveCorner,
  validateDimensions,
  validateRatio,
  verifyRoute,
} from "./solver.js";

const deltasFor = {
  HVHV: [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, 1],
  ],
  HDHD: [
    [1, 0],
    [-1, 1],
    [1, 0],
    [-1, 1],
  ],
  VDVD: [
    [0, 1],
    [1, -1],
    [0, 1],
    [-1, 1],
  ],
  VDVH: [
    [0, 1],
    [1, -1],
    [0, 1],
    [1, 0],
  ],
  HDHH: [
    [1, 0],
    [-1, 1],
    [1, 0],
    [1, 0],
  ],
};

function assertGrammar(columns, rows, result) {
  if (result.method === "bands") {
    assertBandGrammar(columns, rows, result);
    return;
  }
  const { path, segments, transposed } = result;
  if (columns === 1 || rows === 1) {
    assert.equal(segments[0].kind, "straight");
    return;
  }
  const width = transposed ? rows : columns,
    height = transposed ? columns : rows;
  const virtual = path.map(({ x, y }) =>
    transposed ? { x: y, y: x } : { x, y },
  );
  let previousEnd = -1,
    reachedReturn = false,
    reachedVDVD = false;
  for (const segment of segments) {
    assert.equal(segment.fromIndex, previousEnd + 1);
    if (previousEnd >= 0) {
      const from = virtual[previousEnd],
        to = virtual[segment.fromIndex];
      assert.deepEqual([to.x - from.x, to.y - from.y], [1, 0]);
    }
    previousEnd = segment.toIndex;
    if (segment.kind !== "strip") {
      assert.equal(width % 2, 1);
      assert.equal(segment.kind, transposed ? "final-row" : "final-column");
      assert.deepEqual(
        virtual.slice(segment.fromIndex),
        Array.from({ length: height }, (_, y) => ({ x: width - 1, y })),
      );
      continue;
    }
    const cells = virtual.slice(segment.fromIndex, segment.toIndex + 1);
    assert.equal(cells.length, 2 * height);
    const deltas = cells
      .slice(1)
      .map((cell, i) => [
        cell.x - cells[i].x,
        cells[0].y === 0 ? cell.y - cells[i].y : cells[i].y - cell.y,
      ]);
    const word = deltas
      .map(([dx, dy]) => (dx && dy ? "D" : dx ? "H" : "V"))
      .join("");
    if (segment.direction === "return") {
      reachedReturn = true;
      const diagonal = word.match(/^D*/)[0].length,
        vertical = height - 1 - diagonal;
      assert.equal(
        word,
        "D".repeat(diagonal) +
          "V".repeat(vertical) +
          "H" +
          "V".repeat(vertical) +
          "D".repeat(diagonal),
      );
      assert.ok(deltas.slice(0, height - 1).every(([, dy]) => dy === 1));
      assert.ok(deltas.slice(height).every(([, dy]) => dy === -1));
      assert.deepEqual(segment.patterns, [word]);
    } else {
      assert.equal(reachedReturn, false, "ordinary strips must precede lacing");
      const blockCount = Math.floor((height - 1) / 2);
      assert.equal(segment.patterns.length, blockCount);
      for (let block = 0; block < blockCount; block++) {
        const name = word.slice(block * 4, block * 4 + 4);
        assert.ok(["HVHV", "HDHD", "VDVD"].includes(name), name);
        assert.deepEqual(
          deltas.slice(block * 4, block * 4 + 4),
          deltasFor[name],
        );
        assert.equal(segment.patterns[block], name);
        if (name === "VDVD") reachedVDVD = true;
        else assert.equal(reachedVDVD, false, "spend surplus H before VDVD");
      }
      if (height % 2) assert.deepEqual(deltas.slice(blockCount * 4), [[1, 0]]);
      else {
        assert.ok(["VDVH", "HDHH"].includes(segment.exitPattern));
        assert.deepEqual(
          deltas.slice(blockCount * 4),
          deltasFor[segment.exitPattern].slice(0, 3),
        );
      }
    }
  }
  assert.equal(previousEnd, path.length - 1);
}

function assertBandGrammar(columns, rows, result) {
  assert.equal(rows % 2, 0);
  assert.equal(result.segments.length, rows / 2);
  let previousEnd = -1,
    verticals = 0;
  for (const [index, segment] of result.segments.entries()) {
    assert.equal(segment.kind, "band");
    assert.equal(segment.fromIndex, previousEnd + 1);
    previousEnd = segment.toIndex;
    assert.equal(segment.toIndex - segment.fromIndex + 1, 2 * columns);
    assert.equal(
      segment.verticalMoves,
      Math.abs(segment.start - segment.end) + 1,
    );
    verticals += segment.verticalMoves;
    const cells = result.path.slice(segment.fromIndex, segment.toIndex + 1);
    assert.ok(cells.every(({ y }) => y === 2 * index || y === 2 * index + 1));
    assert.equal(new Set(cells.map(({ x, y }) => `${x},${y}`)).size, 2 * columns);
  }
  assert.equal(previousEnd, result.path.length - 1);
  assert.equal(verticals, result.counts.V);
}

// Independent exhaustive oracle for tiny boards, without the block constructor.
function exactQuotas(columns, rows, finish = { x: columns - 1, y: rows - 1 }) {
  const size = columns * rows,
    seen = new Uint8Array(size),
    result = new Set(),
    counts = { H: 0, D: 0, V: 0 };
  seen[0] = 1;
  function visit(cell, depth) {
    if (cell === finish.y * columns + finish.x) {
      if (depth === size) result.add(`${counts.H},${counts.D},${counts.V}`);
      return;
    }
    const x = cell % columns,
      y = Math.floor(cell / columns);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if ((!dx && !dy) || nx < 0 || nx >= columns || ny < 0 || ny >= rows)
          continue;
        const next = ny * columns + nx;
        if (seen[next]) continue;
        const kind = dx && dy ? "D" : dx ? "H" : "V";
        seen[next] = 1;
        counts[kind]++;
        visit(next, depth + 1);
        counts[kind]--;
        seen[next] = 0;
      }
  }
  visit(0, 1);
  return result;
}

test("ratios accept zeros, reject invalid coefficients, and require a positive multiplier", () => {
  assert.equal(validateRatio({ H: 0, D: 0, V: 1 }).valid, true);
  for (const ratio of [
    { H: 0, D: 0, V: 0 },
    { H: -1, D: 2, V: 3 },
    { H: 1.5, D: 1, V: 1 },
    { H: NaN, D: 1, V: 1 },
    { H: Infinity, D: 1, V: 1 },
  ])
    assert.equal(validateRatio(ratio).valid, false);
  assert.equal(validateDimensions(1, 1).valid, false);
  for (const [m, n] of [
    [0, 5],
    [3.5, 5],
    [3, 3],
    [5, 3],
  ])
    assert.equal(validateDimensions(m, n).valid, false);
  assert.equal(validateDimensions(2, 11).valid, true);
  assert.deepEqual(validateDimensions(3, 5).quota, { H: 2, D: 4, V: 8 });
  assert.equal(
    validateDimensions(2, 2, { H: 1, D: 1, V: 1 }).valid,
    false,
    "a=2 requires odd H+D",
  );
  assert.equal(validateDimensions(2, 2, { H: 0, D: 1, V: 2 }).valid, true);
});

test("necessary arithmetic conditions never reject a route found by exhaustive search", () => {
  for (const [m, n] of [
    [1, 2],
    [2, 1],
    [2, 2],
    [2, 3],
    [3, 2],
    [2, 4],
    [3, 3],
  ]) {
    const possible = exactQuotas(m, n);
    for (const key of possible) {
      const [H, D, V] = key.split(",").map(Number);
      assert.equal(
        validateDimensions(m, n, { H, D, V }).valid,
        true,
        `${m}x${n}: ${key}`,
      );
    }
    for (let H = 0; H < m * n; H++)
      for (let D = 0; D < m * n - H; D++) {
        const V = m * n - 1 - H - D,
          ratio = { H, D, V };
        const solved = solveBoard(m, n, { ratio });
        if (solved.status === "solved")
          assert.ok(possible.has(`${H},${D},${V}`));
      }
  }
  assert.equal(validateDimensions(3, 3, { H: 1, D: 0, V: 1 }).valid, false);
  assert.equal(
    exactQuotas(3, 3).has("4,0,4"),
    false,
    "the dedicated 3x3 rule rejects a quota that the arithmetic checks allowed",
  );
});

test("all supported default-ratio candidates retain exact quotas and approved grammar", () => {
  let checked = 0;
  for (let m = 1; m <= MAX_SIDE; m++)
    for (let n = 1; n <= MAX_SIDE; n++) {
      const validation = validateDimensions(m, n);
      if (!validation.valid) continue;
      const result = solveBoard(m, n);
      assert.equal(result.status, "solved", `${m}x${n}`);
      assert.equal(verifyRoute(m, n, result.path, result.quota).valid, true);
      assert.deepEqual(result.counts, validation.quota);
      assertGrammar(m, n, result);
      checked++;
    }
  assert.ok(checked > 48);
});

test("even sides and arbitrary ratios use only approved blocks", () => {
  for (let H = 0; H <= 3; H++)
    for (let D = 0; D <= 3; D++)
      for (let V = 0; V <= 3; V++) {
        if (H + D + V === 0) continue;
        const ratio = { H, D, V };
        for (let m = 1; m <= 9; m++)
          for (let n = 1; n <= 9; n++) {
            const result = solveBoard(m, n, { ratio });
            if (result.status !== "solved") continue;
            assert.equal(
              verifyRoute(m, n, result.path, result.quota).valid,
              true,
              JSON.stringify({ m, n, ratio }),
            );
            assertGrammar(m, n, result);
          }
      }
  for (const ratio of [
    { H: 0, D: 1, V: 2 },
    { H: 2, D: 1, V: 0 },
  ])
    assert.equal(solveBoard(2, 2, { ratio }).status, "solved");
  const square = solveBoard(4, 4, { ratio: { H: 2, D: 1, V: 2 } });
  assert.equal(square.status, "solved");
  assert.equal(square.transposed, false);
  assert.deepEqual(square.counts, { H: 6, V: 6, D: 3 });
});

test("choices are verified, sorted by area then smallest side, and respect zero coefficients", () => {
  const result = findBoardChoices({ H: 2, D: 1, V: 2 });
  assert.deepEqual(result.boards[0], { columns: 2, rows: 8 });
  for (let i = 0; i < result.boards.length; i++) {
    const board = result.boards[i];
    assert.equal(
      solveBoard(board.columns, board.rows, { ratio: { H: 2, D: 1, V: 2 } })
        .status,
      "solved",
    );
    if (i)
      assert.ok(
        result.boards[i - 1].columns * result.boards[i - 1].rows <=
          board.columns * board.rows,
      );
  }
  assert.deepEqual(findBoardChoices(DEFAULT_RATIO).boards[0], {
    columns: 3,
    rows: 5,
  });
  assert.deepEqual(findBoardChoices({ H: 0, D: 0, V: 1 }).boards[0], {
    columns: 1,
    rows: 2,
  });
  assert.deepEqual(findBoardChoices({ H: 1, D: 0, V: 0 }).boards[0], {
    columns: 2,
    rows: 1,
  });
  assert.deepEqual(findBoardChoices({ H: 0, D: 1, V: 0 }).boards, []);
  const incomplete = findBoardChoices({ H: 1, D: 0, V: 1 });
  assert.deepEqual(incomplete.minimumByConditions, { columns: 3, rows: 7 });
  assert.ok(incomplete.unresolved > 0);
});

test("transposition preserves physical quotas; unresolved construction stays honest", () => {
  for (const [m, n] of [
    [3, 5],
    [3, 19],
    [5, 17],
    [9, 11],
    [2, 11],
  ]) {
    const result = solveBoard(m, n);
    assert.equal(result.status, "solved");
    assert.deepEqual(result.counts, validateDimensions(m, n).quota);
  }
  for (const result of [
    solveBoard(MAX_SIDE + 1, 1, { ratio: { H: 1, D: 0, V: 0 } }),
    solveBoard(9, 11, { timeLimitMs: 0 }),
  ])
    assert.equal(result.status, "not-found");
  // The 3x3 zero-diagonal quota is now rejected by the dedicated 1:3 rule.
  assert.equal(
    solveBoard(3, 3, { ratio: { H: 1, D: 0, V: 1 } }).status,
    "invalid",
  );
});

test("route verification rejects repeats, long moves, endpoints and incorrect quotas", () => {
  const { path, quota } = solveBoard(3, 5);
  const duplicate = path.map((cell) => ({ ...cell }));
  duplicate[2] = duplicate[1];
  assert.equal(verifyRoute(3, 5, duplicate, quota).valid, false);
  const jump = path.map((cell) => ({ ...cell }));
  [jump[1], jump[10]] = [jump[10], jump[1]];
  assert.equal(verifyRoute(3, 5, jump, quota).valid, false);
  assert.equal(verifyRoute(3, 5, path.slice(1), quota).valid, false);
  assert.equal(verifyRoute(3, 5, path, { H: 4, V: 8, D: 2 }).valid, false);
});

test("the 50 by 50 boundary works in both the solver and the size picker", () => {
  assert.equal(MAX_SIDE, 50);
  const ratio = { H: 2, D: 3, V: 2 };
  const result = solveBoard(50, 50, { ratio });
  assert.equal(result.status, "solved");
  assert.equal(result.path.length, 2500);
  assert.deepEqual(result.counts, { H: 714, V: 714, D: 1071 });
  assert.equal(verifyRoute(50, 50, result.path, result.quota).valid, true);
  assertGrammar(50, 50, result);
  assert.ok(
    findBoardChoices(ratio).boards.some(
      (board) => board.columns === 50 && board.rows === 50,
    ),
  );
  assert.equal(
    solveBoard(1, 50, { ratio: { H: 0, D: 0, V: 1 } }).status,
    "solved",
  );
  assert.equal(
    solveBoard(50, 1, { ratio: { H: 1, D: 0, V: 0 } }).status,
    "solved",
  );
});

test("zero-horizontal diagonal lower bound rejects 6x6 with five diagonals", () => {
  const result = validateDimensions(6, 6, { H: 0, D: 1, V: 6 });
  assert.equal(result.valid, false);
  assert.match(result.message, /D ≥.*15/);
  assert.deepEqual(result.quota, { H: 0, D: 5, V: 30 });
  const possible = solveBoard(6, 6, { ratio: { H: 0, D: 3, V: 4 } });
  assert.equal(possible.status, "solved");
  assert.equal(possible.counts.D, 15);
  assert.match(validateDimensions(6, 6, { H: 6, D: 1, V: 0 }).message, /D ≥.*15/);
});

test("four-row zero-horizontal boards need an extra diagonal pass", () => {
  const rejected = validateDimensions(7, 4, { H: 0, D: 4, V: 5 });
  assert.equal(rejected.valid, false);
  assert.match(rejected.message, /18/);
  assert.match(rejected.message, /D = 12/);
  assert.deepEqual(rejected.quota, { H: 0, D: 12, V: 15 });

  assert.equal(validateDimensions(7, 4, { H: 0, D: 18, V: 9 }).valid, true);
  assert.equal(validateDimensions(3, 4, { H: 0, D: 4, V: 7 }).valid, false);
  assert.equal(validateDimensions(3, 4, { H: 0, D: 6, V: 5 }).valid, true);

  // The extra pass belongs to b divisible by 4, not to every even b.
  assert.equal(validateDimensions(3, 8, { H: 0, D: 8, V: 15 }).valid, false);
  assert.equal(validateDimensions(3, 8, { H: 0, D: 10, V: 13 }).valid, true);
  assert.equal(validateDimensions(3, 10, { H: 0, D: 10, V: 19 }).valid, true);
  assert.equal(validateDimensions(3, 6, { H: 0, D: 6, V: 11 }).valid, true);
  assert.equal(validateDimensions(3, 2, { H: 0, D: 2, V: 3 }).valid, true);
});

test("zero-horizontal even-row bands build routes below the strip constructor", () => {
  for (const [columns, rows, D, V] of [
    [3, 4, 8, 3],
    [4, 4, 11, 4],
    [5, 4, 14, 5],
    [7, 4, 20, 7],
    [5, 6, 24, 5],
    [6, 6, 29, 6],
    [3, 8, 16, 7],
  ]) {
    const ratio = { H: 0, D, V };
    const validation = validateDimensions(columns, rows, ratio);
    assert.equal(validation.valid, true, `${columns}x${rows} ${D}:${V}`);
    assert.deepEqual(validation.quota, { H: 0, D, V });
    const result = solveBoard(columns, rows, { ratio });
    assert.equal(result.status, "solved", `${columns}x${rows} ${D}:${V}`);
    assert.equal(result.method, "bands");
    assert.equal(result.transposed, false);
    assert.deepEqual(result.counts, { H: 0, D, V });
    assert.equal(verifyRoute(columns, rows, result.path, result.quota).valid, true);
    assert.deepEqual(result.path.at(-1), {
      x: columns - 1,
      y: rows - 1,
    });
    assertGrammar(columns, rows, result);
    const corner = solveCorner(columns, rows, { ratio, timeLimitMs: 1500 });
    assert.equal(corner.status, "solved");
    assert.deepEqual(corner.path.at(-1), {
      x: columns - 1,
      y: rows - 1,
    });
  }
});

test("zero-horizontal even-row boards require V at least a", () => {
  const rejected = validateDimensions(5, 4, { H: 0, D: 16, V: 3 });
  assert.equal(rejected.valid, false);
  assert.match(rejected.message, /V ≥ a = 5/);
  assert.match(rejected.message, /Задано V = 3/);
  assert.equal(validateDimensions(4, 4, { H: 0, D: 13, V: 2 }).valid, false);
  assert.equal(validateDimensions(8, 8, { H: 0, D: 59, V: 4 }).valid, false);
  assert.equal(validateDimensions(5, 4, { H: 0, D: 14, V: 5 }).valid, true);
  assert.equal(validateDimensions(6, 6, { H: 0, D: 29, V: 6 }).valid, true);
  // The bound must not reject any route found by an independent oracle.
  for (const [columns, rows] of [[2, 2], [2, 4], [3, 2], [3, 4], [4, 2], [4, 4]])
    for (const key of exactQuotas(columns, rows)) {
      const [H, D, V] = key.split(",").map(Number);
      assert.equal(
        validateDimensions(columns, rows, { H, D, V }).valid,
        true,
        `${columns}x${rows}: ${key}`,
      );
    }
});

test("zero-horizontal vertical minimum follows the two-row pass cases", () => {
  // k = 1 (b = 2): only the pass to the opposite edge is possible, so the
  // quota V = a, D = a − 1 is forced.
  for (const columns of [2, 3, 4, 5, 6]) {
    assert.deepEqual(
      [...exactQuotas(columns, 2)].filter((key) => key.startsWith("0,")).sort(),
      [`0,${columns - 1},${columns}`],
      `${columns}x2`,
    );
  }

  // k = 2 (b = 4): the first pass returns to the left edge, the second starts
  // at column 1 and needs a − 1 vertical moves, so the minimum is a.
  for (const columns of [2, 3, 4]) {
    const minimum = Math.min(
      ...[...exactQuotas(columns, 4)]
        .filter((key) => key.startsWith("0,"))
        .map((key) => Number(key.split(",")[2])),
    );
    assert.equal(minimum, columns, `${columns}x4`);
  }

  // k >= 3: 1 + 2(k − 2) + (1 + a − 2(k − 1)) = a whenever the last pass is
  // not degenerate, i.e. a >= b − 2.
  for (const [columns, rows] of [[6, 6], [6, 8], [8, 8], [8, 10], [10, 10]]) {
    const bands = rows / 2;
    const last = 1 + columns - 2 * (bands - 1);
    assert.ok(last >= 1, `${columns}x${rows}`);
    assert.equal(1 + 2 * (bands - 2) + last, columns);
    const quota = { H: 0, D: columns * rows - 1 - columns, V: columns };
    const result = solveBoard(columns, rows, { ratio: quota, timeLimitMs: 2000 });
    assert.equal(result.status, "solved", `${columns}x${rows}`);
    assert.equal(result.method, "bands");
    assert.deepEqual(result.counts, quota);
    assert.equal(verifyRoute(columns, rows, result.path, result.quota).valid, true);
  }

  // For a < b − 2 the last pass degenerates and the minimum exceeds a.
  const narrowMinimum = Math.min(
    ...[...exactQuotas(3, 6)]
      .filter((key) => key.startsWith("0,"))
      .map((key) => Number(key.split(",")[2])),
  );
  assert.equal(narrowMinimum, 5);
  assert.ok(narrowMinimum > 3);
});

test("a 3 by 3 board without diagonals only admits the two 1:3 layouts", () => {
  const allowed = [
    { ratio: { H: 3, D: 0, V: 1 }, quota: { H: 6, D: 0, V: 2 } },
    { ratio: { H: 1, D: 0, V: 3 }, quota: { H: 2, D: 0, V: 6 } },
  ];
  for (const { ratio, quota } of allowed) {
    const validation = validateDimensions(3, 3, ratio);
    assert.equal(validation.valid, true, JSON.stringify(ratio));
    assert.deepEqual(validation.quota, quota);
    const result = solveBoard(3, 3, { ratio });
    assert.equal(result.status, "solved");
    assert.deepEqual(result.counts, quota);
    assert.deepEqual(result.path.at(-1), { x: 2, y: 2 });
    assert.equal(verifyRoute(3, 3, result.path, result.quota).valid, true);
  }

  const rejected = validateDimensions(3, 3, { H: 1, D: 0, V: 1 });
  assert.equal(rejected.valid, false);
  assert.match(rejected.message, /H = 6, V = 2/);
  assert.match(rejected.message, /H = 2, V = 6/);
  assert.match(rejected.message, /соотношение 1 : 3/);
  assert.deepEqual(rejected.quota, { H: 4, D: 0, V: 4 });
  assert.equal(solveBoard(3, 3, { ratio: { H: 1, D: 0, V: 1 } }).status, "invalid");

  // The rule must not reject any realizable top-right route.
  for (const key of exactQuotas(3, 3)) {
    const [H, D, V] = key.split(",").map(Number);
    assert.equal(
      validateDimensions(3, 3, { H, D, V }).valid,
      true,
      `3x3: ${key}`,
    );
  }
});

test("endpoint-aware necessary conditions retain every tiny-board oracle route", () => {
  for (const [columns, rows] of [[2, 2], [2, 3], [3, 2], [3, 3]]) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      if ((!x && !y) || (x !== 0 && x !== columns - 1 && y !== 0 && y !== rows - 1)) continue;
      const finish = { x, y };
      for (const word of exactQuotas(columns, rows, finish)) {
        const [H, D, V] = word.split(",").map(Number);
        assert.equal(validateDimensions(columns, rows, { H, D, V }, finish).valid, true,
          `${columns}×${rows}, ${word}, finish ${x},${y}`);
      }
    }
  }
  assert.equal(validateDimensions(3, 5, DEFAULT_RATIO, { x: 1, y: 2 }).valid, false);
  assert.equal(validateDimensions(3, 5, DEFAULT_RATIO, { x: 0, y: 0 }).valid, false);
  assert.equal(validateDimensions(3, 5, DEFAULT_RATIO, { x: 2, y: 1 }).valid, false);
});

function assertBlockGrammar(result) {
  if (result.method !== "blocks") return;
  const path = result.path.map(({ x, y }) => result.transposed ? { x: y, y: x } : { x, y });
  for (const segment of result.segments) {
    const body = path.slice(segment.fromIndex, segment.toIndex + 1);
    if (segment.kind === "straight") {
      assert.ok(body.length <= 2);
      if (body.length === 2) assert.ok(body[0].x === body[1].x || body[0].y === body[1].y);
      continue;
    }
    assert.equal(body.length, 4);
    assert.equal(new Set(body.map(p => p.x)).size, 2);
    assert.equal(new Set(body.map(p => p.y)).size, 2);
    const points = segment.toIndex + 1 < path.length ? [...body, path[segment.toIndex + 1]] : body;
    const deltas = points.slice(1).map((p, i) => [p.x - points[i].x, p.y - points[i].y]);
    const variants = [PATTERNS[segment.pattern]];
    if (segment.pattern === "VHVD") variants.push([...PATTERNS.VHVD.slice(0, 3), [1, 1]]);
    assert.ok(variants.some(variant => [-1, 1].some(sx => [-1, 1].some(sy =>
      deltas.every(([dx, dy], i) => dx === variant[i][0] * sx && dy === variant[i][1] * sy)
    ))), segment.pattern);
  }
}

test("split routes finish in two rectangles and cross the cut once", () => {
  const ratio = { H: 2, D: 1, V: 2 };
  const finish = { x: 7, y: 7 };
  const result = solveBoard(12, 8, { ratio, finish });
  assert.equal(result.status, "solved");
  assert.equal(result.method, "split");
  assert.equal(verifyRoute(12, 8, result.path, result.quota, finish).valid, true);
  assert.deepEqual(result.counts, result.quota);
  assert.deepEqual(result.path.at(-1), finish);
  let crossings = 0;
  for (let i = 1; i < result.path.length; i++)
    if ((result.path[i - 1].x < finish.x) !== (result.path[i].x < finish.x)) crossings++;
  assert.equal(crossings, 1, "the route must not weave across the finish column");
});

test("split construction covers all four edges", () => {
  const ratio = { H: 2, D: 1, V: 2 };
  const cases = [
    [9, 9, ratio, { x: 4, y: 8 }],
    [9, 9, ratio, { x: 6, y: 0 }],
    [7, 13, ratio, { x: 0, y: 8 }],
    [4, 14, ratio, { x: 3, y: 7 }],
  ];
  for (const [columns, rows, ratio, finish] of cases) {
    const result = solveBoard(columns, rows, { ratio, finish });
    assert.equal(result.status, "solved", `${columns}x${rows} finish ${finish.x},${finish.y}`);
    assert.equal(result.method, "split");
    assert.deepEqual(result.path.at(-1), finish);
    assert.equal(verifyRoute(columns, rows, result.path, result.quota, finish).valid, true);
    assert.deepEqual(result.counts, result.quota);
  }
});

test("finish choices carry verified block routes and preserve all quotas", () => {
  const result = findFinishChoices(3, 5, { timeLimitMs: 500 });
  assert.deepEqual(result.finishes.map(s => `${s.finish.x},${s.finish.y}`).sort(),
    ["0,2", "0,4", "2,0", "2,2", "2,4"]);
  assert.equal(result.unresolved, 0);
  for (const route of result.finishes) {
    assert.equal(verifyRoute(3, 5, route.path, route.quota, route.finish).valid, true);
    assert.deepEqual(route.counts, { H: 2, V: 8, D: 4 });
    assertBlockGrammar(route);
  }
  const finish = { x: 0, y: 2 };
  const chosen = solveBoard(3, 5, { finish, timeLimitMs: 500 });
  assert.equal(chosen.status, "solved");
  assert.deepEqual(chosen.path.at(-1), finish);
  assert.equal(verifyRoute(3, 5, chosen.path, chosen.quota).valid, false);
  const even = findFinishChoices(4, 4, { ratio: { H: 2, D: 1, V: 2 }, timeLimitMs: 500 });
  assert.equal(even.finishes.length, 3);
  for (const route of even.finishes) {
    assert.equal(verifyRoute(4, 4, route.path, route.quota, route.finish).valid, true);
    assertBlockGrammar(route);
  }
  const unchanged = findFinishChoices(50, 50, { ratio: { H: 2, D: 3, V: 2 }, timeLimitMs: 0 });
  assert.ok(unchanged.finishes.length >= 1);
  assert.ok(unchanged.unresolved > 0);
  assert.equal(unchanged.finishes[0].path.length, 2500);
  for (const [columns, rows] of [[Infinity, 3], [2.5, 3], [51, 2], [0, 2]])
    assert.deepEqual(findFinishChoices(columns, rows).finishes, []);
});

test("the fixed corner finish falls back to the block tiling", () => {
  const ratio = { H: 1, D: 1, V: 3 };
  assert.equal(solveBoard(3, 7, { ratio }).status, "not-found");
  const result = solveCorner(3, 7, { ratio, timeLimitMs: 1500 });
  assert.equal(result.status, "solved");
  assert.deepEqual(result.path.at(-1), { x: 2, y: 6 });
  assert.deepEqual(result.counts, result.quota);
  assert.equal(verifyRoute(3, 7, result.path, result.quota).valid, true);

  const flippedRatio = { H: 3, D: 1, V: 1 };
  assert.equal(solveBoard(7, 3, { ratio: flippedRatio }).status, "not-found");
  const flipped = solveCorner(7, 3, { ratio: flippedRatio, timeLimitMs: 1500 });
  assert.equal(flipped.status, "solved");
  assert.deepEqual(flipped.path.at(-1), { x: 6, y: 2 });
  assert.equal(verifyRoute(7, 3, flipped.path, flipped.quota).valid, true);

  assert.equal(
    solveCorner(MAX_SIDE + 1, 1, { ratio: { H: 1, D: 0, V: 0 } }).status,
    "not-found",
  );
});

test("board suggestions are verified and start from the smallest corner board", () => {
  const ratio = { H: 1, D: 2, V: 4 };
  const suggestions = findCornerBoardSuggestions(ratio);
  assert.equal(suggestions.valid, true);
  assert.equal(suggestions.boards.length, 4);
  assert.deepEqual(suggestions.boards[0], { columns: 3, rows: 5 });
  for (const board of suggestions.boards)
    assert.equal(
      solveCorner(board.columns, board.rows, { ratio, timeLimitMs: 500 })
        .status,
      "solved",
    );

  const fallback = findCornerBoardSuggestions({ H: 1, D: 1, V: 3 });
  assert.deepEqual(fallback.boards[0], { columns: 3, rows: 7 });
  assert.ok(fallback.boards.length >= 3);
  assert.ok(fallback.boards.some((board) => board.columns === 3 && board.rows === 17));

  assert.deepEqual(findCornerBoardSuggestions({ H: 0, D: 1, V: 1 }).boards, []);
  assert.equal(
    findCornerBoardSuggestions({ H: 1, D: 1, V: 3 }, { limit: 2 }).boards
      .length,
    2,
  );
  assert.equal(findCornerBoardSuggestions(null).valid, false);
});

test("ratio suggestions are primitive, verified, and depend on the board", () => {
  const gcd = (a, b) => {
    while (b) [a, b] = [b, a % b];
    return a;
  };
  for (const [columns, rows] of [[3, 5], [4, 4], [6, 8], [13, 17]]) {
    const result = findCornerRatioSuggestions(columns, rows, { limit: 4 });
    assert.equal(result.valid, true);
    assert.ok(result.ratios.length > 0, `${columns}x${rows}`);
    const keys = new Set();
    for (const ratio of result.ratios) {
      const sum = ratio.H + ratio.D + ratio.V;
      assert.equal((columns * rows - 1) % sum, 0, `${columns}x${rows}`);
      assert.equal(gcd(gcd(ratio.H, ratio.D), ratio.V), 1);
      assert.equal(validateDimensions(columns, rows, ratio).valid, true);
      assert.equal(
        solveCorner(columns, rows, { ratio, timeLimitMs: 500 }).status,
        "solved",
        `${columns}x${rows}: ${ratio.H}:${ratio.D}:${ratio.V}`,
      );
      const key = `${ratio.H}:${ratio.D}:${ratio.V}`;
      assert.equal(keys.has(key), false);
      keys.add(key);
    }
  }
  assert.equal(findCornerRatioSuggestions(3, 5, { limit: 2 }).ratios.length, 2);
  assert.deepEqual(findCornerRatioSuggestions(0, 5).ratios, []);
  assert.equal(findCornerRatioSuggestions(3, 5, { limit: 0 }).valid, true);
  const defaultRatio = { H: 1, D: 2, V: 4 };
  assert.ok(
    findCornerRatioSuggestions(3, 5, { limit: 20 }).ratios.some(
      (ratio) =>
        ratio.H === defaultRatio.H &&
        ratio.D === defaultRatio.D &&
        ratio.V === defaultRatio.V,
    ),
  );
});

test("a 3 by 4 board without diagonals only admits the snake and zigzag layouts", () => {
  // Full search: exactly four D = 0 routes finish in the top-right corner,
  // one column snake with H = 2, V = 9 and three zigzags with H = 6, V = 5.
  const allowed = [
    { ratio: { H: 2, D: 0, V: 9 }, total: 1 },
    { ratio: { H: 6, D: 0, V: 5 }, total: 3 },
  ];
  for (const { ratio, total } of allowed) {
    const validation = validateDimensions(3, 4, ratio);
    assert.equal(validation.valid, true, JSON.stringify(ratio));
    const enumeration = enumerateCornerRoutes(3, 4, { ratio });
    assert.equal(enumeration.complete, true);
    assert.equal(enumeration.total, total);
    for (const path of enumeration.routes) {
      assert.equal(verifyRoute(3, 4, path, validation.quota).valid, true);
      assert.deepEqual(path.at(-1), { x: 2, y: 3 });
    }
  }

  for (const ratio of [
    { H: 4, D: 0, V: 7 },
    { H: 8, D: 0, V: 3 },
  ]) {
    const rejected = validateDimensions(3, 4, ratio);
    assert.equal(rejected.valid, false, JSON.stringify(ratio));
    assert.match(rejected.message, /H = 2, V = 9 или H = 6, V = 5/);
    assert.equal(solveBoard(3, 4, { ratio }).status, "invalid");
  }
  // These two fail the earlier arithmetic checks before the 3 × 4 rule.
  assert.equal(validateDimensions(3, 4, { H: 10, D: 0, V: 1 }).valid, false);
  assert.equal(validateDimensions(3, 4, { H: 0, D: 0, V: 11 }).valid, false);

  // The rule must not reject any realizable top-right route.
  for (const key of exactQuotas(3, 4)) {
    const [H, D, V] = key.split(",").map(Number);
    assert.equal(
      validateDimensions(3, 4, { H, D, V }).valid,
      true,
      `3x4: ${key}`,
    );
  }
});

test("equality H + D = a − 1 allows only horizontal column changes", () => {
  // 4 × 4 with 2 : 1 : 12: three column changes, one of them diagonal.
  const mixed = validateDimensions(4, 4, { H: 2, D: 1, V: 12 });
  assert.equal(mixed.valid, false);
  assert.match(
    mixed.message,
    /все переходы между столбцами должны быть горизонтальными/,
  );
  assert.equal(solveBoard(4, 4, { ratio: { H: 2, D: 1, V: 12 } }).status, "invalid");
  for (const [columns, rows, ratio] of [
    [4, 4, { H: 1, D: 2, V: 12 }],
    [4, 4, { H: 0, D: 3, V: 12 }],
    [5, 4, { H: 2, D: 2, V: 15 }],
    [5, 4, { H: 3, D: 1, V: 15 }],
    [3, 4, { H: 1, D: 1, V: 9 }],
    [3, 4, { H: 0, D: 2, V: 9 }],
    [3, 6, { H: 1, D: 1, V: 16 }],
  ]) {
    const validation = validateDimensions(columns, rows, ratio);
    assert.equal(
      validation.valid,
      false,
      `${columns}x${rows}: ${ratio.H}:${ratio.D}:${ratio.V}`,
    );
  }

  // The transposed direction: V + D = b − 1 with a diagonal is impossible.
  for (const [columns, rows, ratio] of [
    [4, 4, { H: 12, D: 1, V: 2 }],
    [4, 5, { H: 15, D: 2, V: 2 }],
    [6, 5, { H: 25, D: 2, V: 2 }],
  ]) {
    const validation = validateDimensions(columns, rows, ratio);
    assert.equal(
      validation.valid,
      false,
      `${columns}x${rows}: ${ratio.H}:${ratio.D}:${ratio.V}`,
    );
    assert.match(
      validation.message,
      /все переходы между строками должны быть вертикальными/,
    );
  }

  // Equality itself stays legal when every column change is horizontal.
  assert.equal(validateDimensions(3, 4, { H: 2, D: 0, V: 9 }).valid, true);
  assert.equal(validateDimensions(5, 4, { H: 4, D: 0, V: 15 }).valid, true);

  // Two-row boards are the genuine exception: in a two-cell column both
  // cells are edge cells, so a diagonal entry is fine.
  for (const [columns, ratio, total] of [
    [3, { H: 0, D: 2, V: 3 }, 1],
    [4, { H: 2, D: 1, V: 4 }, 3],
  ]) {
    const validation = validateDimensions(columns, 2, ratio);
    assert.equal(validation.valid, true, `${columns}x2`);
    const enumeration = enumerateCornerRoutes(columns, 2, { ratio });
    assert.equal(enumeration.complete, true);
    assert.equal(enumeration.total, total, `${columns}x2`);
  }
});

test("route enumeration lists every traversal and stops beyond the limit", () => {
  const zigzag = enumerateCornerRoutes(3, 4, { ratio: { H: 6, D: 0, V: 5 } });
  assert.equal(zigzag.valid, true);
  assert.equal(zigzag.complete, true);
  assert.equal(zigzag.total, 3);
  assert.equal(
    new Set(zigzag.routes.map((path) => JSON.stringify(path))).size,
    3,
    "routes are distinct",
  );
  for (const path of zigzag.routes)
    assert.equal(verifyRoute(3, 4, path, { H: 6, D: 0, V: 5 }).valid, true);

  // Greedy ordering: every next route is the closest one to the previous.
  const distance = (a, b) =>
    a.reduce(
      (count, cell, index) =>
        count + (cell.x !== b[index].x || cell.y !== b[index].y ? 1 : 0),
      0,
    );
  for (let i = 1; i < zigzag.routes.length; i++) {
    const previous = zigzag.routes[i - 1];
    const chosen = distance(previous, zigzag.routes[i]);
    for (const candidate of zigzag.routes.slice(i + 1))
      assert.ok(distance(previous, candidate) >= chosen, "greedy order");
  }

  const bands = enumerateCornerRoutes(5, 4, { ratio: { H: 0, D: 14, V: 5 } });
  assert.equal(bands.complete, true);
  assert.equal(bands.total, 4);
  for (const path of bands.routes)
    assert.equal(
      verifyRoute(5, 4, path, { H: 0, D: 14, V: 5 }).valid,
      true,
    );

  // More than twenty routes: the result is explicitly incomplete and empty.
  const many = enumerateCornerRoutes(3, 5, { ratio: { H: 1, D: 2, V: 4 } });
  assert.equal(many.complete, false);
  assert.equal(many.routes.length, 0);
  assert.equal(
    enumerateCornerRoutes(3, 5, { ratio: { H: 1, D: 2, V: 4 }, limit: 5 })
      .complete,
    false,
  );
  assert.equal(
    enumerateCornerRoutes(3, 5, {
      ratio: { H: 1, D: 2, V: 4 },
      timeLimitMs: 0,
    }).complete,
    false,
  );

  // A rejected board has no routes and the answer is still exact.
  assert.deepEqual(enumerateCornerRoutes(4, 4, { ratio: { H: 2, D: 1, V: 12 } }), {
    valid: true,
    routes: [],
    total: 0,
    complete: true,
  });
  assert.equal(enumerateCornerRoutes(3, 5, { ratio: null }).valid, false);
  assert.equal(enumerateCornerRoutes(0, 5, { ratio: { H: 1, D: 2, V: 4 } }).valid, false);
});

test("every offered board has at least one verified border finish", () => {
  // Board choice (still available through the solver) enters each board through
  // its finish list, so a board may only be offered when at least one border
  // cell already has a checked route.
  for (const ratio of [DEFAULT_RATIO, { H: 2, D: 1, V: 2 }]) {
    const { boards } = findBoardChoices(ratio, 7);
    assert.ok(boards.length > 0);
    for (const { columns, rows } of boards) {
      const { finishes } = findFinishChoices(columns, rows, { ratio, timeLimitMs: 300 });
      assert.ok(finishes.length > 0, `${columns} x ${rows} has no finish`);
      for (const route of finishes) {
        assert.deepEqual(route.path.at(-1), route.finish);
        assert.deepEqual(route.counts, route.quota);
        assert.equal(verifyRoute(columns, rows, route.path, route.quota, route.finish).valid, true);
      }
    }
  }
});

test("new patterns fill a 2x2 block before exiting, including upward VHVD", () => {
  for (const name of ["VHVH", "VHVV", "VHVD", "DHDH", "DHDV"]) {
    const cells = [{ x: 0, y: 0 }];
    for (const [dx, dy] of PATTERNS[name]) {
      const p = cells.at(-1); cells.push({ x: p.x + dx, y: p.y + dy });
    }
    assert.equal(new Set(cells.map(p => `${p.x},${p.y}`)).size, 5);
    assert.equal(new Set(cells.slice(0, 4).map(p => p.x)).size, 2);
    assert.equal(new Set(cells.slice(0, 4).map(p => p.y)).size, 2);
  }
});

test("every border cell is available or has a specific or unresolved finish explanation", () => {
  const result = findFinishChoices(3, 5, { timeLimitMs: 500 });
  const cells = getFinishCells(3, 5, DEFAULT_RATIO, result.finishes);
  assert.equal(cells.length, 12);
  assert.equal(new Set(cells.map(p => `${p.x},${p.y}`)).size, 12);
  assert.equal(cells.filter(p => p.available).length, 5);
  assert.equal(cells.filter(p => !p.available).length, 7);
  assert.ok(cells.every(p => p.x === 0 || p.x === 2 || p.y === 0 || p.y === 4));
  const reason = (x, y) => cells.find(p => p.x === x && p.y === y).reason;
  assert.match(reason(0, 0), /повторного посещения/);
  assert.match(reason(1, 0), /H \+ D = 6.*горизонтали равно 1/);
  assert.match(reason(0, 1), /V \+ D = 12.*вертикали равно 1/);

  const ratio = { H: 0, D: 3, V: 4 };
  const choices = findFinishChoices(6, 6, { ratio, timeLimitMs: 0 });
  const larger = getFinishCells(6, 6, ratio, choices.finishes);
  assert.equal(larger.length, 20);
  assert.equal(larger.find(p => p.x === 5 && p.y === 5).available, true);
  assert.equal(larger.find(p => p.x === 5 && p.y === 1).reason,
    "маршрут пока не найден; это не доказательство невозможности");
  const impossible = getFinishCells(6, 6, { H: 0, D: 1, V: 6 });
  assert.match(impossible.find(p => p.x === 5 && p.y === 5).reason, /D ≥.*15/);
  assert.deepEqual(getFinishCells(Infinity, 6, ratio), []);
});
