const REPO = "dammeiosvn/iDevice-Screenshort";
const TYPES = [
  { id: "iphone", name: "iPhone" },
  { id: "ipad", name: "iPad" },
  { id: "macbook", name: "MacBook" },
  { id: "watch", name: "Watch" }
];
const KEY = "iscreenshort-pref";
const $ = (id) => document.getElementById(id);
const view = $("view");
const vctx = view.getContext("2d");
const holes = new Map();
const images = new Map();
const masks = new Map();
let devices = [];
let shots = [];
let bgPhoto = null;
let state = { type: "iphone", deviceName: "", colorName: "", orient: "Portrait", mode: "fill", index: 0, panX: 0.5, panY: 0.5, zoom: 1 };
let raf = 0;
let painting = false;

function familyId(folder) {
  const key = folder.toLowerCase();
  if (key.includes("ipad")) return "ipad";
  if (key.includes("mac")) return "macbook";
  if (key.includes("watch")) return "watch";
  return "iphone";
}
function loadImage(src) {
  if (images.has(src)) return images.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  images.set(src, p);
  return p;
}
function maskAlpha(img, key) {
  if (masks.has(key)) return masks.get(key);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 255; }
  x.putImageData(data, 0, 0);
  masks.set(key, c);
  return c;
}
function measureHole(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const { data, width: w, height: h } = x.getImageData(0, 0, c.width, c.height);
  const A = (px, py) => data[(py * w + px) * 4 + 3];
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 3) for (let px = 0; px < w; px += 3) if (A(px, y) > 40) {
    if (px < x0) x0 = px; if (y < y0) y0 = y; if (px > x1) x1 = px; if (y > y1) y1 = y;
  }
  const ym = (y0 + y1) >> 1, xm = (x0 + x1) >> 1;
  const edge = (from, to, step, read) => {
    let seen = false;
    for (let i = from; step > 0 ? i < to : i > to; i += step) {
      const v = read(i);
      if (v > 40) seen = true;
      else if (seen && v < 16) return i;
    }
    return from;
  };
  const holeL = edge(x0, x1, 1, (px) => A(px, ym));
  const holeR = edge(x1, x0, -1, (px) => A(px, ym));
  const holeT = edge(y0, y1, 1, (py) => A(xm, py));
  const holeB = edge(y1, y0, -1, (py) => A(xm, py));
  return { x: holeL, y: holeT, w: Math.max(1, holeR - holeL + 1), h: Math.max(1, holeB - holeT + 1) };
}
function parseTree(paths) {
  const models = new Map();
  paths.forEach((path) => {
    if (!path.startsWith("idevice/") || !path.endsWith(".png")) return;
    const parts = path.split("/");
    if (parts.length < 4) return;
    const model = parts[2];
    const file = parts.slice(3).join("/");
    if (!models.has(model)) models.set(model, { name: model, type: familyId(parts[1]), folder: parts.slice(0, 3).join("/"), colors: new Map(), orients: new Set() });
    const m = models.get(model);
    const orient = file.includes("Landscape") ? "Landscape" : file.includes("Portrait") ? "Portrait" : "";
    if (!orient) return;
    m.orients.add(orient);
    if (file.includes("_mask.png")) return;
    const color = file.slice((model + " " + orient).length).replace(/\.png$/, "").trim();
    m.colors.set(color, color || "Gốc");
  });
  return [...models.values()].map((m) => ({
    name: m.name, type: m.type, folder: m.folder, orients: [...m.orients],
    colors: [...m.colors.keys()].sort().map((c) => [c ? " " + c : "", c || "Gốc"])
  })).filter((m) => m.colors.length);
}
async function loadCatalog() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`);
    const data = await res.json();
    const list = parseTree((data.tree || []).map((t) => t.path));
    if (list.length) return list;
  } catch (e) {}
  return [];
}
function list() { return devices.filter((d) => d.type === state.type); }
function device() {
  const models = list();
  return models.find((d) => d.name === state.deviceName) || models[0] || devices[0];
}
function colorSuffix() {
  const d = device();
  if (!d) return "";
  const hit = d.colors.find((c) => c[1] === state.colorName) || d.colors[0];
  state.colorName = hit[1];
  return hit[0];
}
function paths() {
  const d = device();
  const base = `${d.folder}/${d.name} ${state.orient}`;
  return { frame: `${base}${colorSuffix()}.png`, mask: `${base}_mask.png` };
}
function systemBg() { return matchMedia("(prefers-color-scheme: dark)").matches ? "#000000" : "#f2f2f7"; }
function shot() { return shots[state.index] || null; }
function shotRect(screen, img) {
  if (!img) return null;
  const ir = img.width / img.height;
  const sr = screen.w / screen.h;
  const z = state.zoom;
  let sw, sh, ix, iy;
  if (state.mode === "fit") {
    if (ir > sr) { sw = img.width; sh = sw / sr; }
    else { sh = img.height; sw = sh * sr; }
  } else if (ir > sr) { sh = img.height; sw = sh * sr; }
  else { sw = img.width; sh = sw / sr; }
  sw /= z; sh /= z;
  ix = (img.width - sw) * state.panX;
  iy = (img.height - sh) * state.panY;
  return { ix, iy, sw, sh, off: Math.abs(ir - sr) > 0.06 };
}
function drawSign(ctx, w, h) {
  const name = $("signName").value.trim();
  if (!name) return;
  const size = +$("signSize").value * (w / 1470);
  ctx.save();
  ctx.translate((+$("sx").value / 100) * w, (+$("sy").value / 100) * h);
  ctx.rotate((+$("rot").value * Math.PI) / 180);
  ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, size * 0.08);
  if ($("signShadow").checked) { ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = size * 0.2; }
  if ($("stroke").checked) { ctx.strokeStyle = "#000"; ctx.strokeText(name, 0, 0); }
  ctx.shadowColor = "transparent";
  ctx.fillStyle = `hsl(${$("hue").value} 80% 55%)`;
  ctx.fillText(name, 0, 0);
  ctx.restore();
}
async function screenOf(frameImg) {
  const key = device().folder + state.orient;
  if (!holes.has(key)) holes.set(key, measureHole(frameImg));
  return holes.get(key);
}
function paintBg(ctx, w, h) {
  const v = $("bg").value;
  if (v === "clear") return;
  if (v === "grad") {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, $("bgColor").value);
    g.addColorStop(1, $("bgColor2").value);
    ctx.fillStyle = g;
  } else if (v === "image" && bgPhoto) {
    const s = Math.max(w / bgPhoto.width, h / bgPhoto.height);
    const dw = bgPhoto.width * s, dh = bgPhoto.height * s;
    ctx.drawImage(bgPhoto, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return;
  } else ctx.fillStyle = v === "system" ? systemBg() : v === "light" ? "#f2f2f7" : v === "dark" ? "#000" : $("bgColor").value;
  ctx.fillRect(0, 0, w, h);
}
async function compose(img) {
  const { frame, mask } = paths();
  const [frameImg, maskImg] = await Promise.all([loadImage(frame), loadImage(mask)]);
  const screen = await screenOf(frameImg);
  const amount = $("shadow").checked ? +$("shade").value / 100 : 0;
  const pad = amount ? Math.round(frameImg.width * 0.08 * amount) : 0;
  const layer = document.createElement("canvas");
  layer.width = frameImg.width; layer.height = frameImg.height;
  const lx = layer.getContext("2d");
  const rect = shotRect(screen, img);
  if (rect) {
    lx.drawImage(img, rect.ix, rect.iy, rect.sw, rect.sh, screen.x, screen.y, screen.w, screen.h);
    lx.globalCompositeOperation = "destination-in";
    lx.drawImage(maskAlpha(maskImg, mask), screen.x, screen.y, screen.w, screen.h);
    lx.globalCompositeOperation = "source-over";
  }
  lx.drawImage(frameImg, 0, 0);
  drawSign(lx, layer.width, layer.height);
  const mode = $("size").value;
  const outW = mode === "story" ? 1080 : mode === "1080" ? 1080 : layer.width + pad * 2;
  const outH = mode === "story" ? 1920 : Math.round(outW * (layer.height + pad * 2) / (layer.width + pad * 2));
  const c = document.createElement("canvas");
  c.width = outW; c.height = outH;
  const x = c.getContext("2d");
  paintBg(x, c.width, c.height);
  const scale = Math.min((c.width - pad) / layer.width, (c.height - pad) / layer.height);
  const dw = layer.width * scale, dh = layer.height * scale;
  if (amount) { x.shadowColor = `rgba(0,0,0,${0.15 + amount * 0.4})`; x.shadowBlur = pad * scale; x.shadowOffsetY = pad * scale * 0.3; }
  x.drawImage(layer, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  return { canvas: c, off: !!(rect && rect.off) };
}
async function paint() {
  if (painting || !device()) return;
  painting = true;
  try {
    const made = await compose(shot());
    const r = view.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    view.width = Math.max(1, Math.round(r.width * dpr));
    view.height = Math.max(1, Math.round(r.height * dpr));
    vctx.clearRect(0, 0, view.width, view.height);
    const s = Math.min(view.width / made.canvas.width, view.height / made.canvas.height);
    const w = made.canvas.width * s, h = made.canvas.height * s;
    vctx.drawImage(made.canvas, (view.width - w) / 2, (view.height - h) / 2, w, h);
    $("empty").hidden = shots.length > 0;
    if (made.off) toast("di chuyển để khớp");
    $("pager").hidden = shots.length < 2;
    $("shareAll").hidden = shots.length < 2;
    $("count").textContent = `${state.index + 1}/${shots.length || 1}`;
  } catch (e) {}
  painting = false;
}
let toastTimer = 0;
let toasted = new WeakSet();
let replaceOnPick = false;
function requestPaint() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
function toast(text) {
  const img = shot();
  if (!img || toasted.has(img)) return;
  toasted.add(img);
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.hidden = true; }, 250);
  }, 1600);
}
function save() {
  localStorage.setItem(KEY, JSON.stringify({
    type: state.type, deviceName: state.deviceName, colorName: state.colorName,
    orient: state.orient, mode: state.mode, zoom: state.zoom,
    bg: $("bg").value, bgColor: $("bgColor").value, bgColor2: $("bgColor2").value,
    shadow: $("shadow").checked, shade: $("shade").value, size: $("size").value,
    signName: $("signName").value, hue: $("hue").value, signSize: $("signSize").value,
    rot: $("rot").value, sx: $("sx").value, sy: $("sy").value,
    stroke: $("stroke").checked, signShadow: $("signShadow").checked
  }));
}
function restore() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}");
    Object.assign(state, { type: p.type || "iphone", deviceName: p.deviceName || "", colorName: p.colorName || "", orient: p.orient || "Portrait", mode: p.mode || "fill", zoom: p.zoom || 1 });
    ["bg", "size"].forEach((id) => { if (p[id]) $(id).value = p[id]; });
    if (p.bgColor) $("bgColor").value = p.bgColor;
    if (p.bgColor2) $("bgColor2").value = p.bgColor2;
    $("shadow").checked = !!p.shadow;
    if (p.shade) $("shade").value = p.shade;
    $("signName").value = p.signName || "";
    ["hue", "signSize", "rot", "sx", "sy"].forEach((id) => { if (p[id]) $(id).value = p[id]; });
    $("stroke").checked = p.stroke !== false;
    $("signShadow").checked = p.signShadow !== false;
  } catch (e) {}
}
function closePops() { ["typePop", "devicePop", "colorPop"].forEach((id) => { $(id).hidden = true; }); }
function fillPop(id, items, onPick) {
  const box = $(id);
  box.replaceChildren();
  if (!items.length) { const b = document.createElement("button"); b.type = "button"; b.textContent = "Chưa có khung"; b.disabled = true; box.appendChild(b); return; }
  items.forEach((item, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = item.name; b.className = item.on ? "on" : "";
    b.onclick = () => { onPick(i, item); closePops(); save(); };
    box.appendChild(b);
  });
}
function syncTools() {
  document.querySelectorAll("#tools button").forEach((b) => b.classList.toggle("on", b.dataset.k === "orient" ? b.dataset.v === state.orient : b.dataset.v === state.mode));
  $("shadeVal").textContent = $("shade").value;
  $("hueVal").textContent = $("hue").value;
  $("sizeVal").textContent = $("signSize").value;
  $("rotVal").textContent = $("rot").value + "°";
  $("sxVal").textContent = $("sx").value;
  $("syVal").textContent = $("sy").value;
  $("bg2wrap").hidden = $("bg").value !== "grad";
  $("bgImgBtn").hidden = $("bg").value !== "image";
}
function renderMenus() {
  const type = TYPES.find((t) => t.id === state.type) || TYPES[0];
  $("typeBtn").textContent = type.name;
  const d = device();
  if (d) state.deviceName = d.name;
  $("deviceBtn").textContent = d ? d.name.replace(type.name + " ", "") : "Chưa có";
  $("colorBtn").textContent = d ? (state.colorName || d.colors[0][1]) : "—";
  fillPop("typePop", TYPES.map((t) => ({ name: t.name, on: t.id === state.type, id: t.id })), (i, item) => {
    state.type = item.id; state.deviceName = ""; state.colorName = "";
    const next = device();
    if (next && !next.orients.includes(state.orient)) state.orient = next.orients[0];
    syncTools(); renderMenus(); requestPaint();
  });
  fillPop("devicePop", list().map((m) => ({ name: m.name, on: m.name === state.deviceName })), (i, item) => {
    state.deviceName = item.name; state.colorName = "";
    if (!device().orients.includes(state.orient)) state.orient = device().orients[0];
    syncTools(); renderMenus(); requestPaint();
  });
  fillPop("colorPop", d ? d.colors.map((c) => ({ name: c[1], on: c[1] === state.colorName })) : [], (i, item) => {
    state.colorName = item.name; renderMenus(); requestPaint();
  });
}
function addFiles(files) {
  [...files].forEach((file) => {
    const img = new Image();
    img.onload = () => {
      if (replaceOnPick && shots.length) shots[state.index] = img;
      else { shots.push(img); state.index = shots.length - 1; }
      replaceOnPick = false;
      state.zoom = 1; state.panX = 0.5; state.panY = 0.5;
      if (device() && device().orients.includes(img.width > img.height ? "Landscape" : "Portrait")) {
        state.orient = img.width > img.height ? "Landscape" : "Portrait";
        syncTools();
      }
      requestPaint();
    };
    img.src = URL.createObjectURL(file);
  });
}
async function blobOf(canvas) { return new Promise((r) => canvas.toBlob(r, "image/png")); }
async function shareFiles(files, name) {
  if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files }); return; }
  if (files.length === 1) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(files[0]); a.download = name; a.click();
  }
}
$("empty").onclick = () => $("file").click();
$("file").onchange = () => {
  if (!$("file").files.length) { replaceOnPick = false; return; }
  addFiles($("file").files);
};
$("typeBtn").onclick = () => { const open = $("typePop").hidden; closePops(); $("typePop").hidden = !open; };
$("deviceBtn").onclick = () => { const open = $("devicePop").hidden; closePops(); $("devicePop").hidden = !open; };
$("colorBtn").onclick = () => { const open = $("colorPop").hidden; closePops(); $("colorPop").hidden = !open; };
document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".menu")) closePops(); });
$("tools").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b || !device()) return;
  if (b.dataset.k === "orient" && device().orients.includes(b.dataset.v)) state.orient = b.dataset.v;
  if (b.dataset.k === "mode") state.mode = b.dataset.v;
  syncTools(); save(); requestPaint();
};
$("bg").onchange = () => { syncTools(); save(); requestPaint(); };
$("bgColor").oninput = () => { if ($("bg").value !== "grad") $("bg").value = "custom"; syncTools(); save(); requestPaint(); };
$("bgColor2").oninput = () => { $("bg").value = "grad"; syncTools(); save(); requestPaint(); };
$("bgImgBtn").onclick = () => $("bgFile").click();
$("bgFile").onchange = () => {
  const file = $("bgFile").files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => { bgPhoto = img; $("bg").value = "image"; syncTools(); save(); requestPaint(); };
  img.src = URL.createObjectURL(file);
};
$("shadow").onchange = () => { save(); requestPaint(); };
$("shade").oninput = () => { $("shadow").checked = +$("shade").value > 0; syncTools(); save(); requestPaint(); };
$("size").onchange = () => { save(); requestPaint(); };
$("signBtn").onclick = () => { $("sheet").hidden = false; };
$("sheetClose").onclick = () => { $("sheet").hidden = true; save(); };
$("sheet").onclick = (e) => { if (e.target === $("sheet")) { $("sheet").hidden = true; save(); } };
$("corners").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  $("sx").value = b.dataset.x; $("sy").value = b.dataset.y;
  syncTools(); save(); requestPaint();
};
["signName", "hue", "signSize", "rot", "sx", "sy", "stroke", "signShadow"].forEach((id) => {
  $(id).oninput = () => { syncTools(); save(); requestPaint(); };
});
$("prev").onclick = () => { state.index = (state.index - 1 + shots.length) % shots.length; requestPaint(); };
$("next").onclick = () => { state.index = (state.index + 1) % shots.length; requestPaint(); };
const pts = new Map();
let pinch = 0;
let moved = 0;
view.onpointerdown = (e) => {
  if (e.target === $("empty")) return;
  view.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, px: state.panX, py: state.panY, z: state.zoom });
  moved = 0;
  if (pts.size === 2) pinch = dist();
};
function dist() {
  const [a, b] = [...pts.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}
view.onpointermove = (e) => {
  if (!pts.has(e.pointerId) || !shot()) return;
  const p = pts.get(e.pointerId);
  moved = Math.max(moved, Math.hypot(e.clientX - p.ox, e.clientY - p.oy));
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size >= 2) {
    const d = dist();
    state.zoom = Math.min(4, Math.max(0.4, p.z * (d / pinch)));
    requestPaint();
    return;
  }
  state.panX = p.px - (e.clientX - p.ox) / 180;
  state.panY = p.py - (e.clientY - p.oy) / 180;
  requestPaint();
};
view.onpointerup = (e) => {
  const p = pts.get(e.pointerId);
  pts.delete(e.pointerId);
  if (p && pts.size === 0 && moved < 8 && shot()) {
    replaceOnPick = true;
    $("file").click();
  }
  if (pts.size < 2) save();
};
$("share").onclick = async () => {
  if (!device()) return;
  const made = await compose(shot());
  await shareFiles([new File([await blobOf(made.canvas)], "iscreenshort.png", { type: "image/png" })], "iscreenshort.png");
};
$("shareAll").onclick = async () => {
  const files = [];
  for (let i = 0; i < shots.length; i++) {
    const made = await compose(shots[i]);
    files.push(new File([await blobOf(made.canvas)], `iscreenshort-${i + 1}.png`, { type: "image/png" }));
  }
  await shareFiles(files, "iscreenshort-bo.png");
};
restore();
loadCatalog().then((list) => {
  devices = list;
  if (!list.some((d) => d.type === state.type) && list[0]) state.type = list[0].type;
  renderMenus(); syncTools();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", requestPaint);
  addEventListener("resize", requestPaint);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  requestPaint();
});
