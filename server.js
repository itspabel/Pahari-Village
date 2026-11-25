/**
 * server.js — Production Node.js 22 Server (`npm start`)
 * Serves built static assets from `dist/` with strict path-traversal & symlink guards.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function resolveSafeStaticFile(urlPathname) {
  let decodedPath = "/";
  try {
    decodedPath = decodeURIComponent(urlPathname || "/");
  } catch {
    return null;
  }
  if (decodedPath.includes("\0")) return null;

  const rel = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const segments = rel.split("/");
  if (segments.some((seg) => seg.startsWith(".") || seg.endsWith(".map"))) {
    return null;
  }

  const resolved = path.resolve(DIST_DIR, rel);
  if (!resolved.startsWith(DIST_DIR + path.sep)) {
    return null;
  }

  try {
    const lst = fs.lstatSync(resolved);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function serveStaticFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const cacheControl =
    ext === ".html"
      ? "no-cache"
      : "public, max-age=31536000, immutable";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on("error", (err) => {
    console.error("[server] Static stream error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end();
  });
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = String(req.url || "/").split("?")[0];

    if (pathname === "/api/health" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed." }));
      return;
    }

    const targetFile =
      resolveSafeStaticFile(pathname) ||
      (path.extname(pathname) === "" ? resolveSafeStaticFile("/index.html") : null);

    if (!targetFile) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      res.end("Not Found");
      return;
    }

    serveStaticFile(req, res, targetFile);
  } catch (err) {
    console.error("[server] Unhandled request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify({ ok: false, error: "Internal server error." }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`[pahari-village] Server listening on http://0.0.0.0:${port}`);
});
