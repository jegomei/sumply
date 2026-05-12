const SIZE = 5;
const STATES = ["neutral", "cross", "keep"];
const ONE_DAY = 24 * 60 * 60 * 1000;
const START_DATE = new Date("2026-01-01T00:00:00");

const boardEl = document.querySelector("#board");
const timerEl = document.querySelector("#timer");
const challengeLabel = document.querySelector("#challengeLabel");
const pauseDialog = document.querySelector("#pauseDialog");
const winDialog = document.querySelector("#winDialog");
const winStats = document.querySelector("#winStats");
const copyResultButton = document.querySelector("#copyResultButton");
const pauseTitle = document.querySelector("#pauseTitle");
const continueButton = document.querySelector("#continueButton");
const restartFromPauseButton = document.querySelector("#restartFromPause");

let puzzle = null;
let puzzleDate = todayKey();
let cellStates = [];
let elapsedMs = 0;
let timerId = null;
let paused = false;
let completed = false;
let waitingToStart = false;
let lastTick = Date.now();

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function challengeNumber() {
  const start = new Date(START_DATE);
  const now = new Date();
  start.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.max(1, Math.floor((now - start) / ONE_DAY) + 1);
}

function mulberry32(seed) {
  return function next() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromDate(key) {
  return [...key].reduce((seed, char) => ((seed << 5) - seed + char.charCodeAt(0)) >>> 0, 2166136261);
}

function generatePuzzle(key) {
  const random = mulberry32(seedFromDate(key));
  for (let attempt = 0; attempt < 20000; attempt += 1) {
    const values = Array.from({ length: SIZE }, () =>
      Array.from({ length: SIZE }, () => 1 + Math.floor(random() * 9))
    );

    const solution = Array.from({ length: SIZE }, () =>
      Array.from({ length: SIZE }, () => random() > 0.42)
    );

    const puzzleCandidate = normalizePuzzle({ values, solution });
    if (isStrongPuzzle(puzzleCandidate) && hasUniqueSolution(puzzleCandidate)) {
      return puzzleCandidate;
    }
  }

  throw new Error("No se pudo generar un reto valido.");
}

function computeTargets(values, solution) {
  return {
    rowTargets: values.map((row, rowIndex) =>
      row.reduce((sum, value, colIndex) => sum + (solution[rowIndex][colIndex] ? value : 0), 0)
    ),
    colTargets: Array.from({ length: SIZE }, (_, colIndex) =>
      values.reduce((sum, row, rowIndex) => sum + (solution[rowIndex][colIndex] ? row[colIndex] : 0), 0)
    )
  };
}

function isMatrix(matrix, predicate) {
  return Array.isArray(matrix) &&
    matrix.length === SIZE &&
    matrix.every((row) => Array.isArray(row) && row.length === SIZE && row.every(predicate));
}

function normalizePuzzle(rawPuzzle) {
  if (!rawPuzzle || !isMatrix(rawPuzzle.values, Number.isInteger) || !isMatrix(rawPuzzle.solution, (value) => typeof value === "boolean")) {
    throw new Error("Formato de reto invalido.");
  }

  const values = rawPuzzle.values.map((row) => row.slice());
  const solution = rawPuzzle.solution.map((row) => row.slice());
  const { rowTargets, colTargets } = computeTargets(values, solution);
  return { values, solution, rowTargets, colTargets };
}

function isStrongPuzzle(puzzleToValidate) {
  const valuesOk = puzzleToValidate.values.flat().every((value) => value >= 1 && value <= 9);
  if (!valuesOk) return false;

  const keepCount = puzzleToValidate.solution.flat().filter(Boolean).length;
  if (keepCount < 9 || keepCount > 16) return false;

  for (let index = 0; index < SIZE; index += 1) {
    const row = puzzleToValidate.solution[index];
    const col = puzzleToValidate.solution.map((solutionRow) => solutionRow[index]);
    if (!row.some(Boolean) || row.every(Boolean)) return false;
    if (!col.some(Boolean) || col.every(Boolean)) return false;
  }

  return true;
}

function hasUniqueSolution(puzzleToValidate) {
  const rowOptions = puzzleToValidate.values.map((row, rowIndex) => {
    const options = [];

    for (let mask = 0; mask < (1 << SIZE); mask += 1) {
      const colSums = Array(SIZE).fill(0);
      let rowSumValue = 0;
      let kept = 0;

      for (let col = 0; col < SIZE; col += 1) {
        if ((mask & (1 << col)) === 0) continue;
        rowSumValue += row[col];
        colSums[col] = row[col];
        kept += 1;
      }

      if (rowSumValue === puzzleToValidate.rowTargets[rowIndex] && kept > 0 && kept < SIZE) {
        options.push(colSums);
      }
    }

    return options;
  });

  let solutionCount = 0;

  function search(rowIndex, sums) {
    if (solutionCount > 1) return;

    if (rowIndex === SIZE) {
      if (sums.every((sum, col) => sum === puzzleToValidate.colTargets[col])) {
        solutionCount += 1;
      }
      return;
    }

    for (const option of rowOptions[rowIndex]) {
      const nextSums = sums.map((sum, col) => sum + option[col]);
      if (nextSums.some((sum, col) => sum > puzzleToValidate.colTargets[col])) continue;
      search(rowIndex + 1, nextSums);
    }
  }

  search(0, Array(SIZE).fill(0));
  return solutionCount === 1;
}

async function loadPuzzleFile() {
  const response = await fetch("puzzles.json", { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo cargar puzzles.json.");
  return response.json();
}

async function loadDailyPuzzle() {
  const key = todayKey();

  try {
    const data = await loadPuzzleFile();
    if (data.size !== SIZE || !data.puzzles || typeof data.puzzles !== "object") {
      throw new Error("El archivo de retos no tiene el formato esperado.");
    }

    const dates = Object.keys(data.puzzles).sort();
    const date = data.puzzles[key] ? key : dates[(challengeNumber() - 1) % dates.length];
    const puzzleFromFile = normalizePuzzle(data.puzzles[date]);

    if (!isStrongPuzzle(puzzleFromFile) || !hasUniqueSolution(puzzleFromFile)) {
      throw new Error(`El reto ${date} no pasa la validacion.`);
    }

    puzzleDate = date;
    return puzzleFromFile;
  } catch {
    puzzleDate = key;
    return generatePuzzle(key);
  }
}

function storageKey() {
  return `sumply:${puzzleDate}`;
}

function emptyStates() {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => "neutral"));
}

function loadState() {
  const saved = localStorage.getItem(storageKey());
  if (!saved) {
    cellStates = emptyStates();
    elapsedMs = 0;
    completed = false;
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    cellStates = parsed.cellStates || emptyStates();
    if (Number.isFinite(parsed.elapsedMs)) {
      elapsedMs = parsed.elapsedMs;
    } else {
      elapsedMs = Number.isFinite(parsed.elapsed) ? parsed.elapsed * 1000 : 0;
    }
    completed = Boolean(parsed.completed);
  } catch {
    cellStates = emptyStates();
    elapsedMs = 0;
    completed = false;
  }
}

function saveState() {
  localStorage.setItem(storageKey(), JSON.stringify({ cellStates, elapsedMs, completed }));
}

function formatTime(milliseconds) {
  const totalCentiseconds = Math.floor(milliseconds / 10);
  const mins = Math.floor(totalCentiseconds / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function rowSum(row) {
  return puzzle.values[row].reduce((sum, value, col) => sum + (cellStates[row][col] === "cross" ? 0 : value), 0);
}

function colSum(col) {
  return puzzle.values.reduce((sum, row, rowIndex) => sum + (cellStates[rowIndex][col] === "cross" ? 0 : row[col]), 0);
}

function createClue({ kind, index, target, sum }) {
  const isDone = sum === target;
  const clue = document.createElement("div");
  clue.className = `clue ${isDone ? "done" : ""}`;

  if (kind === "row") {
    clue.style.gridRow = index + 1;
    clue.style.gridColumn = SIZE + 2;
    clue.setAttribute("aria-label", `Objetivo de fila ${index + 1}: ${target}. Suma actual: ${sum}`);
  } else {
    clue.style.gridRow = SIZE + 2;
    clue.style.gridColumn = index + 1;
    clue.setAttribute("aria-label", `Objetivo de columna ${index + 1}: ${target}. Suma actual: ${sum}`);
  }

  if (!isDone) {
    clue.innerHTML = `<span>${target}</span>`;
    return clue;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "clue-button";
  button.textContent = target;
  button.setAttribute("aria-label", `Confirmar ${kind === "row" ? "fila" : "columna"} ${index + 1}`);
  button.addEventListener("click", () => confirmLine(kind, index));
  clue.append(button);
  return clue;
}

function renderBoard() {
  boardEl.innerHTML = "";

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const button = document.createElement("button");
      button.type = "button";
      const stateClass = cellStates[row][col] === "neutral" ? "" : cellStates[row][col];
      const edgeClasses = [
        row === 0 ? "top-edge" : "",
        row === SIZE - 1 ? "bottom-edge" : "",
        col === 0 ? "left-edge" : "",
        col === SIZE - 1 ? "right-edge" : ""
      ].filter(Boolean).join(" ");
      button.className = `cell ${stateClass} ${edgeClasses}`;
      button.style.gridRow = row + 1;
      button.style.gridColumn = col + 1;
      button.textContent = puzzle.values[row][col];
      button.dataset.row = row;
      button.dataset.col = col;
      button.setAttribute("aria-label", `Fila ${row + 1}, columna ${col + 1}, valor ${puzzle.values[row][col]}`);
      button.addEventListener("click", () => cycleCell(row, col, button));
      boardEl.append(button);
    }

    boardEl.append(createClue({ kind: "row", index: row, target: puzzle.rowTargets[row], sum: rowSum(row) }));
  }

  for (let col = 0; col < SIZE; col += 1) {
    boardEl.append(createClue({ kind: "col", index: col, target: puzzle.colTargets[col], sum: colSum(col) }));
  }
}

function confirmLine(kind, index) {
  if (paused || completed) return;

  for (let i = 0; i < SIZE; i += 1) {
    const row = kind === "row" ? index : i;
    const col = kind === "row" ? i : index;
    if (cellStates[row][col] !== "cross") {
      cellStates[row][col] = "keep";
    }
  }

  renderBoard();
  saveState();
  checkWin();
}

function cycleCell(row, col, element) {
  if (paused || completed) return;
  const current = STATES.indexOf(cellStates[row][col]);
  cellStates[row][col] = STATES[(current + 1) % STATES.length];
  element.classList.add("hint");
  renderBoard();
  saveState();
  checkWin();
}

function checkWin() {
  const rowsDone = puzzle.rowTargets.every((target, row) => rowSum(row) === target);
  const colsDone = puzzle.colTargets.every((target, col) => colSum(col) === target);
  if (!rowsDone || !colsDone) return;

  tick();
  completed = true;
  saveState();
  stopTimer();
  winStats.textContent = formatTime(elapsedMs);
  if (!winDialog.open) winDialog.showModal();
}

async function copyResult() {
  const result = `He terminado el Sumply de hoy en ${formatTime(elapsedMs)}`;

  try {
    await navigator.clipboard.writeText(result);
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = result;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.append(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
  }

  copyResultButton.textContent = "Copiado";
  window.setTimeout(() => {
    copyResultButton.textContent = "Copiar resultado";
  }, 1400);
}

function resetDay() {
  cellStates = emptyStates();
  elapsedMs = 0;
  completed = false;
  waitingToStart = true;
  paused = true;
  timerEl.textContent = formatTime(elapsedMs);
  renderBoard();
  saveState();
  stopTimer();
  showStartPause();
}

function tick() {
  const now = Date.now();
  if (!paused && !completed) {
    const diff = now - lastTick;
    if (diff > 0) {
      elapsedMs += diff;
      lastTick = now;
      timerEl.textContent = formatTime(elapsedMs);
      saveState();
    }
  } else {
    lastTick = now;
  }
}

function startTimer() {
  stopTimer();
  lastTick = Date.now();
  timerId = window.setInterval(tick, 50);
}

function stopTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = null;
}

function openPause() {
  if (completed) return;
  tick();
  waitingToStart = elapsedMs === 0;
  paused = true;
  updatePauseDialog();
  if (!pauseDialog.open) pauseDialog.showModal();
}

function closePause() {
  const shouldStartTimer = waitingToStart || !timerId;
  waitingToStart = false;
  paused = false;
  lastTick = Date.now();
  updatePauseDialog();
  if (shouldStartTimer && !completed) startTimer();
}

function updatePauseDialog() {
  pauseTitle.textContent = waitingToStart ? "SUMPLY" : "JUEGO EN PAUSA";
  continueButton.textContent = waitingToStart ? "Jugar" : "Continuar";
  restartFromPauseButton.hidden = waitingToStart;
}

function showStartPause() {
  waitingToStart = true;
  paused = true;
  updatePauseDialog();
  if (!pauseDialog.open) pauseDialog.showModal();
}

async function init() {
  puzzle = await loadDailyPuzzle();
  challengeLabel.textContent = `Reto #${challengeNumber()}`;
  loadState();
  timerEl.textContent = formatTime(elapsedMs);
  renderBoard();
  if (!completed) {
    if (elapsedMs === 0) {
      showStartPause();
    } else {
      startTimer();
    }
  }

  document.querySelector("#pauseButtonBottom").addEventListener("click", openPause);
  continueButton.addEventListener("click", closePause);
  copyResultButton.addEventListener("click", copyResult);
  restartFromPauseButton.addEventListener("click", () => {
    pauseDialog.close();
    resetDay();
  });

  pauseDialog.addEventListener("close", () => {
    if (!completed && !waitingToStart && !timerId) closePause();
  });

  pauseDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      tick();
      stopTimer();
    } else if (!completed && !waitingToStart) {
      startTimer();
    }
  });

  document.addEventListener("gesturestart", (event) => event.preventDefault());
  document.addEventListener("gesturechange", (event) => event.preventDefault());
  document.addEventListener("gestureend", (event) => event.preventDefault());
  document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
}

init();
