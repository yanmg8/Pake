# 授权服务器和管理后台部署指南

## 概述

本文档说明如何部署设备授权服务器和管理后台。推荐使用 Cloudflare Workers + D1 数据库，完全免费且易于部署。

## 技术栈

- **Cloudflare Workers**：无服务器函数（免费额度：每天 100,000 次请求）
- **Cloudflare D1**：SQLite 数据库（免费额度：每天 100,000 次读写）
- **Wrangler**：Cloudflare 官方 CLI 工具

---

## 一、环境准备

### 1.1 注册 Cloudflare 账号

访问 https://dash.cloudflare.com/ 注册账号（免费）

### 1.2 安装 Wrangler CLI

```bash
npm install -g wrangler

# 验证安装
wrangler --version
```

### 1.3 登录 Cloudflare

```bash
wrangler login
```

浏览器会打开授权页面，点击允许即可。

---

## 二、创建项目

### 2.1 创建项目目录

```bash
mkdir miko-bot-auth-server
cd miko-bot-auth-server
```

### 2.2 初始化项目

```bash
npm init -y
```

### 2.3 创建项目结构

```
miko-bot-auth-server/
├── wrangler.toml          # Cloudflare Workers 配置
├── schema.sql             # 数据库表结构
├── package.json
└── src/
    ├── index.js          # 主入口
    ├── auth.js           # 授权验证逻辑
    └── utils.js          # 工具函数
```

---

## 三、数据库设计

### 3.1 创建数据库表结构

创建文件 `schema.sql`：

```sql
-- 设备白名单表
CREATE TABLE device_whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- 设备指纹
  primary_id TEXT NOT NULL,           -- BIOS UUID 哈希
  secondary_id TEXT,                  -- 主板序列号哈希
  tertiary_id TEXT,                   -- 硬盘序列号哈希
  combined_id TEXT NOT NULL,          -- 组合哈希（主要标识）
  
  -- 授权信息
  user_name TEXT,                     -- 用户名称（可选）
  user_email TEXT,                    -- 用户邮箱（可选）
  status TEXT DEFAULT 'active',       -- 状态: active, suspended, expired
  
  -- 时间信息
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,                -- 过期时间（NULL 表示永久）
  last_seen DATETIME,                 -- 最后访问时间
  
  -- 统计信息
  access_count INTEGER DEFAULT 0,     -- 访问次数
  
  -- 设备信息（用于管理）
  os_info TEXT,                       -- 操作系统信息
  app_version TEXT,                   -- 应用版本
  
  -- 备注
  notes TEXT                          -- 管理员备注
);

-- 索引
CREATE INDEX idx_primary_id ON device_whitelist(primary_id);
CREATE INDEX idx_secondary_id ON device_whitelist(secondary_id);
CREATE INDEX idx_tertiary_id ON device_whitelist(tertiary_id);
CREATE INDEX idx_combined_id ON device_whitelist(combined_id);
CREATE INDEX idx_status ON device_whitelist(status);

-- 访问日志表（可选，用于详细审计）
CREATE TABLE access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  access_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  match_type TEXT,                    -- exact, primary, secondary, partial
  ip_address TEXT,
  user_agent TEXT,
  
  FOREIGN KEY (device_id) REFERENCES device_whitelist(id)
);

CREATE INDEX idx_device_id ON access_logs(device_id);
CREATE INDEX idx_access_time ON access_logs(access_time);
```

---

## 四、服务器端代码

### 4.1 Wrangler 配置

创建文件 `wrangler.toml`：

```toml
name = "miko-bot-auth"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "miko-bot-auth-db"
database_id = "your-database-id"  # 创建数据库后会自动填充

[vars]
SECRET_SALT = "your-secret-salt-change-this-to-random-string"
```

**注意**：`SECRET_SALT` 必须与客户端的 `SECRET_SALT` 完全一致。

### 4.2 工具函数

创建文件 `src/utils.js`：

```javascript
/**
 * 生成签名
 */
export async function generateSignature(deviceId, timestamp, salt) {
  const data = `${deviceId}${timestamp}${salt}`;
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * JSON 响应
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
```

### 4.3 授权验证逻辑

创建文件 `src/auth.js`：

```javascript
import { generateSignature, jsonResponse } from './utils.js';

/**
 * 验证设备授权
 */
export async function verifyDevice(request, env) {
  try {
    // 1. 提取 headers
    const primaryId = request.headers.get('miko-device-primary');
    const secondaryId = request.headers.get('miko-device-secondary');
    const tertiaryId = request.headers.get('miko-device-tertiary');
    const combinedId = request.headers.get('miko-device-combined');
    const timestamp = request.headers.get('miko-timestamp');
    const signature = request.headers.get('miko-signature');
    
    // 2. 验证必需字段
    if (!primaryId || !combinedId || !timestamp || !signature) {
      return jsonResponse({ 
        authorized: false, 
        message: '缺少必需的认证信息' 
      }, 400);
    }
    
    // 3. 验证签名
    const expectedSignature = await generateSignature(combinedId, timestamp, env.SECRET_SALT);
    if (signature !== expectedSignature) {
      console.log('签名验证失败:', { expected: expectedSignature, received: signature });
      return jsonResponse({ 
        authorized: false, 
        message: '签名验证失败' 
      }, 403);
    }
    
    // 4. 验证时间戳（防止重放攻击）
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp);
    if (Math.abs(now - requestTime) > 300) { // 5分钟有效期
      return jsonResponse({ 
        authorized: false, 
        message: '请求已过期' 
      }, 403);
    }
    
    // 5. 查询白名单
    const device = await findDevice(env.DB, { 
      primaryId, 
      secondaryId, 
      tertiaryId, 
      combinedId 
    });
    
    if (!device) {
      return jsonResponse({ 
        authorized: false, 
        message: '设备未授权，请联系管理员' 
      }, 403);
    }
    
    // 6. 检查状态
    if (device.status !== 'active') {
      return jsonResponse({ 
        authorized: false, 
        message: `设备状态: ${device.status}` 
      }, 403);
    }
    
    // 7. 检查过期时间
    if (device.expires_at) {
      const expiresAt = new Date(device.expires_at);
      if (expiresAt < new Date()) {
        return jsonResponse({ 
          authorized: false, 
          message: '授权已过期，请续费' 
        }, 403);
      }
    }
    
    // 8. 更新访问记录（异步，不阻塞响应）
    env.waitUntil(updateAccessRecord(env.DB, device.id, device.match_type));
    
    // 9. 返回成功
    return jsonResponse({
      authorized: true,
      message: '授权验证成功',
      match_type: device.match_type
    });
    
  } catch (error) {
    console.error('授权验证错误:', error);
    return jsonResponse({ 
      authorized: false, 
      message: '服务器错误' 
    }, 500);
  }
}

/**
 * 查找设备（多重匹配策略）
 */
async function findDevice(db, fingerprints) {
  const { primaryId, secondaryId, tertiaryId, combinedId } = fingerprints;
  
  // 策略 1: 完全匹配（最理想）
  let device = await db.prepare(`
    SELECT * FROM device_whitelist 
    WHERE combined_id = ? AND status = 'active'
  `).bind(combinedId).first();
  
  if (device) {
    device.match_type = 'exact';
    return device;
  }
  
  // 策略 2: 主要标识匹配（BIOS UUID）
  device = await db.prepare(`
    SELECT * FROM device_whitelist 
    WHERE primary_id = ? AND status = 'active'
  `).bind(primaryId).first();
  
  if (device) {
    device.match_type = 'primary';
    // 更新组合标识（硬件可能有变化）
    await db.prepare(`
      UPDATE device_whitelist 
      SET combined_id = ?, secondary_id = ?, tertiary_id = ?
      WHERE id = ?
    `).bind(combinedId, secondaryId, tertiaryId, device.id).run();
    return device;
  }
  
  // 策略 3: 次要标识匹配（主板序列号）
  if (secondaryId) {
    device = await db.prepare(`
      SELECT * FROM device_whitelist 
      WHERE secondary_id = ? AND status = 'active'
    `).bind(secondaryId).first();
    
    if (device) {
      device.match_type = 'secondary';
      await db.prepare(`
        UPDATE device_whitelist 
        SET combined_id = ?, primary_id = ?, tertiary_id = ?
        WHERE id = ?
      `).bind(combinedId, primaryId, tertiaryId, device.id).run();
      return device;
    }
  }
  
  // 策略 4: 部分匹配（至少匹配 2 个）
  const result = await db.prepare(`
    SELECT *, 
      (CASE WHEN primary_id = ? THEN 1 ELSE 0 END +
       CASE WHEN secondary_id = ? THEN 1 ELSE 0 END +
       CASE WHEN tertiary_id = ? THEN 1 ELSE 0 END) as match_count
    FROM device_whitelist
    WHERE status = 'active'
    HAVING match_count >= 2
    ORDER BY match_count DESC
    LIMIT 1
  `).bind(primaryId, secondaryId || '', tertiaryId || '').first();
  
  if (result) {
    result.match_type = 'partial';
    await db.prepare(`
      UPDATE device_whitelist 
      SET combined_id = ?, primary_id = ?, secondary_id = ?, tertiary_id = ?
      WHERE id = ?
    `).bind(combinedId, primaryId, secondaryId, tertiaryId, result.id).run();
    return result;
  }
  
  return null;
}

/**
 * 更新访问记录
 */
async function updateAccessRecord(db, deviceId, matchType) {
  try {
    // 更新设备表
    await db.prepare(`
      UPDATE device_whitelist 
      SET last_seen = CURRENT_TIMESTAMP, access_count = access_count + 1
      WHERE id = ?
    `).bind(deviceId).run();
    
    // 可选：记录详细访问日志
    // await db.prepare(`
    //   INSERT INTO access_logs (device_id, match_type)
    //   VALUES (?, ?)
    // `).bind(deviceId, matchType).run();
  } catch (error) {
    console.error('更新访问记录失败:', error);
  }
}
```

### 4.4 主入口

创建文件 `src/index.js`：

```javascript
import { verifyDevice } from './auth.js';
import { jsonResponse } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }
    
    // 路由
    if (url.pathname === '/verify' && request.method === 'POST') {
      return verifyDevice(request, env);
    }
    
    // 健康检查
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }
    
    // 404
    return jsonResponse({ error: 'Not Found' }, 404);
  }
};
```

---

## 五、部署步骤

### 5.1 创建 D1 数据库

```bash
wrangler d1 create miko-bot-auth-db
```

输出示例：
```
✅ Successfully created DB 'miko-bot-auth-db'

[[d1_databases]]
binding = "DB"
database_name = "miko-bot-auth-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

将 `database_id` 复制到 `wrangler.toml` 中。

### 5.2 执行数据库迁移

```bash
wrangler d1 execute miko-bot-auth-db --file=schema.sql
```

### 5.3 部署 Workers

```bash
wrangler deploy
```

部署成功后会显示 URL，例如：
```
https://miko-bot-auth.your-username.workers.dev
```

### 5.4 测试部署

```bash
curl https://miko-bot-auth.your-username.workers.dev/health
# 应该返回: OK
```

---

## 六、管理白名单

### 6.1 添加设备到白名单

使用 Wrangler CLI 直接操作数据库：

```bash
wrangler d1 execute miko-bot-auth-db --command "
INSERT INTO device_whitelist (
  primary_id, 
  secondary_id, 
  tertiary_id, 
  combined_id, 
  user_name, 
  user_email,
  notes
) VALUES (
  'primary_hash_here',
  'secondary_hash_here',
  'tertiary_hash_here',
  'combined_hash_here',
  '用户名',
  'user@example.com',
  '备注信息'
);
"
```

### 6.2 查询所有设备

```bash
wrangler d1 execute miko-bot-auth-db --command "
SELECT id, user_name, status, created_at, last_seen, access_count 
FROM device_whitelist 
ORDER BY created_at DESC;
"
```

### 6.3 更新设备状态

```bash
# 暂停设备
wrangler d1 execute miko-bot-auth-db --command "
UPDATE device_whitelist 
SET status = 'suspended' 
WHERE id = 1;
"

# 恢复设备
wrangler d1 execute miko-bot-auth-db --command "
UPDATE device_whitelist 
SET status = 'active' 
WHERE id = 1;
"
```

### 6.4 设置过期时间

```bash
# 设置 30 天后过期
wrangler d1 execute miko-bot-auth-db --command "
UPDATE device_whitelist 
SET expires_at = datetime('now', '+30 days') 
WHERE id = 1;
"

# 设置永久授权
wrangler d1 execute miko-bot-auth-db --command "
UPDATE device_whitelist 
SET expires_at = NULL 
WHERE id = 1;
"
```

### 6.5 删除设备

```bash
wrangler d1 execute miko-bot-auth-db --command "
DELETE FROM device_whitelist 
WHERE id = 1;
"
```

---

## 七、Web 管理后台（可选）

如果需要图形化管理界面，可以创建一个简单的 Web 管理后台。

### 7.1 添加管理 API

在 `src/index.js` 中添加管理路由：

```javascript
// 在 src/index.js 中添加

// 简单的 API Key 验证
function verifyApiKey(request, env) {
  const apiKey = request.headers.get('X-API-Key');
  return apiKey === env.ADMIN_API_KEY;
}

// 添加到路由中
if (url.pathname === '/admin/devices' && request.method === 'GET') {
  if (!verifyApiKey(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  
  const devices = await env.DB.prepare(`
    SELECT id, user_name, user_email, status, created_at, expires_at, last_seen, access_count, notes
    FROM device_whitelist
    ORDER BY created_at DESC
  `).all();
  
  return jsonResponse(devices.results);
}

if (url.pathname === '/admin/devices' && request.method === 'POST') {
  if (!verifyApiKey(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  
  const data = await request.json();
  const result = await env.DB.prepare(`
    INSERT INTO device_whitelist 
    (primary_id, secondary_id, tertiary_id, combined_id, user_name, user_email, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.primary_id,
    data.secondary_id,
    data.tertiary_id,
    data.combined_id,
    data.user_name,
    data.user_email,
    data.notes
  ).run();
  
  return jsonResponse({ success: true, id: result.meta.last_row_id });
}
```

在 `wrangler.toml` 中添加 API Key：

```toml
[vars]
SECRET_SALT = "your-secret-salt"
ADMIN_API_KEY = "your-admin-api-key-change-this"
```

### 7.2 简单的 HTML 管理界面

创建文件 `admin.html`（可以托管在任何地方）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>设备授权管理后台</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { margin-bottom: 20px; color: #333; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th { background: #f8f9fa; font-weight: 600; }
    .status-active { color: #28a745; }
    .status-suspended { color: #dc3545; }
    .status-expired { color: #ffc107; }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .btn-primary { background: #007bff; color: white; }
    .btn-danger { background: #dc3545; color: white; }
    .btn-success { background: #28a745; color: white; }
    input, textarea {
      width: 100%;
      padding: 8px;
      margin: 8px 0;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 设备授权管理后台</h1>
    
    <div class="card">
      <h2>添加新设备</h2>
      <form id="addDeviceForm">
        <input type="text" id="primaryId" placeholder="Primary ID (必填)" required>
        <input type="text" id="secondaryId" placeholder="Secondary ID">
        <input type="text" id="tertiaryId" placeholder="Tertiary ID">
        <input type="text" id="combinedId" placeholder="Combined ID (必填)" required>
        <input type="text" id="userName" placeholder="用户名">
        <input type="email" id="userEmail" placeholder="用户邮箱">
        <textarea id="notes" placeholder="备注" rows="3"></textarea>
        <button type="submit" class="btn-primary">添加设备</button>
      </form>
    </div>
    
    <div class="card">
      <h2>设备列表</h2>
      <table id="devicesTable">
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>邮箱</th>
            <th>状态</th>
            <th>创建时间</th>
            <th>最后访问</th>
            <th>访问次数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="devicesBody">
          <tr><td colspan="8">加载中...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    const API_URL = 'https://miko-bot-auth.your-username.workers.dev';
    const API_KEY = 'your-admin-api-key';
    
    // 加载设备列表
    async function loadDevices() {
      try {
        const response = await fetch(`${API_URL}/admin/devices`, {
          headers: { 'X-API-Key': API_KEY }
        });
        const devices = await response.json();
        
        const tbody = document.getElementById('devicesBody');
        tbody.innerHTML = devices.map(device => `
          <tr>
            <td>${device.id}</td>
            <td>${device.user_name || '-'}</td>
            <td>${device.user_email || '-'}</td>
            <td class="status-${device.status}">${device.status}</td>
            <td>${new Date(device.created_at).toLocaleString()}</td>
            <td>${device.last_seen ? new Date(device.last_seen).toLocaleString() : '-'}</td>
            <td>${device.access_count}</td>
            <td>
              <button class="btn-danger" onclick="deleteDevice(${device.id})">删除</button>
            </td>
          </tr>
        `).join('');
      } catch (error) {
        console.error('加载失败:', error);
        alert('加载设备列表失败');
      }
    }
    
    // 添加设备
    document.getElementById('addDeviceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const data = {
        primary_id: document.getElementById('primaryId').value,
        secondary_id: document.getElementById('secondaryId').value,
        tertiary_id: document.getElementById('tertiaryId').value,
        combined_id: document.getElementById('combinedId').value,
        user_name: document.getElementById('userName').value,
        user_email: document.getElementById('userEmail').value,
        notes: document.getElementById('notes').value,
      };
      
      try {
        const response = await fetch(`${API_URL}/admin/devices`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY
          },
          body: JSON.stringify(data)
        });
        
        if (response.ok) {
          alert('添加成功');
          e.target.reset();
          loadDevices();
        } else {
          alert('添加失败');
        }
      } catch (error) {
        console.error('添加失败:', error);
        alert('添加失败');
      }
    });
    
    // 删除设备
    async function deleteDevice(id) {
      if (!confirm('确定要删除这个设备吗？')) return;
      
      // 这里需要添加删除 API
      alert('删除功能需要在服务器端实现');
    }
    
    // 初始加载
    loadDevices();
  </script>
</body>
</html>
```

---

## 八、监控和日志

### 8.1 查看 Workers 日志

```bash
wrangler tail
```

实时查看请求日志和错误信息。

### 8.2 查看访问统计

```bash
wrangler d1 execute miko-bot-auth-db --command "
SELECT 
  COUNT(*) as total_devices,
  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_devices,
  SUM(access_count) as total_accesses
FROM device_whitelist;
"
```

### 8.3 查看最近访问

```bash
wrangler d1 execute miko-bot-auth-db --command "
SELECT user_name, last_seen, access_count
FROM device_whitelist
WHERE last_seen IS NOT NULL
ORDER BY last_seen DESC
LIMIT 10;
"
```

---

## 九、备份和恢复

### 9.1 导出数据库

```bash
wrangler d1 export miko-bot-auth-db --output=backup.sql
```

### 9.2 恢复数据库

```bash
wrangler d1 execute miko-bot-auth-db --file=backup.sql
```

---

## 十、自定义域名（可选）

### 10.1 添加自定义域名

1. 在 Cloudflare Dashboard 中进入 Workers & Pages
2. 选择你的 Worker
3. 点击 "Triggers" → "Custom Domains"
4. 添加域名（如 `auth.your-domain.com`）

### 10.2 更新客户端配置

修改 `src-tauri/src/auth.rs` 中的 URL：

```rust
const AUTH_SERVER_URL: &str = "https://auth.your-domain.com/verify";
```

---

## 十一、安全建议

1. **保护 API Key**：不要将 `ADMIN_API_KEY` 提交到公开仓库
2. **使用强密钥**：`SECRET_SALT` 和 `ADMIN_API_KEY` 应该是长随机字符串
3. **定期备份**：每周备份一次数据库
4. **监控异常**：定期检查日志，发现异常访问
5. **限制访问**：可以添加 IP 白名单限制管理 API 访问

---

## 十二、故障排查

### 问题 1：签名验证失败

**原因**：客户端和服务器端的 `SECRET_SALT` 不一致

**解决**：确保两边的 `SECRET_SALT` 完全相同

### 问题 2：数据库连接失败

**原因**：`database_id` 配置错误

**解决**：检查 `wrangler.toml` 中的 `database_id` 是否正确

### 问题 3：CORS 错误

**原因**：缺少 CORS 头

**解决**：确保所有响应都包含 `Access-Control-Allow-Origin` 头

---

## 十三、成本估算

使用 Cloudflare 免费计划：

- **Workers**：每天 100,000 次请求（免费）
- **D1 数据库**：每天 100,000 次读写（免费）
- **存储**：5GB（免费）

对于大多数小型应用，完全免费即可满足需求。

---

## 十四、下一步

完成服务器部署后：

1. 测试授权流程
2. 添加第一个设备到白名单
3. 在客户端测试授权验证
4. 根据需要调整匹配策略
5. 设置监控和告警

如有问题，请参考 [DEVICE_AUTH.md](./DEVICE_AUTH.md) 中的客户端集成指南。
