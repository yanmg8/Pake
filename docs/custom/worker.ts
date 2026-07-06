export interface Env {
  DB: D1Database;
  API_SECRET: string;
}

// 统一 CORS 响应头
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Signature, X-Timestamp, X-App-Token",
};

// JSON 响应工具函数
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// HMAC-SHA256 签名校验
async function verifySignature(secret: string, payload: string, signature: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sigHex = [...new Uint8Array(sigBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return sigHex === signature;
}

// 通用签名验证中间件，返回 rawBody 或错误 Response
async function authenticate(request: Request, env: Env): Promise<{ rawBody: string } | Response> {
  const signature = request.headers.get("X-Signature");
  const timestamp = request.headers.get("X-Timestamp");

  if (!signature) return jsonResponse({ error: "Missing signature" }, 401);
  if (!timestamp) return jsonResponse({ error: "Missing timestamp" }, 401);

  // 超过 60 秒拒绝（防重放攻击）
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 60) {
    return jsonResponse({ error: "Request expired" }, 403);
  }

  const rawBody = await request.text();
  const valid = await verifySignature(env.API_SECRET, rawBody + timestamp, signature);
  if (!valid) return jsonResponse({ error: "Invalid signature" }, 403);

  return { rawBody };
}

// 将 UTC 时间转换为北京时间字符串（UTC+8）
function toBeijingTime(isoStr: string): string {
  const date = new Date(isoStr);
  // 偏移 8 小时
  const bjDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return bjDate.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

// ---- 路由处理函数 ----

// POST /api/device/report - 设备信息上报
async function handleDeviceReport(request: Request, env: Env): Promise<Response> {
  const result = await authenticate(request, env);
  if (result instanceof Response) return result;

  const data = JSON.parse(result.rawBody);
  const { app_token, hostname, os, arch, hardware_uuid, public_ip, reported_at } = data;

  if (!app_token || !hardware_uuid) {
    return jsonResponse({ error: "missing required fields" }, 400);
  }

  // 转换为北京时间存储
  const bjTime = toBeijingTime(reported_at);
  // 记录入库时的北京时间
  const createdAt = toBeijingTime(new Date().toISOString());

  await env.DB.prepare(`
    INSERT INTO device_reports (app_token, hardware_uuid, hostname, os, arch, public_ip, reported_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(app_token, hardware_uuid, hostname, os, arch, public_ip, bjTime, createdAt).run();

  return jsonResponse({ success: true });
}

// GET /api/version - 按 app_token 查询版本信息（公开接口，无需签名，token 从 X-App-Token header 读取）
// app_versions 表同时存 token 和 app_name，多 token 可共享同一 app_name 的版本信息
async function handleGetVersion(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get("X-App-Token");

  if (!token) {
    return jsonResponse({ error: "Missing token" }, 400);
  }

  // 先用 token 查到 app_name，再查同 app_name 的最新版本（取 version 最大的一行）
  const row = await env.DB.prepare(`
    SELECT version, download_url, release_notes
    FROM app_versions
    WHERE app_name = (SELECT app_name FROM app_versions WHERE app_token = ?)
    ORDER BY version DESC
    LIMIT 1
  `).bind(token).first();

  if (!row) {
    return jsonResponse({ error: "App not found" }, 404);
  }

  return jsonResponse(row);
}

// ---- 路由表 ----
// 新增功能只需在此添加路由和对应处理函数
const routes: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  "POST /api/device/report": handleDeviceReport,
  "GET /api/version": handleGetVersion,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 处理预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const routeKey = `${request.method} ${url.pathname}`;
    const handler = routes[routeKey];

    if (!handler) {
      return jsonResponse({ error: "Not Found" }, 404);
    }

    try {
      return await handler(request, env);
    } catch (e) {
      return jsonResponse({ error: "Server Error" }, 500);
    }
  },
};
