// Arayuzu tarayicida sahte (mock) Tauri arka ucuyla calistirir: node tests/serve.mjs  ->  http://localhost:5174
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(root, "..", "ui");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const port = Number(process.env.PORT || 5174);

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = url === "/" ? path.join(ui, "index.html") : url.startsWith("/__test/") ? path.join(root, url.slice(8)) : path.join(ui, url);
  if (!file.startsWith(ui) && !file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("yok"); return; }
    if (file.endsWith("index.html")) data = String(data).replace('<script src="app.js">', '<script src="/__test/mock-tauri.js"></script><script src="app.js">');
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(data);
  });
}).listen(port, () => console.log(`Shion test arayuzu: http://localhost:${port}`));
