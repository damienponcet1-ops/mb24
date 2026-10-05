const COLS = ["A","B","C","D","E","F","G","H","I","J","K"];
const ROWS = Array.from({ length: 18 }, (_, i) => 18 - i);

const STORAGE = {
  blocks: "moonboard2024_blocks",
  lists: "moonboard2024_lists",
  grid: "moonboard2024_grid"
};

const DEFAULT_GRID = {
  top: 5.2,
  left: 7.5,
  width: 85,
  height: 89.5
};

const BLE = {
  serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  rxUuid: "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
};

let blocks = load(STORAGE.blocks, []);
let selectedId = null;
let creationMode = false;
let creationRoute = { depart: [], progression: [], arrivee: [] };
let gridConfig = load(STORAGE.grid, DEFAULT_GRID);
let bleDevice = null;
let rxCharacteristic = null;

const $ = (id) => document.getElementById(id);

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 2400);
}

function applyGridConfig() {
  const overlay = $("gridOverlay");
  overlay.style.top = `${gridConfig.top}%`;
  overlay.style.left = `${gridConfig.left}%`;
  overlay.style.width = `${gridConfig.width}%`;
  overlay.style.height = `${gridConfig.height}%`;

  $("gridTop").value = gridConfig.top;
  $("gridLeft").value = gridConfig.left;
  $("gridWidth").value = gridConfig.width;
  $("gridHeight").value = gridConfig.height;
}

function holdId(col, row) {
  return `${col}${row}`;
}

function createGrid() {
  const overlay = $("gridOverlay");
  overlay.innerHTML = "";

  for (const row of ROWS) {
    for (const col of COLS) {
      const id = holdId(col, row);
      const cell = document.createElement("div");
      cell.className = "hold-cell";
      cell.dataset.hold = id;
      cell.title = id;
      cell.addEventListener("click", () => handleHoldClick(id));
      overlay.appendChild(cell);
    }
  }
}

function getCell(id) {
  return document.querySelector(`.hold-cell[data-hold="${CSS.escape(id)}"]`);
}

function clearBoardVisuals() {
  document.querySelectorAll(".hold-cell").forEach(cell => {
    cell.classList.remove("start", "progression", "end");
  });
}

function setRouteVisuals(route) {
  clearBoardVisuals();
  route.depart?.forEach(id => getCell(id)?.classList.add("start"));
  route.progression?.forEach(id => getCell(id)?.classList.add("progression"));
  route.arrivee?.forEach(id => getCell(id)?.classList.add("end"));
}

function handleHoldClick(id) {
  if (!creationMode) return;

  const { depart, progression, arrivee } = creationRoute;

  if (depart.includes(id)) {
    creationRoute.depart = depart.filter(x => x !== id);
    creationRoute.progression.push(id);
  } else if (progression.includes(id)) {
    creationRoute.progression = progression.filter(x => x !== id);
    creationRoute.arrivee.push(id);
  } else if (arrivee.includes(id)) {
    creationRoute.arrivee = arrivee.filter(x => x !== id);
  } else {
    creationRoute.depart.push(id);
  }

  setRouteVisuals(creationRoute);
}

function normalizeBlock(raw) {
  const moves = Array.isArray(raw.moves) ? raw.moves : [];
  const depart = raw.depart ?? moves.filter(m => m.isStart).map(m => m.description ?? m.Description ?? m);
  const arrivee = raw.arrivee ?? moves.filter(m => m.isEnd).map(m => m.description ?? m.Description ?? m);
  const progression = raw.progression ?? moves
    .filter(m => !m.isStart && !m.isEnd)
    .map(m => m.description ?? m.Description ?? m);

  return {
    id: raw.id || crypto.randomUUID(),
    name: raw.name || "Bloc sans nom",
    grade: raw.grade || "",
    benchmark: Boolean(raw.benchmark ?? raw.isBenchmark),
    method: raw.method || "",
    ascensionCount: Number(raw.ascensionCount ?? raw.ascensions ?? 0),
    setby: raw.setby || "",
    completed: Boolean(raw.completed),
    depart: [...new Set(depart)],
    progression: [...new Set(progression)],
    arrivee: [...new Set(arrivee)]
  };
}

function exportBlockFormat(block) {
  const moves = [
    ...block.depart.map(description => ({ description, isStart: true })),
    ...block.progression.map(description => ({ description })),
    ...block.arrivee.map(description => ({ description, isEnd: true }))
  ];

  return {
    name: block.name,
    grade: block.grade,
    benchmark: block.benchmark,
    method: block.method,
    ascensionCount: block.ascensionCount,
    setby: block.setby,
    moves
  };
}

function displayBlock(block) {
  selectedId = block.id;
  setRouteVisuals(block);
  renderList();
  renderSelectedInfo();

  sendRouteToESP32(block).catch(err => {
    console.warn(err);
  });
}


function getVisibleBlocks() {
  const query = $("searchInput").value.trim().toLowerCase();
  const benchmarkOnly = $("benchmarkOnly").checked;
  const completedOnly = $("completedOnly").checked;
  const sort = $("sortSelect").value;

  let visible = blocks.filter(block => {
    if (benchmarkOnly && !block.benchmark) return false;
    if (completedOnly && !block.completed) return false;
    return !query || block.name.toLowerCase().includes(query);
  });

  visible.sort((a, b) => {
    if (sort === "grade") return a.grade.localeCompare(b.grade, "fr");
    if (sort === "ascensions") return b.ascensionCount - a.ascensionCount;
    return a.name.localeCompare(b.name, "fr", { numeric: true });
  });
  return visible;
}

function renderMobileControls() {
  const visible = getVisibleBlocks();
  const select = $("routeSelect");
  const current = selectedId;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = visible.length ? "Choisir un bloc…" : "Aucun bloc";
  select.appendChild(empty);

  visible.forEach(block => {
    const option = document.createElement("option");
    option.value = block.id;
    option.textContent = `${block.name} (${block.grade || "—"})`;
    select.appendChild(option);
  });
  select.value = visible.some(b => b.id === current) ? current : "";

  const selected = blocks.find(b => b.id === selectedId);
  $("pagerName").textContent = selected?.name || "Aucun bloc";
  $("selectedGrade").textContent = selected?.grade || "—";
  $("selectedSetter").textContent = selected?.setby || "—";
  $("selectedAscensions").textContent = selected?.ascensionCount ?? 0;
  $("ascensionProgress").textContent = selected
    ? `${selected.completed ? selected.ascensionCount : 0}/${selected.ascensionCount}`
    : "0/0";

  $("completedBtn").classList.toggle("completed", Boolean(selected?.completed));
}

function visibleIndex() {
  const visible = getVisibleBlocks();
  return visible.findIndex(b => b.id === selectedId);
}

function selectRelative(delta) {
  const visible = getVisibleBlocks();
  if (!visible.length) return;
  let index = visibleIndex();
  if (index < 0) index = delta > 0 ? 0 : visible.length - 1;
  else index = (index + delta + visible.length) % visible.length;
  displayBlock(visible[index]);
}

function renderList() {
  const query = $("searchInput").value.trim().toLowerCase();
  const benchmarkOnly = $("benchmarkOnly").checked;
  const completedOnly = $("completedOnly").checked;
  const sort = $("sortSelect").value;

  let visible = blocks.filter(block => {
    if (benchmarkOnly && !block.benchmark) return false;
    if (completedOnly && !block.completed) return false;
    return !query || block.name.toLowerCase().includes(query);
  });

  visible.sort((a, b) => {
    if (sort === "grade") return a.grade.localeCompare(b.grade, "fr");
    if (sort === "ascensions") return b.ascensionCount - a.ascensionCount;
    return a.name.localeCompare(b.name, "fr", { numeric: true });
  });

  $("blockCount").textContent = visible.length;
  const list = $("blockList");
  list.innerHTML = "";

  for (const block of visible) {
    const item = document.createElement("div");
    item.className = `block-item ${block.id === selectedId ? "selected" : ""}`;

    const main = document.createElement("div");
    main.innerHTML = `
      <div class="block-name">${escapeHtml(block.name)}</div>
      <div class="block-meta">${escapeHtml(block.grade)} · ${block.ascensionCount} ascension(s)</div>
    `;

    const badge = document.createElement("div");
    badge.className = `badge ${block.benchmark ? "benchmark" : ""}`;
    badge.textContent = block.benchmark ? "Benchmark" : (block.completed ? "✓" : "");

    item.append(main, badge);
    item.addEventListener("click", () => displayBlock(block));
    list.appendChild(item);
  }
  renderMobileControls();
}

function renderSelectedInfo() {
  const block = blocks.find(b => b.id === selectedId);
  const info = $("selectedInfo");

  if (!block) {
    info.className = "selected-info empty";
    info.textContent = "Aucun bloc sélectionné.";
    return;
  }

  info.className = "selected-info";
  info.innerHTML = `
    <strong>${escapeHtml(block.name)}</strong><br>
    Cotation : ${escapeHtml(block.grade || "—")}<br>
    Départ : ${block.depart.join(", ") || "—"}<br>
    Progression : ${block.progression.join(", ") || "—"}<br>
    Arrivée : ${block.arrivee.join(", ") || "—"}<br>
    Setter : ${escapeHtml(block.setby || "—")}<br>
  `;
  renderMobileControls();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function startCreation() {
  creationMode = true;
  creationRoute = { depart: [], progression: [], arrivee: [] };
  $("creationBanner").classList.remove("hidden");
  setRouteVisuals(creationRoute);
}

function cancelCreation() {
  creationMode = false;
  creationRoute = { depart: [], progression: [], arrivee: [] };
  $("creationBanner").classList.add("hidden");
  if (selectedId) {
    const block = blocks.find(b => b.id === selectedId);
    if (block) setRouteVisuals(block);
    else clearBoardVisuals();
  } else {
    clearBoardVisuals();
  }
}

function saveCreation() {
  if (!creationRoute.depart.length || !creationRoute.arrivee.length) {
    toast("Il faut au moins un départ et une arrivée.");
    return;
  }
  $("blockDialog").showModal();
}

function confirmCreation(event) {
  event.preventDefault();

  const block = normalizeBlock({
    name: $("blockName").value.trim(),
    grade: $("blockGrade").value.trim(),
    method: $("blockMethod").value.trim(),
    setby: $("blockSetter").value.trim(),
    ascensionCount: Number($("blockAscensions").value || 0),
    benchmark: $("blockBenchmark").checked,
    depart: creationRoute.depart,
    progression: creationRoute.progression,
    arrivee: creationRoute.arrivee
  });

  blocks.push(block);
  save(STORAGE.blocks, blocks);
  $("blockDialog").close();
  creationMode = false;
  $("creationBanner").classList.add("hidden");
  displayBlock(block);
  toast("Bloc créé.");
}

function routeToMessage(block) {
  const parts = [
    ...(block.depart || []).map(id => `${id}:S`),
    ...(block.progression || []).map(id => `${id}:P`),
    ...(block.arrivee || []).map(id => `${id}:E`)
  ];
  return parts.length ? parts.join(",") : "CLEAR";
}

async function sendBleMessage(message) {
  if (!rxCharacteristic) return;
  await rxCharacteristic.writeValue(new TextEncoder().encode(message));
}

async function sendRouteToESP32(block) {
  if (!rxCharacteristic) return;
  await sendBleMessage("CLEAR");
  await new Promise(resolve => setTimeout(resolve, 50));
  await sendBleMessage(routeToMessage(block));
}

async function clearLeds() {
  try {
    await sendBleMessage("CLEAR");
    toast("LEDs éteintes.");
  } catch {
    toast("ESP32 non connecté.");
  }
}

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    toast("Web Bluetooth n'est pas disponible dans ce navigateur.");
    return;
  }

  try {
    $("connectBtn").disabled = true;
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "MoonBoard" }],
      optionalServices: [BLE.serviceUuid]
    });

    bleDevice.addEventListener("gattserverdisconnected", onBleDisconnected);

    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(BLE.serviceUuid);
    rxCharacteristic = await service.getCharacteristic(BLE.rxUuid);

    $("bleStatus").textContent = `Connecté : ${bleDevice.name || "MoonBoard"}`;
    $("bleStatus").className = "status connected";
    $("connectBtn").textContent = "Reconnecter";
    toast("Bluetooth connecté.");

    const block = blocks.find(b => b.id === selectedId);
    if (block) await sendRouteToESP32(block);
  } catch (error) {
    console.error(error);
    toast("Connexion Bluetooth annulée ou impossible.");
  } finally {
    $("connectBtn").disabled = false;
  }
}

function onBleDisconnected() {
  rxCharacteristic = null;
  $("bleStatus").textContent = "Bluetooth déconnecté";
  $("bleStatus").className = "status disconnected";
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportBlocks() {
  downloadJson("moonboard_2024_blocks.json", blocks.map(exportBlockFormat));
  toast("Export JSON créé.");
}

function exportBackup() {
  downloadJson("moonboard_2024_backup.json", {
    version: 1,
    board: "MoonBoard 2024",
    blocks: blocks,
    lists: load(STORAGE.lists, []),
    gridConfig
  });
  toast("Sauvegarde complète créée.");
}

function importJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const source = Array.isArray(parsed) ? parsed : (parsed.data || parsed.blocks || [parsed]);
      blocks = source.map(normalizeBlock);
      if (parsed.gridConfig) {
        gridConfig = { ...DEFAULT_GRID, ...parsed.gridConfig };
        save(STORAGE.grid, gridConfig);
        applyGridConfig();
      }
      save(STORAGE.blocks, blocks);
      selectedId = null;
      clearBoardVisuals();
      renderList();
      renderSelectedInfo();
      toast(`${blocks.length} bloc(s) importé(s).`);
    } catch (error) {
      console.error(error);
      toast("JSON invalide.");
    }
  };
  reader.readAsText(file);
}

$("createBtn").addEventListener("click", startCreation);
$("cancelCreateBtn").addEventListener("click", cancelCreation);
$("saveCreateBtn").addEventListener("click", saveCreation);
$("confirmBlockBtn").addEventListener("click", confirmCreation);
$("clearBtn").addEventListener("click", clearLeds);
$("connectBtn").addEventListener("click", connectBluetooth);

$("gridBtn").addEventListener("click", () => {
  $("gridPanel").classList.toggle("hidden");
});

$("saveGridBtn").addEventListener("click", () => {
  gridConfig = {
    top: Number($("gridTop").value),
    left: Number($("gridLeft").value),
    width: Number($("gridWidth").value),
    height: Number($("gridHeight").value)
  };
  save(STORAGE.grid, gridConfig);
  applyGridConfig();
  toast("Position de la grille enregistrée.");
});

$("searchInput").addEventListener("input", renderList);
$("sortSelect").addEventListener("change", renderList);
$("benchmarkOnly").addEventListener("change", renderList);
$("completedOnly").addEventListener("change", renderList);

$("exportBtn").addEventListener("click", exportBlocks);
$("backupBtn").addEventListener("click", exportBackup);
$("importBtn").addEventListener("click", () => $("fileInput").click());
$("restoreBtn").addEventListener("click", () => $("fileInput").click());

$("fileInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importJsonFile(file);
  event.target.value = "";
});


$("routeSelect").addEventListener("change", e => {
  const block = blocks.find(b => b.id === e.target.value);
  if (block) displayBlock(block);
});
$("searchOpenBtn").addEventListener("click", () => $("searchPanel").classList.toggle("hidden"));
$("prevBtn").addEventListener("click", () => selectRelative(-1));
$("nextBtn").addEventListener("click", () => selectRelative(1));
$("addBtn").addEventListener("click", startCreation);
$("completedBtn").addEventListener("click", () => {
  const block = blocks.find(b => b.id === selectedId);
  if (!block) return;
  block.completed = !block.completed;
  save(STORAGE.blocks, blocks);
  renderList();
  renderSelectedInfo();
});
$("menuBtn").addEventListener("click", () => $("drawer").classList.remove("hidden"));
$("drawerClose").addEventListener("click", () => $("drawer").classList.add("hidden"));

createGrid();
applyGridConfig();
renderList();
renderSelectedInfo();
