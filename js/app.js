const DEVICES = [
  {
    id: "17pm",
    name: "iPhone 17 Pro Max",
    folder: "idevice/iphone/iPhone 17 Pro Max",
    file: "iPhone 17 Pro Max",
    colors: [["", "Titan"], [" Cosmic Orange", "Cosmic Orange"], [" Deep Blue", "Deep Blue"], [" Silver", "Silver"]],
    screen: {
      Portrait: { x: 75, y: 66, w: 1320, h: 2868 },
      Landscape: { x: 66, y: 75, w: 2868, h: 1320 }
    }
  },
  {
    id: "17p",
    name: "iPhone 17 Pro",
    folder: "idevice/iphone/iPhone 17 Pro",
    file: "iPhone 17 Pro",
    colors: [["", "Titan"], [" Cosmic Orange", "Cosmic Orange"], [" Deep Blue", "Deep Blue"], [" Silver", "Silver"]],
    screen: {
      Portrait: { x: 72, y: 69, w: 1206, h: 2622 },
      Landscape: { x: 69, y: 72, w: 2622, h: 1206 }
    }
  },
  {
    id: "17",
    name: "iPhone 17",
    folder: "idevice/iphone/iPhone 17",
    file: "iPhone 17",
    colors: [["", "Gốc"], [" Black", "Black"], [" Lavender", "Lavender"], [" Mist Blue", "Mist Blue"], [" Sage", "Sage"], [" White", "White"]],
    screen: {
      Portrait: { x: 72, y: 69, w: 1206, h: 2622 },
      Landscape: { x: 69, y: 72, w: 2622, h: 1206 }
    }
  }
];

const $ = (id) => document.getElementById(id);
const view = $("view");
const vctx = view.getContext("2d");
const state = {
  device: 0,
  color: 0,
  orient: "Portrait",
  mode: "fill",
  shot: null,
  panX: 0.5,
  panY: 0.5
};
const cache = new Map();
const maskCache = new Map();
let raf = 0;
let painting = false;

function loadImage(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

function maskAlpha(img, key) {
  if (maskCache.has(key)) return maskCache.get(key);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i];
    d[i] = d[i + 1] = d[i + 2] = 255;
  }
  x.putImageData(data, 0, 0);
  maskCache.set(key, c);
  return c;
}

function device() { return DEVICES[state.device]; }

function paths() {
  const d = device();
  const color = d.colors[state.color][0];
  const base = `${d.folder}/${d.file} ${state.orient}`;
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

async function compose() {
  const d = device();
  const screen = d.screen[state.orient];
  const { frame, mask } = paths();
  const [frameImg, maskImg] = await Promise.all([loadImage(frame), loadImage(mask)]);
  const pad = $("shadow").checked ? Math.round(frameImg.width * 0.06) : 0;
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
  if (bg) {
    x.fillStyle = bg;
    x.fillRect(0, 0, c.width, c.height);
  }
  if (pad) {
    x.shadowColor = "rgba(0,0,0,.35)";
    x.shadowBlur = pad;
    x.shadowOffsetY = pad * 0.35;
  }
  x.drawImage(layer, pad, pad);
  return c;
}

async function paint() {
  if (painting) return;
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

function renderColors() {
  const box = $("colors");
  box.replaceChildren();
  device().colors.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (i === state.color ? " on" : "");
    b.textContent = c[1];
    b.onclick = () => { state.color = i; renderColors(); requestPaint(); };
    box.appendChild(b);
  });
}

function fillDevices() {
  const sel = $("device");
  DEVICES.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = d.name;
    sel.appendChild(o);
  });
}

function setOrient(o, skip) {
  state.orient = o;
  document.querySelectorAll("#orient button").forEach((b) => b.classList.toggle("on", b.dataset.o === o));
  if (!skip) requestPaint();
}

function readShot(file) {
  const img = new Image();
  img.onload = () => {
    state.shot = img;
    state.panX = 0.5;
    state.panY = 0.5;
    setOrient(img.width > img.height ? "Landscape" : "Portrait", true);
    requestPaint();
  };
  img.src = URL.createObjectURL(file);
}

$("pick").onclick = () => $("file").click();
$("empty").onclick = () => $("file").click();
$("cam").onclick = () => $("fileCam").click();
$("file").onchange = () => $("file").files[0] && readShot($("file").files[0]);
$("fileCam").onchange = () => $("fileCam").files[0] && readShot($("fileCam").files[0]);
$("device").onchange = () => { state.device = +$("device").value; state.color = 0; renderColors(); requestPaint(); };
$("orient").onclick = (e) => { const b = e.target.closest("button"); if (b) setOrient(b.dataset.o); };
$("fit").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.mode = b.dataset.m;
  document.querySelectorAll("#fit button").forEach((n) => n.classList.toggle("on", n === b));
  requestPaint();
};
$("bg").onchange = requestPaint;
$("bgDot").style.background = $("bgColor").value;
$("bgDot").onclick = () => $("bgColor").click();
$("bgColor").oninput = () => {
  $("bg").value = "custom";
  $("bgDot").style.background = $("bgColor").value;
  requestPaint();
};
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
  if (state.mode !== "fill") return;
  drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
  view.setPointerCapture(e.pointerId);
};
view.onpointermove = (e) => {
  if (!drag || !state.shot) return;
  state.panX = Math.min(1, Math.max(0, drag.px - (e.clientX - drag.x) / 280));
  state.panY = Math.min(1, Math.max(0, drag.py - (e.clientY - drag.y) / 280));
  requestPaint();
};
view.onpointerup = () => { drag = null; };

$("share").onclick = async () => {
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

fillDevices();
renderColors();
setOrient("Portrait", true);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", requestPaint);
addEventListener("resize", requestPaint);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
requestPaint();
