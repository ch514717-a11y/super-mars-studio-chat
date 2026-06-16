import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const environment = typeof process === "undefined" ? {} : process.env;
const port = Number(globalThis.__LI_AOTANG_PORT || environment.PORT || 8080);
const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, "public");
const dataRoot = globalThis.__LI_AOTANG_DATA_DIR || environment.DATA_DIR || path.join(root, "data");
const messageFile = path.join(dataRoot, "messages.json");
const maxMessages = 3000;
const maxStoredCharacters = 12000000;
const maxRequestSize = 700000;
const maxImageLength = 620000;
const allowedImagePattern = /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i;
const presence = new Map();

fs.mkdirSync(dataRoot, { recursive: true });

let messages = [];
try {
  messages = JSON.parse(fs.readFileSync(messageFile, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(messages)) messages = [];
} catch {
  messages = [];
}
let nextId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0) + 1;

const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"]
]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeRoom(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 24);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (body.length > maxRequestSize) {
        reject(new Error("Request is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function saveMessages() {
  const temporaryFile = `${messageFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(messages, null, 2), "utf8");
  fs.renameSync(temporaryFile, messageFile);
}

function updatePresence(room, clientId) {
  if (!presence.has(room)) presence.set(room, new Map());
  const roomPresence = presence.get(room);
  if (clientId) roomPresence.set(clientId, Date.now());
  const cutoff = Date.now() - 12000;
  for (const [id, lastSeen] of roomPresence) {
    if (lastSeen < cutoff) roomPresence.delete(id);
  }
  return roomPresence.size;
}

async function handleApi(request, response, url) {
  if (url.pathname === "/health" && request.method === "GET") {
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname === "/api/messages" && request.method === "GET") {
    const room = normalizeRoom(url.searchParams.get("room"));
    const clientId = clean(url.searchParams.get("client"), 48);
    const after = Number(url.searchParams.get("after")) || 0;
    if (!room) return sendJson(response, 400, { error: "Room is required" });
    return sendJson(response, 200, {
      messages: messages.filter(message => message.room === room && message.id > after).slice(-100),
      online: updatePresence(room, clientId)
    });
  }

  if (url.pathname === "/api/messages" && request.method === "POST") {
    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
    const room = normalizeRoom(payload.room);
    const name = clean(payload.name, 20);
    const text = clean(payload.text, 500);
    const clientId = clean(payload.clientId, 48);
    const image = clean(payload.image, maxImageLength);
    if (!room || !name || (!text && !image)) {
      return sendJson(response, 400, { error: "Room, name and message content are required" });
    }
    if (image && !allowedImagePattern.test(image)) {
      return sendJson(response, 400, { error: "Invalid image" });
    }

    const message = { id: nextId++, room, name, text, image, clientId, time: new Date().toISOString() };
    messages.push(message);
    if (messages.length > maxMessages) messages = messages.slice(-maxMessages);
    while (messages.length > 1 && JSON.stringify(messages).length > maxStoredCharacters) messages.shift();
    try {
      saveMessages();
    } catch (error) {
      console.error("Could not persist messages:", error.message);
    }
    return sendJson(response, 201, message);
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      const handled = await handleApi(request, response, url);
      if (handled !== false) return;
      return sendJson(response, 404, { error: "Not found" });
    }

    if (request.method !== "GET" || !staticFiles.has(url.pathname)) {
      return sendJson(response, 404, { error: "Not found" });
    }
    const filePath = path.join(publicRoot, staticFiles.get(url.pathname));
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: "Server error" });
    else response.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Super Mars Studio listening on 0.0.0.0:${port}`);
});

export { server };
