const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const clients = new Set();
const users = new Map();
const messages = [];

const publicDir = path.join(__dirname, "public");

const sendJson = (res, status, payload) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
};

const nowStamp = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const broadcast = (event, payload) => {
  const packet = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(packet);
};

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });

const serveStatic = (req, res) => {
  const reqPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(publicDir, path.normalize(reqPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
    res.end(data);
  });
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");

    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/state") {
    return sendJson(res, 200, {
      messages,
      online: Array.from(users.values()),
    });
  }

  if (req.method === "POST" && url.pathname === "/join") {
    try {
      const { username, sessionId } = await parseBody(req);
      if (!sessionId) return sendJson(res, 400, { error: "Missing sessionId" });

      const safeName = username?.trim() || `Guest-${sessionId.slice(0, 4)}`;
      users.set(sessionId, safeName);
      broadcast("presence", { online: Array.from(users.values()) });
      broadcast("system", { text: `${safeName} joined the chat`, time: nowStamp() });
      return sendJson(res, 200, { username: safeName });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/leave") {
    try {
      const { sessionId } = await parseBody(req);
      const username = users.get(sessionId);
      users.delete(sessionId);
      if (username) {
        broadcast("presence", { online: Array.from(users.values()) });
        broadcast("system", { text: `${username} left the chat`, time: nowStamp() });
      }
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/typing") {
    try {
      const { username, isTyping } = await parseBody(req);
      broadcast("typing", { username, isTyping: Boolean(isTyping) });
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/message") {
    try {
      const { sender, text } = await parseBody(req);
      const trimmed = text?.trim();
      if (!sender || !trimmed) return sendJson(res, 400, { error: "Invalid message" });

      const payload = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sender,
        text: trimmed,
        time: nowStamp(),
      };
      messages.push(payload);
      broadcast("message", payload);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  return serveStatic(req, res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ChatWave running at http://localhost:${PORT}`);
});
