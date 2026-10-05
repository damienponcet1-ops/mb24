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

let blocks = [];
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

function getLists() {
  const value = load(STORAGE.lists, []);
  return Array.isArray(value) ? value : [];
}

function saveLists(lists) {
  save(STORAGE.lists, lists);
}

function currentListId() {
  return $("listFilter")?.value || "";
}

function blockInList(block, listId) {
  if (!listId) return true;
  const list = getLists().find(item => item.id === listId);
  return !!list && Array.isArray(list.blockIds) && list.blockIds.includes(block.id);
}

function refreshListFilter() {
  const select = $("listFilter");
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Toutes les listes";
  select.appendChild(all);
  getLists().forEach(list => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = `${list.name} (${list.blockIds.length})`;
    select.appendChild(option);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function renderListChoices() {
  const wrap = $("listChoices");
  if (!wrap) return;
  const block = blocks.find(b => b.id === selectedId);
  if (!block) {
    wrap.innerHTML = '<div class="list-empty">Aucun bloc sélectionné.</div>';
    return;
  }
  const lists = getLists();
  if (!lists.length) {
    wrap.innerHTML = '<div class="list-empty">Aucune liste. Crée-en une ci-dessous.</div>';
    return;
  }
  wrap.innerHTML = "";
  lists.forEach(list => {
    const row = document.createElement("label");
    row.className = "list-choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = list.blockIds.includes(block.id);
    input.addEventListener("change", () => {
      const allLists = getLists();
      const target = allLists.find(item => item.id === list.id);
      if (!target) return;
      target.blockIds = Array.isArray(target.blockIds) ? target.blockIds : [];
      if (input.checked) {
        if (!target.blockIds.includes(block.id)) target.blockIds.push(block.id);
      } else {
        target.blockIds = target.blockIds.filter(id => id !== block.id);
      }
      saveLists(allLists);
      refreshListFilter();
      renderList();
      renderListChoices();
      toast(input.checked ? `Ajouté à « ${list.name} »` : `Retiré de « ${list.name} »`);
    });
    const name = document.createElement("span");
    name.textContent = list.name;
    const count = document.createElement("small");
    count.textContent = `${list.blockIds.length}`;
    row.append(input, name, count);
    wrap.appendChild(row);
  });
}

function openListDialog() {
  if (!selectedId) { toast("Sélectionne d'abord un bloc."); return; }
  renderListChoices();
  $("newListName").value = "";
  $("listDialog").showModal();
}

function createListFromDialog() {
  const input = $("newListName");
  const name = input.value.trim();
  if (!name) { toast("Donne un nom à la liste."); return; }
  const lists = getLists();
  const exists = lists.some(list => list.name.toLowerCase() === name.toLowerCase());
  if (exists) { toast("Cette liste existe déjà."); return; }
  const list = { id: `list-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name, blockIds: [] };
  if (selectedId) list.blockIds.push(selectedId);
  lists.push(list);
  saveLists(lists);
  refreshListFilter();
  renderListChoices();
  input.value = "";
  toast(`Liste « ${name} » créée`);
}

const BLOCK_DB_NAME = "moonboard2024_db";
const BLOCK_DB_VERSION = 1;
const BLOCK_STORE = "blocks";

function openBlockDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB non disponible"));
    const req = indexedDB.open(BLOCK_DB_NAME, BLOCK_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BLOCK_STORE)) db.createObjectStore(BLOCK_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Ouverture IndexedDB impossible"));
  });
}

async function loadBlocks() {
  try {
    const db = await openBlockDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOCK_STORE, "readonly");
      const req = tx.objectStore(BLOCK_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("IndexedDB indisponible, tentative localStorage", e);
    return load(STORAGE.blocks, []);
  }
}

async function persistBlocks(value, onProgress) {
  const db = await openBlockDB();
  const CHUNK = 250;
  await new Promise((resolve, reject) => {
    const clearTx = db.transaction(BLOCK_STORE, "readwrite");
    const store = clearTx.objectStore(BLOCK_STORE);
    const req = store.clear();
    clearTx.oncomplete = resolve;
    clearTx.onerror = () => reject(clearTx.error || new Error("Impossible de vider IndexedDB"));
    clearTx.onabort = () => reject(clearTx.error || new Error("Vidage IndexedDB interrompu"));
    req.onerror = () => reject(req.error || new Error("Erreur lors du vidage IndexedDB"));
  });

  for (let offset = 0; offset < value.length; offset += CHUNK) {
    const part = value.slice(offset, offset + CHUNK);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BLOCK_STORE, "readwrite");
      const store = tx.objectStore(BLOCK_STORE);
      for (const block of part) store.put(block);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error(`Écriture IndexedDB impossible (${offset + part.length}/${value.length})`));
      tx.onabort = () => reject(tx.error || new Error(`Écriture IndexedDB interrompue (${offset + part.length}/${value.length})`));
    });
    onProgress?.(Math.min(offset + part.length, value.length), value.length);
    await new Promise(requestAnimationFrame);
  }
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
  $("gridTopValue").textContent = `${gridConfig.top.toFixed(1)}%`;
  $("gridLeftValue").textContent = `${gridConfig.left.toFixed(1)}%`;
  $("gridWidthValue").textContent = `${gridConfig.width.toFixed(1)}%`;
  $("gridHeightValue").textContent = `${gridConfig.height.toFixed(1)}%`;
}

function setGridEditing(enabled) {
  $("boardContainer").classList.toggle("grid-editing", enabled);
  $("gridPanel").classList.toggle("hidden", !enabled);
}

function updateGridPreview() {
  gridConfig = {
    top: Number($("gridTop").value),
    left: Number($("gridLeft").value),
    width: Number($("gridWidth").value),
    height: Number($("gridHeight").value)
  };
  applyGridConfig();
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

function normalizeBlock(raw, index = 0) {
  const moves = Array.isArray(raw.moves) ? raw.moves : [];
  const depart = raw.depart ?? moves.filter(m => m.isStart).map(m => m.description ?? m.Description ?? m);
  const arrivee = raw.arrivee ?? moves.filter(m => m.isEnd).map(m => m.description ?? m.Description ?? m);
  const progression = raw.progression ?? moves
    .filter(m => !m.isStart && !m.isEnd)
    .map(m => m.description ?? m.Description ?? m);

  return {
    id: raw.id || `mb2024-${index + 1}`,
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
  const hideCompleted = $("hideCompleted")?.checked;
  const gradeFilter = $("gradeFilter")?.value || "";
  const listId = currentListId();
  const sort = $("sortSelect").value;

  let visible = blocks.filter(block => {
    if (benchmarkOnly && !block.benchmark) return false;
    if (completedOnly && !block.completed) return false;
    if (hideCompleted && block.completed) return false;
    if (gradeFilter && block.grade !== gradeFilter) return false;
    if (!blockInList(block, listId)) return false;
    return !query || block.name.toLowerCase().includes(query);
  });

  visible.sort((a, b) => {
    if (sort === "grade") return a.grade.localeCompare(b.grade, "fr");
    if (sort === "name") return a.name.localeCompare(b.name, "fr", { numeric: true });
    return b.ascensionCount - a.ascensionCount;
  });
  return visible;
}

function hasActiveFilters() {
  return Boolean(
    $("searchInput").value.trim() ||
    $("benchmarkOnly").checked ||
    $("completedOnly").checked ||
    $("hideCompleted").checked ||
    Boolean($("gradeFilter")?.value) ||
    Boolean(currentListId())
  );
}

function methodBadge(method) {
  const value = String(method || "").trim();
  const key = value.toLowerCase();
  if (key === "no kickboard") return '<span class="rule-badge no-kickboard">No Kickboard</span>';
  if (key === "any marked holds") return '<span class="rule-badge any-marked">Any marked holds</span>';
  if (key === "footless") return '<span class="rule-badge footless">Footless</span>';
  if (key === "footless + kickboard") return '<span class="rule-badge footless-kickboard">Footless + Kickboard</span>';
  return "";
}

function renderSelectedBadges(block) {
  const el = $("selectedBadges");
  if (!el) return;
  if (!block) {
    el.innerHTML = "";
    return;
  }
  const badges = [];
  if (block.benchmark) badges.push('<span class="rule-badge benchmark-badge">B</span>');
  const method = methodBadge(block.method);
  if (method) badges.push(method);
  el.innerHTML = badges.join("");
}

function renderResultsCount(visibleCount) {
  const total = blocks.length;
  const filtered = $("filteredCount");
  const totalEl = $("totalCount");
  if (totalEl) totalEl.textContent = `${total.toLocaleString("fr-FR")} blocs au total`;
  if (filtered) {
    const active = hasActiveFilters();
    filtered.textContent = `${visibleCount.toLocaleString("fr-FR")} blocs filtrés`;
    filtered.classList.toggle("hidden", !active);
  }
}

function renderMobileControls() {
  const visible = getVisibleBlocks();
  const uiVisible = visible.slice(0, 300);
  const select = $("routeSelect");
  const current = selectedId;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = visible.length ? "Choisir un bloc…" : "Aucun bloc";
  select.appendChild(empty);

  uiVisible.forEach(block => {
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
  renderSelectedBadges(selected);
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
  refreshListFilter();
  const visible = getVisibleBlocks();

  $("blockCount").textContent = visible.length;
  renderResultsCount(visible.length);
  const list = $("blockList");
  if (list) {
    list.innerHTML = "";
    for (const block of visible.slice(0, 300)) {
      const item = document.createElement("div");
      item.className = `block-item ${block.id === selectedId ? "selected" : ""}`;
      item.innerHTML = `
        <div>
          <div class="block-name">${escapeHtml(block.name)}</div>
          <div class="block-meta">${escapeHtml(block.grade)} · ${block.ascensionCount} ascension(s)</div>
        </div>
        <div class="badge ${block.benchmark ? "benchmark" : ""}">${block.benchmark ? "Benchmark" : (block.completed ? "✓" : "")}</div>
      `;
      item.addEventListener("click", () => displayBlock(block));
      list.appendChild(item);
    }
  }
  renderMobileControls();
}

function renderSelectedInfo() {
  const block = blocks.find(b => b.id === selectedId);
  const info = $("selectedInfo");

  if (info) {
    if (!block) {
      info.className = "selected-info empty";
      info.textContent = "Aucun bloc sélectionné.";
    } else {
      info.className = "selected-info";
      info.innerHTML = `
        <strong>${escapeHtml(block.name)}</strong><br>
        Cotation : ${escapeHtml(block.grade || "—")}<br>
        Départ : ${block.depart.join(", ") || "—"}<br>
        Progression : ${block.progression.join(", ") || "—"}<br>
        Arrivée : ${block.arrivee.join(", ") || "—"}<br>
        Setter : ${escapeHtml(block.setby || "—")}<br>
      `;
    }
  }
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
  persistBlocks(blocks).catch(error => { console.error(error); toast("Erreur de sauvegarde des blocs."); });
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
  reader.onload = async () => {
    const setStatus = (msg) => {
      console.log("[IMPORT]", msg);
      toast(msg);
    };
    try {
      setStatus("Lecture du JSON…");
      const parsed = JSON.parse(reader.result);
      const source = Array.isArray(parsed) ? parsed : (parsed.data || parsed.blocks || [parsed]);
      if (!Array.isArray(source)) throw new Error("Structure invalide : attendu un tableau de blocs ou {data:[…]}");
      if (!source.length) throw new Error("Le fichier contient 0 bloc");
      setStatus(`JSON valide : ${source.length.toLocaleString("fr-FR")} blocs. Préparation…`);

      const normalized = new Array(source.length);
      for (let i = 0; i < source.length; i++) {
        const raw = source[i];
        if (!raw || typeof raw !== "object") throw new Error(`Bloc #${i + 1} invalide : ce n'est pas un objet`);
        normalized[i] = normalizeBlock(raw, i);
        if (!normalized[i].name) throw new Error(`Bloc #${i + 1} sans nom`);
        if (i % 1000 === 0) await new Promise(requestAnimationFrame);
      }

      setStatus(`JSON valide. Sauvegarde de ${normalized.length.toLocaleString("fr-FR")} blocs…`);
      await persistBlocks(normalized, (done, total) => {
        if (done === total || done % 2000 === 0) setStatus(`Sauvegarde : ${done.toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")}`);
      });

      blocks = normalized;
      if (parsed && parsed.gridConfig) {
        gridConfig = { ...DEFAULT_GRID, ...parsed.gridConfig };
        save(STORAGE.grid, gridConfig);
        applyGridConfig();
      }
      selectedId = null;
      clearBoardVisuals();
      renderList();
      renderSelectedInfo();
      setStatus(`Import réussi : ${blocks.length.toLocaleString("fr-FR")} blocs.`);
    } catch (error) {
      console.error("[IMPORT ERROR]", error);
      const name = error?.name ? `${error.name} — ` : "";
      const message = error?.message || String(error) || "Erreur inconnue";
      toast(`Import échoué : ${name}${message}`);
      alert(`IMPORT ÉCHOUÉ\n\n${name}${message}\n\nOuvre la console si tu veux le détail technique.`);
    }
  };
  reader.onerror = () => {
    const msg = reader.error?.message || "Impossible de lire le fichier";
    toast(`Lecture du fichier impossible : ${msg}`);
    alert(`LECTURE DU FICHIER IMPOSSIBLE\n\n${msg}`);
  };
  reader.readAsText(file);
}

$("createBtn").addEventListener("click", () => {
  closeDrawer();
  startCreation();
});
$("cancelCreateBtn").addEventListener("click", cancelCreation);
$("saveCreateBtn").addEventListener("click", saveCreation);
$("confirmBlockBtn").addEventListener("click", confirmCreation);
$("clearBtn").addEventListener("click", clearDatabase);
$("connectBtn").addEventListener("click", connectBluetooth);

$("gridBtn").addEventListener("click", () => {
  closeDrawer();
  setGridEditing(true);
});

["gridTop", "gridLeft", "gridWidth", "gridHeight"].forEach(id => {
  $(id).addEventListener("input", updateGridPreview);
});

$("resetGridBtn").addEventListener("click", () => {
  gridConfig = { ...DEFAULT_GRID };
  applyGridConfig();
});

$("saveGridBtn").addEventListener("click", () => {
  save(STORAGE.grid, gridConfig);
  setGridEditing(false);
  toast("Position de la grille enregistrée.");
});

$("searchInput").addEventListener("input", renderList);
$("sortSelect").addEventListener("change", renderList);
$("benchmarkOnly").addEventListener("change", renderList);
$("completedOnly").addEventListener("change", renderList);
$("gradeFilter").addEventListener("change", renderList);
$("listFilter").addEventListener("change", renderList);

$("exportBtn").addEventListener("click", exportBlocks);
$("backupBtn").addEventListener("click", exportBackup);
$("importBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importJsonFile(file);
  event.target.value = "";
});

$("pasteBtn").addEventListener("click", pasteJson);
$("deleteBtn").addEventListener("click", deleteSelectedBlock);

$("sortPopularity").addEventListener("change", () => {
  if ($("sortPopularity").checked) {
    $("sortAlphabetical").checked = false;
    $("sortSelect").value = "ascensions";
    renderList();
  }
});
$("sortAlphabetical").addEventListener("change", () => {
  if ($("sortAlphabetical").checked) {
    $("sortPopularity").checked = false;
    $("sortSelect").value = "name";
    renderList();
  }
});
$("benchmarkFilter").addEventListener("change", e => {
  $("benchmarkOnly").checked = e.target.checked;
  renderList();
});
$("completedFilter").addEventListener("change", e => {
  $("completedOnly").checked = e.target.checked;
  if (e.target.checked) $("hideCompleted").checked = false;
  renderList();
});
$("hideCompleted").addEventListener("change", e => {
  if (e.target.checked) {
    $("completedOnly").checked = false;
    $("completedFilter").checked = false;
  }
  renderList();
});

$("routeSelect").addEventListener("change", e => {
  const block = blocks.find(b => b.id === e.target.value);
  if (block) displayBlock(block);
});
$("searchOpenBtn").addEventListener("click", () => $("searchPanel").classList.toggle("hidden"));
$("prevBtn").addEventListener("click", () => selectRelative(-1));
$("nextBtn").addEventListener("click", () => selectRelative(1));
$("addBtn").addEventListener("click", openListDialog);
$("createListBtn").addEventListener("click", createListFromDialog);
$("completedBtn").addEventListener("click", () => {
  const block = blocks.find(b => b.id === selectedId);
  if (!block) return;
  block.completed = !block.completed;
  persistBlocks(blocks).catch(error => { console.error(error); toast("Erreur de sauvegarde des blocs."); });
  renderList();
  renderSelectedInfo();
});

function openDrawer() {
  $("drawer").classList.remove("hidden");
  $("drawerBackdrop").classList.remove("hidden");
}

function closeDrawer() {
  $("drawer").classList.add("hidden");
  $("drawerBackdrop").classList.add("hidden");
}

$("menuBtn").addEventListener("click", openDrawer);
$("drawerClose").addEventListener("click", closeDrawer);
$("drawerBackdrop").addEventListener("click", closeDrawer);

function deleteSelectedBlock() {
  const block = blocks.find(b => b.id === selectedId);
  if (!block) { toast("Aucun bloc affiché."); return; }
  if (!confirm(`Supprimer « ${block.name} » ?`)) return;
  blocks = blocks.filter(b => b.id !== selectedId);
  selectedId = null;
  persistBlocks(blocks).catch(error => { console.error(error); toast("Erreur de sauvegarde des blocs."); });
  clearBoardVisuals();
  renderList();
  renderSelectedInfo();
  closeDrawer();
  toast("Bloc supprimé.");
}

function clearDatabase() {
  if (!blocks.length) { toast("La base est déjà vide."); return; }
  if (!confirm("Vider toute la base des blocs ? Cette action est irréversible.")) return;
  blocks = [];
  selectedId = null;
  persistBlocks(blocks).catch(error => { console.error(error); toast("Erreur de sauvegarde des blocs."); });
  clearBoardVisuals();
  renderList();
  renderSelectedInfo();
  closeDrawer();
  toast("Base vidée.");
}

async function pasteJson() {
  const raw = prompt("Colle ici ton JSON de blocs :");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : (parsed.data || parsed.blocks || [parsed]);
    blocks = source.map((raw, index) => normalizeBlock(raw, index));
    await persistBlocks(blocks);
    if (parsed.gridConfig) {
      gridConfig = { ...DEFAULT_GRID, ...parsed.gridConfig };
      save(STORAGE.grid, gridConfig);
      applyGridConfig();
    }
    selectedId = null;
    clearBoardVisuals();
    renderList();
    renderSelectedInfo();
    closeDrawer();
    toast(`${blocks.length} bloc(s) importé(s).`);
  } catch (error) {
    console.error(error);
    toast(`Import impossible : ${error?.message || "JSON ou stockage indisponible"}`);
  }
}

async function initMoonboardApp() {
  blocks = await loadBlocks();
  refreshListFilter();
  createGrid();
  applyGridConfig();
  renderList();
  renderSelectedInfo();
}

initMoonboardApp().catch(error => {
  console.error(error);
  createGrid();
  applyGridConfig();
  renderList();
  renderSelectedInfo();
  toast("Impossible de charger la base des blocs.");
});


// --- Robust UI wiring for GitHub Pages / mobile browsers ---
// These globals make the two critical menu actions available even when the
// page is interacted with before the rest of the UI has finished rendering.
window.moonboardStartCreation = startCreation;
window.moonboardOpenGridEditor = function () {
  closeDrawer();
  setGridEditing(true);
  applyGridConfig();
  const panel = $("gridPanel");
  requestAnimationFrame(() => panel.scrollIntoView({ behavior: "smooth", block: "start" }));
};

// Use direct onclick handlers for the two menu actions so they cannot be
// broken by a duplicated/old listener after a GitHub Pages update.
$("createBtn").onclick = () => {
  closeDrawer();
  startCreation();
  requestAnimationFrame(() => $("creationBanner").scrollIntoView({ behavior: "smooth", block: "nearest" }));
};
$("gridBtn").onclick = () => window.moonboardOpenGridEditor();
$("addBtn").onclick = () => openListDialog();
