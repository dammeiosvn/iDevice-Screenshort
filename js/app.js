const REPO = "dammeiosvn/iDevice-Screenshort";
const TYPES = [
  { id: "iphone", name: "iPhone" },
  { id: "ipad", name: "iPad" },
  { id: "macbook", name: "MacBook" },
  { id: "watch", name: "Watch" }
];
const $ = (id) => document.getElementById(id);
const view = $("view");
const vctx = view.getContext("2d");
const holes = new Map();
const images = new Map();
const masks = new Map();
let devices = [];
let state = { type: "iphone", device: 0, color: 0, orient: "Portrait", mode: "fill", shot: null, panX: 0.5, panY: 0.5 };
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
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i];
    d[i] = d[i + 1] = d[i + 2] = 255;
  }
  x.putImageData(data, 0, 0);
  masks.set(key, c);
  return c;
}

function measureHole(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const { data, width: w, height: h } = x.getImageData(0, 0, c.width, c.height);
  const A = (px, py) => data[(py * w + px) * 4 + 3];
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 3) {
    for (let px = 0; px < w; px += 3) {
      if (A(px, y) > 40) {
        if (px < x0) x0 = px;
        if (y < y0) y0 = y;
        if (px > x1) x1 = px;
        if (y > y1) y1 = y;
      }
    }
  }
  const ym = (y0 + y1) >> 1;
  const xm = (x0 + x1) >> 1;
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
    name: m.name,
    type: m.type,
    folder: m.folder,
    orients: [...m.orients],
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
function device() { return list()[state.device] || devices[0]; }

function paths() {
  const d = device();
  const color = d.colors[state.color][0];
  const base = `${d.folder}/${d.name} ${state.orient}`;
  return { frame: `${base}${color}.png`, mask: `${base}_mask.png` };
}

function systemBg() {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "#000000" : "#f2f2f7";
}
function bgColor() {
  const v = $("bg").value;
  if (v === "clear") return null;
  if (v === "system") return systemBg();
  if (v === "light") return "#f2f2f7";
  if (v === "dark") return "#000000";
  return $("bgColor").value;
}
function shotRect(screen) {
  if (!state.shot) return null;
  const ir = state.shot.width / state.shot.height;
  const sr = screen.w / screen.h;
  let sw, sh, ix, iy;
  if (state.mode === "fit") {
    if (ir > sr) { sw = state.shot.width; sh = sw / sr; }
    else { sh = state.shot.height; sw = sh * sr; }
    ix = (state.shot.width - sw) / 2;
    iy = (state.shot.height - sh) / 2;
  } else {
    if (ir > sr) { sh = state.shot.height; sw = sh * sr; }
    else { sw = state.shot.width; sh = sw / sr; }
    ix = (state.shot.width - sw) * state.panX;
    iy = (state.shot.height - sh) * state.panY;
  }
  return { ix, iy, sw, sh };
}
function drawSign(ctx, w, h) {
  const name = $("signName").value.trim();
  if (!name) return;
  const size = +$("size").value * (w / 1470);
  ctx.save();
  ctx.translate((+$("sx").value / 100) * w, (+$("sy").value / 100) * h);
  ctx.rotate((+$("rot").value * Math.PI) / 180);
  ctx.fillStyle = `hsl(${$("hue").value} 80% 55%)`;
  ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 0, 0);
  ctx.restore();
}
async function screenOf(frameImg) {
  const key = device().folder + state.orient;
  if (!holes.has(key)) holes.set(key, measureHole(frameImg));
  return holes.get(key);
}
async function compose() {
  const { frame, mask } = paths();
  const [frameImg, maskImg] = await Promise.all([loadImage(frame), loadImage(mask)]);
  const screen = await screenOf(frameImg);
  const pad = $("shadow").checked ? Math.round(frameImg.width * 0.04) : 0;
  const layer = document.createElement("canvas");
  layer.width = frameImg.width;
  layer.height = frameImg.height;
  const lx = layer.getContext("2d");
  const rect = shotRect(screen);
  if (rect) {
    lx.drawImage(state.shot, rect.ix, rect.iy, rect.sw, rect.sh, screen.x, screen.y, screen.w, screen.h);
    lx.globalCompositeOperation = "destination-in";
    lx.drawImage(maskAlpha(maskImg, mask), screen.x, screen.y, screen.w, screen.h);
    lx.globalCompositeOperation = "source-over";
  }
  lx.drawImage(frameImg, 0, 0);
  drawSign(lx, layer.width, layer.height);
  const c = document.createElement("canvas");
  c.width = frameImg.width + pad * 2;
  c.height = frameImg.height + pad * 2;
  const x = c.getContext("2d");
  const bg = bgColor();
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
  if (pad) {
    x.shadowColor = "rgba(0,0,0,.28)";
    x.shadowBlur = pad;
    x.shadowOffsetY = pad * 0.3;
  }
  x.drawImage(layer, pad, pad);
  return c;
}
async function paint() {
  if (painting || !device()) return;
  painting = true;
  try {
    const c = await compose();
    const r = view.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    view.width = Math.max(1, Math.round(r.width * dpr));
    view.height = Math.max(1, Math.round(r.height * dpr));
    vctx.clearRect(0, 0, view.width, view.height);
    const s = Math.min(view.width / c.width, view.height / c.height);
    const w = c.width * s;
    const h = c.height * s;
    vctx.drawImage(c, (view.width - w) / 2, (view.height - h) / 2, w, h);
    $("empty").hidden = !!state.shot;
  } catch (e) {}
  painting = false;
}
function requestPaint() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}
function closePops() {
  ["typePop", "devicePop", "colorPop"].forEach((id) => { $(id).hidden = true; });
}
function fillPop(id, items, current, onPick) {
  const box = $(id);
  box.replaceChildren();
  if (!items.length) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Chưa có khung";
    b.disabled = true;
    box.appendChild(b);
    return;
  }
  items.forEach((item, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = item.name;
    b.className = item.on ? "on" : "";
    b.onclick = () => { onPick(i, item); closePops(); };
    box.appendChild(b);
  });
}
function syncTools() {
  document.querySelectorAll("#tools button").forEach((b) => {
    b.classList.toggle("on", b.dataset.k === "orient" ? b.dataset.v === state.orient : b.dataset.v === state.mode);
  });
}
function renderMenus() {
  const type = TYPES.find((t) => t.id === state.type);
  $("typeBtn").textContent = type.name;
  const models = list();
  const d = device();
  $("deviceBtn").textContent = d ? d.name.replace(type.name + " ", "") : "Chưa có";
  $("colorBtn").textContent = d ? d.colors[state.color][1] : "—";
  fillPop("typePop", TYPES.map((t) => ({ name: t.name, on: t.id === state.type, id: t.id })), state.type, (i, item) => {
    state.type = item.id;
    state.device = 0;
    state.color = 0;
    const next = device();
    if (next && !next.orients.includes(state.orient)) state.orient = next.orients[0];
    syncTools();
    renderMenus();
    requestPaint();
  });
  fillPop("devicePop", models.map((m, i) => ({ name: m.name, on: i === state.device })), state.device, (i) => {
    state.device = i;
    state.color = 0;
    if (!device().orients.includes(state.orient)) state.orient = device().orients[0];
    syncTools();
    renderMenus();
    requestPaint();
  });
  fillPop("colorPop", d ? d.colors.map((c, i) => ({ name: c[1], on: i === state.color })) : [], state.color, (i) => {
    state.color = i;
    renderMenus();
    requestPaint();
  });
}
function readShot(file) {
  const img = new Image();
  img.onload = () => {
    state.shot = img;
    state.panX = 0.5;
    state.panY = 0.5;
    const d = device();
    if (d && d.orients.includes(img.width > img.height ? "Landscape" : "Portrait")) {
      state.orient = img.width > img.height ? "Landscape" : "Portrait";
      syncTools();
    }
    requestPaint();
  };
  img.src = URL.createObjectURL(file);
}
function togglePop(id) {
  const open = $(id).hidden;
  closePops();
  $(id).hidden = !open;
}
$("empty").onclick = () => $("file").click();
$("file").onchange = () => $("file").files[0] && readShot($("file").files[0]);
$("typeBtn").onclick = () => togglePop("typePop");
$("deviceBtn").onclick = () => togglePop("devicePop");
$("colorBtn").onclick = () => togglePop("colorPop");
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".menu")) closePops();
});
$("tools").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b || !device()) return;
  if (b.dataset.k === "orient" && device().orients.includes(b.dataset.v)) state.orient = b.dataset.v;
  if (b.dataset.k === "mode") state.mode = b.dataset.v;
  syncTools();
  requestPaint();
};
$("bg").onchange = requestPaint;
$("bgColor").oninput = () => { $("bg").value = "custom"; requestPaint(); };
$("shadow").onchange = requestPaint;
$("signBtn").onclick = () => { $("sheet").hidden = false; };
$("sheetClose").onclick = () => { $("sheet").hidden = true; };
$("sheet").onclick = (e) => { if (e.target === $("sheet")) $("sheet").hidden = true; };
["signName", "hue", "size", "rot", "sx", "sy"].forEach((id) => {
  $(id).oninput = () => {
    $("hueVal").textContent = $("hue").value;
    $("sizeVal").textContent = $("size").value;
    $("rotVal").textContent = $("rot").value + "°";
    $("sxVal").textContent = $("sx").value;
    $("syVal").textContent = $("sy").value;
    requestPaint();
  };
});
let drag = null;
view.onpointerdown = (e) => {
  if (state.mode !== "fill" || e.target === $("empty")) return;
  drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
  view.setPointerCapture(e.pointerId);
};
view.onpointermove = (e) => {
  if (!drag || !state.shot) return;
  state.panX = Math.min(1, Math.max(0, drag.px - (e.clientX - drag.x) / 220));
  state.panY = Math.min(1, Math.max(0, drag.py - (e.clientY - drag.y) / 220));
  requestPaint();
};
view.onpointerup = () => { drag = null; };
$("share").onclick = async () => {
  if (!device()) return;
  const c = await compose();
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const file = new File([blob], "iscreenshort.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "iscreenshort.png";
  a.click();
};

loadCatalog().then((list) => {
  devices = list;
  if (!list.some((d) => d.type === state.type) && list[0]) state.type = list[0].type;
  renderMenus();
  syncTools();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", requestPaint);
  addEventListener("resize", requestPaint);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  requestPaint();
});
