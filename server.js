const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const BLOCKS_FILE = path.join(DATA_DIR, "blocks.json");
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8"
};

ensureStore();

const server = http.createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/blocks") {
      return createBlock(req, res);
    }

    const blockMatch = url.pathname.match(/^\/api\/blocks\/([A-Z0-9]{4})$/);
    if (req.method === "GET" && blockMatch) {
      return getBlock(res, blockMatch[1]);
    }

    const fileMatch = url.pathname.match(/^\/api\/blocks\/([A-Z0-9]{4})\/file$/);
    if (req.method === "GET" && fileMatch) {
      return downloadFile(res, fileMatch[1]);
    }

    if (req.method === "GET") {
      return serveStatic(res, url.pathname);
    }

    sendJson(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "server_error" });
  }
});

server.listen(PORT, () => {
  console.log(`Clipboard site running at http://localhost:${PORT}`);
});

function setCors(req, res) {
  const allowedOrigins = [
    "https://xuehaiis.github.io",
    "http://localhost:8787",
    "http://127.0.0.1:8787"
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BLOCKS_FILE)) {
    fs.writeFileSync(BLOCKS_FILE, "{}");
  }
}

function readStore() {
  cleanupExpired();
  return JSON.parse(fs.readFileSync(BLOCKS_FILE, "utf8") || "{}");
}

function writeStore(store) {
  fs.writeFileSync(BLOCKS_FILE, JSON.stringify(store, null, 2));
}

function cleanupExpired() {
  const raw = JSON.parse(fs.readFileSync(BLOCKS_FILE, "utf8") || "{}");
  const now = Date.now();
  let changed = false;

  for (const [code, block] of Object.entries(raw)) {
    if (block.expiresAt <= now) {
      delete raw[code];
      changed = true;
    }
  }

  if (changed) {
    writeStore(raw);
  }
}

async function createBlock(req, res) {
  const body = await readBody(req);
  const payload = JSON.parse(body);
  const text = String(payload.text || "").trim();
  const file = payload.file || null;
  const ttlHours = clamp(Number(payload.ttlHours || 24), 1, 168);

  if (!text && !file) {
    return sendJson(res, 400, { error: "empty_content" });
  }

  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
    return sendJson(res, 413, { error: "text_too_large" });
  }

  const block = {
    code: "",
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlHours * 60 * 60 * 1000,
    text,
    file: null
  };

  if (file) {
    const dataUrl = String(file.dataUrl || "");
    const parsed = parseDataUrl(dataUrl);
    const size = parsed.buffer.length;

    if (size > MAX_FILE_BYTES) {
      return sendJson(res, 413, { error: "file_too_large" });
    }

    block.file = {
      name: sanitizeFileName(file.name || "download.bin"),
      mime: parsed.mime,
      size,
      data: parsed.buffer.toString("base64")
    };
  }

  const store = readStore();
  const code = generateCode(store);
  block.code = code;
  store[code] = block;
  writeStore(store);

  sendJson(res, 201, {
    code,
    expiresAt: block.expiresAt,
    hasText: Boolean(text),
    hasFile: Boolean(block.file)
  });
}

function getBlock(res, code) {
  const store = readStore();
  const block = store[code];

  if (!block) {
    return sendJson(res, 404, { error: "not_found" });
  }

  sendJson(res, 200, {
    code: block.code,
    createdAt: block.createdAt,
    expiresAt: block.expiresAt,
    text: block.text,
    file: block.file
      ? {
          name: block.file.name,
          mime: block.file.mime,
          size: block.file.size,
          url: `/api/blocks/${code}/file`
        }
      : null
  });
}

function downloadFile(res, code) {
  const store = readStore();
  const block = store[code];

  if (!block || !block.file) {
    return sendJson(res, 404, { error: "not_found" });
  }

  const buffer = Buffer.from(block.file.data, "base64");
  const encodedName = encodeURIComponent(block.file.name);
  res.writeHead(200, {
    "Content-Type": block.file.mime || "application/octet-stream",
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "no-store"
  });
  res.end(buffer);
}

function serveStatic(res, requestPath) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendText(res, 404, "Not found");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on("data", chunk => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("invalid_data_url");
  }
  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function generateCode(store) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    const bytes = crypto.randomBytes(4);
    for (let index = 0; index < 4; index += 1) {
      code += alphabet[bytes[index] % alphabet.length];
    }
    if (!store[code]) {
      return code;
    }
  }
  throw new Error("code_generation_failed");
}

function sanitizeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "download.bin";
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}
