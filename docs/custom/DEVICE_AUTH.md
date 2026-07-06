# 设备授权机制 - Pake 集成指南

## 概述

本文档说明如何在 Pake 中集成设备白名单授权机制。该机制通过获取硬件信息生成设备指纹，在应用启动时验证授权，防止未授权使用。

## 核心特性

- ✅ 基于硬件信息的设备识别（BIOS UUID、主板序列号、硬盘序列号）
- ✅ 重装应用/系统无需重新授权
- ✅ 多重匹配策略（容错机制）
- ✅ 签名验证防伪造
- ✅ 防重放攻击
- ✅ 支持授权过期时间

## 工作原理

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Tauri 应用    │ ──────> │  授权服务器 API   │ ──────> │  白名单数据库    │
│  (客户端)       │  HTTPS  │ (Cloudflare      │         │  (D1/SQLite)    │
│                 │         │  Workers)        │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
        │                            │                            │
   获取硬件信息              验证设备指纹                   查询白名单
   生成设备指纹              检查授权状态                   记录访问日志
   发送 HTTP 请求            返回授权结果                   更新统计数据
```

### 设备指纹生成

应用启动时自动收集以下硬件信息：

1. **BIOS/UEFI UUID**（最稳定，优先级最高）
2. **主板序列号**（次稳定）
3. **硬盘序列号**（较稳定）

每个信息单独生成哈希值，同时生成组合哈希作为主要标识。

### 验证策略

服务器采用多重匹配策略：

1. **完全匹配**：组合哈希完全匹配（最理想）
2. **主要匹配**：BIOS UUID 匹配（硬盘可能更换）
3. **次要匹配**：主板序列号匹配（BIOS 可能重置）
4. **部分匹配**：至少 2 个指纹匹配（硬件升级场景）

---

## 一、Pake 客户端修改

### 1.1 添加 Rust 依赖

编辑 `src-tauri/Cargo.toml`，添加以下依赖：

```toml
[dependencies]
# 现有依赖...
sha2 = "0.10"
hex = "0.4"
reqwest = { version = "0.11", features = ["json", "rustls-tls"], default-features = false }
chrono = "0.4"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

### 1.2 创建硬件信息模块

创建文件 `src-tauri/src/hardware.rs`：

```rust
use std::process::Command;
use sha2::{Sha256, Digest};

/// 硬件信息结构
#[derive(Debug, Clone)]
pub struct HardwareInfo {
    pub bios_uuid: Option<String>,
    pub motherboard_serial: Option<String>,
    pub disk_serial: Option<String>,
}

impl HardwareInfo {
    /// 获取当前设备的硬件信息
    pub fn collect() -> Self {
        Self {
            bios_uuid: get_bios_uuid(),
            motherboard_serial: get_motherboard_serial(),
            disk_serial: get_disk_serial(),
        }
    }
    
    /// 生成设备指纹
    pub fn generate_fingerprints(&self, salt: &str) -> DeviceFingerprints {
        DeviceFingerprints {
            primary_id: hash_value(&self.bios_uuid, salt),
            secondary_id: hash_value(&self.motherboard_serial, salt),
            tertiary_id: hash_value(&self.disk_serial, salt),
            combined_id: self.generate_combined_hash(salt),
        }
    }
    
    /// 生成组合哈希
    fn generate_combined_hash(&self, salt: &str) -> String {
        let mut data = String::new();
        
        if let Some(uuid) = &self.bios_uuid {
            data.push_str(uuid);
        }
        if let Some(serial) = &self.motherboard_serial {
            data.push_str(serial);
        }
        if let Some(disk) = &self.disk_serial {
            data.push_str(disk);
        }
        
        data.push_str(salt);
        
        let mut hasher = Sha256::new();
        hasher.update(data.as_bytes());
        hex::encode(hasher.finalize())
    }
}

/// 设备指纹结构
#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceFingerprints {
    pub primary_id: String,      // BIOS UUID 哈希
    pub secondary_id: String,    // 主板序列号哈希
    pub tertiary_id: String,     // 硬盘序列号哈希
    pub combined_id: String,     // 组合哈希
}

/// 哈希单个值
fn hash_value(value: &Option<String>, salt: &str) -> String {
    let data = format!("{}{}", value.as_deref().unwrap_or("unknown"), salt);
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

// ============ macOS 实现 ============

#[cfg(target_os = "macos")]
fn get_bios_uuid() -> Option<String> {
    let output = Command::new("system_profiler")
        .args(&["SPHardwareDataType"])
        .output()
        .ok()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    for line in stdout.lines() {
        if line.contains("Hardware UUID") {
            return line.split(':').nth(1).map(|s| s.trim().to_string());
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn get_motherboard_serial() -> Option<String> {
    let output = Command::new("system_profiler")
        .args(&["SPHardwareDataType"])
        .output()
        .ok()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    for line in stdout.lines() {
        if line.contains("Serial Number (system)") {
            return line.split(':').nth(1).map(|s| s.trim().to_string());
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn get_disk_serial() -> Option<String> {
    let output = Command::new("diskutil")
        .args(&["info", "disk0"])
        .output()
        .ok()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    for line in stdout.lines() {
        if line.contains("Volume UUID") || line.contains("Disk / Partition UUID") {
            return line.split(':').nth(1).map(|s| s.trim().to_string());
        }
    }
    None
}

// ============ Windows 实现 ============

#[cfg(target_os = "windows")]
fn get_bios_uuid() -> Option<String> {
    let output = Command::new("wmic")
        .args(&["csproduct", "get", "uuid"])
        .output()
        .ok()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().nth(1).map(|s| s.trim().to_string())
}

#[cfg(target_os = "windows")]
fn get_motherboard_serial() -> Option<String> {
    let output = Command::new("wmic")
        .args(&["baseboard", "get", "serialnumber"])
        .output()
        .ok()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().nth(1).map(|s| s.trim().to_string())
}

#[cfg(target_os = "windows")]
fn get_disk_serial() -> Option<String> {
    let output = Command::new("wmic")
        .args(&["diskdrive", "get", "serialnumber"])
        .output()
        .ok()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().nth(1).map(|s| s.trim().to_string())
}

// ============ Linux 实现 ============

#[cfg(target_os = "linux")]
fn get_bios_uuid() -> Option<String> {
    std::fs::read_to_string("/sys/class/dmi/id/product_uuid")
        .ok()
        .map(|s| s.trim().to_string())
}

#[cfg(target_os = "linux")]
fn get_motherboard_serial() -> Option<String> {
    std::fs::read_to_string("/sys/class/dmi/id/board_serial")
        .ok()
        .map(|s| s.trim().to_string())
}

#[cfg(target_os = "linux")]
fn get_disk_serial() -> Option<String> {
    let output = Command::new("lsblk")
        .args(&["-o", "NAME,SERIAL", "-n"])
        .output()
        .ok()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().and_then(|line| {
        line.split_whitespace().nth(1).map(|s| s.to_string())
    })
}
```

### 1.3 创建授权验证模块

创建文件 `src-tauri/src/auth.rs`：

```rust
use crate::hardware::{HardwareInfo, DeviceFingerprints};
use chrono::Utc;
use sha2::{Sha256, Digest};
use hex;

// 配置常量（需要修改为你的实际值）
const AUTH_SERVER_URL: &str = "https://auth.your-domain.com/verify";
const SECRET_SALT: &str = "your-secret-salt-change-this-to-random-string";

/// 授权响应
#[derive(Debug, serde::Deserialize)]
pub struct AuthResponse {
    pub authorized: bool,
    pub message: Option<String>,
    pub match_type: Option<String>,
}

/// 验证设备授权
pub async fn verify_device_authorization() -> Result<AuthResponse, String> {
    // 1. 获取硬件信息
    let hw_info = HardwareInfo::collect();
    
    // 2. 生成设备指纹
    let fingerprints = hw_info.generate_fingerprints(SECRET_SALT);
    
    // 3. 生成时间戳
    let timestamp = Utc::now().timestamp().to_string();
    
    // 4. 生成签名
    let signature = generate_signature(&fingerprints.combined_id, &timestamp);
    
    // 5. 发送验证请求
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    
    let response = client
        .post(AUTH_SERVER_URL)
        .header("miko-device-primary", &fingerprints.primary_id)
        .header("miko-device-secondary", &fingerprints.secondary_id)
        .header("miko-device-tertiary", &fingerprints.tertiary_id)
        .header("miko-device-combined", &fingerprints.combined_id)
        .header("miko-timestamp", &timestamp)
        .header("miko-signature", &signature)
        .header("miko-name", "q9tj1ry") // 原有的自定义 header
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    // 6. 解析响应
    if response.status().is_success() {
        let auth_response: AuthResponse = response
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;
        Ok(auth_response)
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!("授权失败: HTTP {} - {}", status, body))
    }
}

/// 生成签名（防止伪造）
fn generate_signature(device_id: &str, timestamp: &str) -> String {
    let data = format!("{}{}{}", device_id, timestamp, SECRET_SALT);
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

/// 获取设备指纹（用于管理员添加白名单）
#[tauri::command]
pub fn get_device_fingerprints() -> DeviceFingerprints {
    let hw_info = HardwareInfo::collect();
    hw_info.generate_fingerprints(SECRET_SALT)
}
```

### 1.4 修改 lib.rs

编辑 `src-tauri/src/lib.rs`，添加模块声明：

```rust
mod app;
mod util;
mod hardware;  // 新增
mod auth;      // 新增

use auth::{verify_device_authorization, get_device_fingerprints};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 在应用启动时验证授权
            tauri::async_runtime::block_on(async {
                println!("[授权] 正在验证设备授权...");
                
                match verify_device_authorization().await {
                    Ok(response) => {
                        if response.authorized {
                            println!("[授权] ✅ 设备已授权");
                            if let Some(match_type) = response.match_type {
                                println!("[授权] 匹配类型: {}", match_type);
                            }
                        } else {
                            let message = response.message.unwrap_or_else(|| "设备未授权".to_string());
                            eprintln!("[授权] ❌ {}", message);
                            
                            // 显示错误对话框
                            tauri::api::dialog::message(
                                app.get_window("main").as_ref(),
                                "授权失败",
                                &message
                            );
                            
                            // 退出应用
                            std::process::exit(1);
                        }
                    }
                    Err(e) => {
                        eprintln!("[授权] ❌ 验证失败: {}", e);
                        
                        tauri::api::dialog::message(
                            app.get_window("main").as_ref(),
                            "授权验证失败",
                            &format!("无法连接到授权服务器: {}", e)
                        );
                        
                        std::process::exit(1);
                    }
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_device_fingerprints])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 1.5 添加获取设备指纹的命令（可选）

如果需要在应用内显示设备指纹（方便用户提供给管理员），可以在前端调用：

```javascript
// 在网站的 JavaScript 中调用
if (window.__TAURI__) {
  window.__TAURI__.invoke('get_device_fingerprints').then(fingerprints => {
    console.log('设备指纹:', fingerprints);
    // 可以显示在页面上，让用户复制
  });
}
```

---

## 二、如何接入 Pake 打包的网站

### 方案 A：在 Tauri 层拦截（推荐）

**优点**：网站代码无需修改，授权逻辑完全在 Tauri 层处理

**实现方式**：已在上面的代码中实现，应用启动时自动验证，验证失败则退出应用。

---

### 方案 B：在网站层验证

如果你希望在网站内部也能感知授权状态，可以通过 Tauri 命令暴露授权信息：

#### 2.1 添加 Tauri 命令

在 `src-tauri/src/auth.rs` 中添加：

```rust
/// 检查授权状态（供前端调用）
#[tauri::command]
pub async fn check_authorization() -> Result<AuthResponse, String> {
    verify_device_authorization().await
}
```

在 `lib.rs` 中注册命令：

```rust
.invoke_handler(tauri::generate_handler![
    get_device_fingerprints,
    check_authorization  // 新增
])
```

#### 2.2 在网站中调用

在你的网站 JavaScript 中：

```javascript
// 检查是否在 Tauri 环境中
if (window.__TAURI__) {
  // 检查授权状态
  window.__TAURI__.invoke('check_authorization')
    .then(response => {
      if (response.authorized) {
        console.log('✅ 设备已授权');
        // 显示正常内容
      } else {
        console.error('❌ 设备未授权:', response.message);
        // 显示未授权提示
        showUnauthorizedMessage(response.message);
      }
    })
    .catch(error => {
      console.error('授权验证失败:', error);
      showErrorMessage(error);
    });
}

function showUnauthorizedMessage(message) {
  document.body.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column;">
      <h1>🔒 设备未授权</h1>
      <p>${message}</p>
      <p>请联系管理员获取授权</p>
      <button onclick="copyDeviceId()">复制设备 ID</button>
    </div>
  `;
}

function copyDeviceId() {
  window.__TAURI__.invoke('get_device_fingerprints')
    .then(fingerprints => {
      navigator.clipboard.writeText(fingerprints.combined_id);
      alert('设备 ID 已复制到剪贴板');
    });
}
```

---

### 方案 C：通过 HTTP Header 传递到后端

如果你的网站有后端服务，可以将设备指纹通过 HTTP Header 传递：

#### 3.1 修改 window.rs

编辑 `src-tauri/src/app/window.rs`，在创建 WebView 时注入设备指纹：

```rust
use crate::hardware::HardwareInfo;
use crate::auth::SECRET_SALT;

pub fn create_window(app: &tauri::AppHandle, url: &str) -> Result<(), Box<dyn std::error::Error>> {
    // 获取设备指纹
    let hw_info = HardwareInfo::collect();
    let fingerprints = hw_info.generate_fingerprints(SECRET_SALT);
    
    // 创建窗口时添加自定义 headers
    let window = tauri::WindowBuilder::new(
        app,
        "main",
        tauri::WindowUrl::External(url.parse()?)
    )
    .title("Miko-bot")
    .inner_size(1400.0, 900.0)
    .build()?;
    
    // 注入 JavaScript，在所有请求中添加设备指纹
    window.eval(&format!(r#"
        (function() {{
            const originalFetch = window.fetch;
            window.fetch = function(...args) {{
                if (args[1]) {{
                    args[1].headers = args[1].headers || {{}};
                    args[1].headers['miko-device-primary'] = '{}';
                    args[1].headers['miko-device-combined'] = '{}';
                }} else {{
                    args[1] = {{
                        headers: {{
                            'miko-device-primary': '{}',
                            'miko-device-combined': '{}'
                        }}
                    }};
                }}
                return originalFetch.apply(this, args);
            }};
        }})();
    "#, 
        fingerprints.primary_id,
        fingerprints.combined_id,
        fingerprints.primary_id,
        fingerprints.combined_id
    ))?;
    
    Ok(())
}
```

这样，网站发出的所有 HTTP 请求都会自动带上设备指纹 Header，你的后端可以验证这些 Header。

---

## 三、配置说明

### 3.1 修改配置常量

在 `src-tauri/src/auth.rs` 中修改以下常量：

```rust
// 授权服务器地址（部署后的 Cloudflare Workers URL）
const AUTH_SERVER_URL: &str = "https://auth.your-domain.com/verify";

// 密钥盐值（用于生成哈希，必须保密且唯一）
const SECRET_SALT: &str = "your-secret-salt-change-this-to-random-string";
```

**重要**：
- `SECRET_SALT` 必须是一个随机字符串，建议使用 32 位以上的随机字符
- 客户端和服务器端必须使用相同的 `SECRET_SALT`
- 不要将 `SECRET_SALT` 提交到公开的代码仓库

### 3.2 生成随机盐值

```bash
# macOS/Linux
openssl rand -hex 32

# 或者使用 Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## 四、编译和测试

### 4.1 编译检查

```bash
cd src-tauri
cargo check
cargo build --release
```

### 4.2 获取设备指纹

首次运行应用时，可以在终端看到设备指纹信息：

```bash
# 运行应用
cargo run

# 输出示例：
# [授权] 正在验证设备授权...
# [授权] ✅ 设备已授权
# [授权] 匹配类型: exact
```

或者添加一个临时命令来打印设备指纹：

```rust
// 在 main.rs 或 lib.rs 中临时添加
let hw_info = HardwareInfo::collect();
let fingerprints = hw_info.generate_fingerprints(SECRET_SALT);
println!("设备指纹: {:?}", fingerprints);
```

### 4.3 测试授权流程

1. **未授权测试**：直接运行应用，应该显示"设备未授权"并退出
2. **添加白名单**：将设备指纹添加到服务器白名单（参见管理后台文档）
3. **授权测试**：再次运行应用，应该正常启动

---

## 五、常见问题

### Q1: 如何在不同环境使用不同的授权服务器？

可以使用环境变量或编译时特性：

```rust
#[cfg(debug_assertions)]
const AUTH_SERVER_URL: &str = "http://localhost:8787/verify";

#[cfg(not(debug_assertions))]
const AUTH_SERVER_URL: &str = "https://auth.your-domain.com/verify";
```

### Q2: 如何禁用授权验证（开发环境）？

```rust
#[cfg(debug_assertions)]
pub async fn verify_device_authorization() -> Result<AuthResponse, String> {
    // 开发环境跳过验证
    Ok(AuthResponse {
        authorized: true,
        message: Some("开发模式".to_string()),
        match_type: Some("dev".to_string()),
    })
}

#[cfg(not(debug_assertions))]
pub async fn verify_device_authorization() -> Result<AuthResponse, String> {
    // 生产环境正常验证
    // ... 原有代码
}
```

### Q3: 授权验证失败时如何优雅降级？

可以修改 `lib.rs` 中的错误处理逻辑：

```rust
match verify_device_authorization().await {
    Ok(response) => {
        if !response.authorized {
            // 选项 1: 显示警告但允许继续使用（试用模式）
            show_trial_mode_warning();
            
            // 选项 2: 限制功能
            enable_limited_features();
            
            // 选项 3: 完全阻止（当前实现）
            std::process::exit(1);
        }
    }
    Err(e) => {
        // 网络错误时的处理
        // 可以选择允许离线使用一段时间
        if is_within_grace_period() {
            show_offline_warning();
        } else {
            std::process::exit(1);
        }
    }
}
```

### Q4: 如何更新已授权设备的信息？

服务器端会自动更新设备信息。当硬件发生变化（如更换硬盘）时，如果能匹配到 BIOS UUID，服务器会自动更新其他指纹信息。

---

## 六、安全建议

1. **保护密钥**：`SECRET_SALT` 必须保密，不要提交到公开仓库
2. **使用 HTTPS**：授权服务器必须使用 HTTPS
3. **定期更换密钥**：建议每年更换一次 `SECRET_SALT`（需要重新生成所有设备指纹）
4. **监控异常**：在服务器端监控异常的授权请求（如频繁失败）
5. **备份白名单**：定期备份白名单数据库

---

## 七、下一步

完成 Pake 集成后，请参考 [AUTH_SERVER.md](./AUTH_SERVER.md) 部署授权服务器和管理后台。
