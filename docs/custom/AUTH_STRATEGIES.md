# 授权策略和行为配置指南

## 概述

本文档说明在不同授权场景下可以实现的各种行为策略，包括网络错误、未授权、过期等情况的处理方式。

---

## 一、场景分类

### 场景 1：网络错误（无法连接授权服务器）

**可能原因**：
- 用户网络断开
- 授权服务器宕机
- 防火墙阻止
- DNS 解析失败

**可选行为**：

#### 策略 A：完全阻止（最严格）
```rust
Err(e) => {
    eprintln!("[授权] ❌ 网络错误: {}", e);
    show_error_dialog("无法连接到授权服务器，应用无法启动");
    std::process::exit(1);
}
```
- ✅ 安全性最高
- ❌ 用户体验差（网络问题导致无法使用）

---

#### 策略 B：宽限期（推荐）
```rust
Err(e) => {
    eprintln!("[授权] ⚠️ 网络错误: {}", e);
    
    // 检查上次成功验证的时间
    if let Some(last_verified) = get_last_verified_time() {
        let grace_period = Duration::from_secs(7 * 24 * 3600); // 7天
        
        if Utc::now().signed_duration_since(last_verified) < grace_period {
            show_warning_dialog("离线模式：无法连接授权服务器，使用缓存授权（剩余X天）");
            // 继续启动应用
        } else {
            show_error_dialog("离线时间过长，请连接网络验证授权");
            std::process::exit(1);
        }
    } else {
        // 首次启动必须联网验证
        show_error_dialog("首次启动需要联网验证授权");
        std::process::exit(1);
    }
}
```
- ✅ 平衡安全性和用户体验
- ✅ 允许短期离线使用
- ✅ 防止长期绕过授权

---

#### 策略 C：降级模式
```rust
Err(e) => {
    eprintln!("[授权] ⚠️ 网络错误: {}", e);
    show_warning_dialog("无法验证授权，进入受限模式");
    
    // 启动应用但限制功能
    enable_limited_mode();
    // 例如：禁用某些功能、添加水印、限制使用时间等
}
```
- ✅ 用户可以继续使用基本功能
- ⚠️ 需要在应用内实现功能限制

---

#### 策略 D：完全信任（最宽松）
```rust
Err(e) => {
    eprintln!("[授权] ⚠️ 网络错误: {}", e);
    show_warning_dialog("无法连接授权服务器，继续使用");
    // 直接继续启动，不做任何限制
}
```
- ✅ 用户体验最好
- ❌ 安全性最低（可以断网绕过授权）

---

### 场景 2：设备未授权

**原因**：
- 设备不在白名单中
- 首次安装未授权

**可选行为**：

#### 策略 A：完全阻止 + 提供设备 ID
```rust
if !response.authorized {
    let fingerprints = get_device_fingerprints();
    
    show_unauthorized_dialog(&format!(
        "设备未授权\n\n您的设备 ID：\n{}\n\n请将此 ID 发送给管理员申请授权",
        fingerprints.combined_id
    ));
    
    // 提供复制按钮
    copy_to_clipboard(&fingerprints.combined_id);
    
    std::process::exit(1);
}
```
- ✅ 清晰的授权流程
- ✅ 方便用户获取设备 ID

---

#### 策略 B：试用模式
```rust
if !response.authorized {
    // 检查是否在试用期内
    if is_within_trial_period() {
        let remaining_days = get_trial_remaining_days();
        show_trial_dialog(&format!(
            "试用模式：剩余 {} 天\n\n请尽快申请正式授权",
            remaining_days
        ));
        // 继续启动，但标记为试用模式
        enable_trial_mode();
    } else {
        show_error_dialog("试用期已结束，请申请正式授权");
        std::process::exit(1);
    }
}
```
- ✅ 允许用户试用
- ✅ 增加转化率

---

#### 策略 C：功能限制模式
```rust
if !response.authorized {
    show_warning_dialog("未授权设备，部分功能受限");
    enable_limited_features();
    // 例如：
    // - 添加水印
    // - 限制使用时长（每次30分钟）
    // - 禁用高级功能
    // - 定期弹出授权提示
}
```
- ✅ 用户可以体验基本功能
- ✅ 激励用户购买授权

---

### 场景 3：授权已过期

**原因**：
- 订阅到期
- 临时授权过期

**可选行为**：

#### 策略 A：立即阻止
```rust
if device.expires_at && is_expired(device.expires_at) {
    show_error_dialog("授权已过期，请续费");
    std::process::exit(1);
}
```

---

#### 策略 B：宽限期
```rust
if device.expires_at && is_expired(device.expires_at) {
    let days_expired = get_days_since_expiry(device.expires_at);
    
    if days_expired <= 7 {
        show_warning_dialog(&format!(
            "授权已过期 {} 天，请尽快续费\n宽限期剩余 {} 天",
            days_expired,
            7 - days_expired
        ));
        // 继续使用
    } else {
        show_error_dialog("宽限期已结束，请续费");
        std::process::exit(1);
    }
}
```

---

#### 策略 C：降级到免费版
```rust
if device.expires_at && is_expired(device.expires_at) {
    show_warning_dialog("订阅已过期，已切换到免费版");
    enable_free_tier();
    // 禁用付费功能，保留基础功能
}
```

---

### 场景 4：设备被暂停

**原因**：
- 管理员手动暂停
- 检测到异常行为
- 违反使用条款

**可选行为**：

#### 策略 A：完全阻止
```rust
if device.status == "suspended" {
    show_error_dialog("您的设备已被暂停，请联系管理员");
    std::process::exit(1);
}
```

---

#### 策略 B：显示原因
```rust
if device.status == "suspended" {
    show_error_dialog(&format!(
        "您的设备已被暂停\n\n原因：{}\n\n请联系管理员：admin@example.com",
        device.suspension_reason
    ));
    std::process::exit(1);
}
```

---

## 二、推荐策略组合

### 组合 A：严格模式（适合高安全需求）

```rust
pub async fn verify_with_strict_mode() -> Result<(), String> {
    match verify_device_authorization().await {
        Ok(response) => {
            if response.authorized {
                // ✅ 授权成功
                Ok(())
            } else {
                // ❌ 未授权：完全阻止
                show_unauthorized_with_device_id();
                Err("设备未授权".to_string())
            }
        }
        Err(e) => {
            // ❌ 网络错误：完全阻止
            show_error_dialog(&format!("无法验证授权: {}", e));
            Err(e)
        }
    }
}
```

**特点**：
- 任何问题都阻止启动
- 安全性最高
- 适合企业内部应用

---

### 组合 B：平衡模式（推荐）

```rust
pub async fn verify_with_balanced_mode() -> Result<(), String> {
    match verify_device_authorization().await {
        Ok(response) => {
            if response.authorized {
                // ✅ 授权成功
                save_last_verified_time(Utc::now());
                Ok(())
            } else {
                // ❌ 未授权：检查试用期
                if is_within_trial_period() {
                    show_trial_warning();
                    enable_trial_mode();
                    Ok(())
                } else {
                    show_unauthorized_with_device_id();
                    Err("设备未授权".to_string())
                }
            }
        }
        Err(e) => {
            // ⚠️ 网络错误：使用宽限期
            if let Some(last_verified) = get_last_verified_time() {
                let grace_period = Duration::from_secs(7 * 24 * 3600);
                
                if Utc::now().signed_duration_since(last_verified) < grace_period {
                    show_offline_warning();
                    Ok(())
                } else {
                    show_error_dialog("离线时间过长，请联网验证");
                    Err("离线时间过长".to_string())
                }
            } else {
                show_error_dialog("首次启动需要联网验证");
                Err("需要联网验证".to_string())
            }
        }
    }
}
```

**特点**：
- 允许试用
- 允许短期离线
- 平衡安全性和用户体验
- **推荐用于商业应用**

---

### 组合 C：宽松模式（适合个人项目）

```rust
pub async fn verify_with_relaxed_mode() -> Result<(), String> {
    match verify_device_authorization().await {
        Ok(response) => {
            if response.authorized {
                // ✅ 授权成功
                Ok(())
            } else {
                // ⚠️ 未授权：显示警告但允许使用
                show_warning_dialog("设备未授权，部分功能可能受限");
                enable_limited_mode();
                Ok(())
            }
        }
        Err(e) => {
            // ⚠️ 网络错误：显示警告但允许使用
            show_warning_dialog(&format!("无法验证授权: {}", e));
            Ok(())
        }
    }
}
```

**特点**：
- 几乎不阻止使用
- 用户体验最好
- 适合个人项目或内部工具

---

## 三、实现示例

### 3.1 宽限期实现

创建文件 `src-tauri/src/grace_period.rs`：

```rust
use chrono::{DateTime, Utc, Duration};
use std::fs;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
struct AuthCache {
    last_verified: DateTime<Utc>,
    device_id: String,
}

fn get_cache_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap();
    path.push("miko-bot");
    path.push("auth_cache.json");
    path
}

/// 保存最后验证时间
pub fn save_last_verified_time(device_id: &str) {
    let cache = AuthCache {
        last_verified: Utc::now(),
        device_id: device_id.to_string(),
    };
    
    let path = get_cache_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = fs::write(path, json);
    }
}

/// 获取最后验证时间
pub fn get_last_verified_time() -> Option<DateTime<Utc>> {
    let path = get_cache_path();
    let content = fs::read_to_string(path).ok()?;
    let cache: AuthCache = serde_json::from_str(&content).ok()?;
    Some(cache.last_verified)
}

/// 检查是否在宽限期内
pub fn is_within_grace_period(grace_days: i64) -> bool {
    if let Some(last_verified) = get_last_verified_time() {
        let grace_period = Duration::days(grace_days);
        Utc::now().signed_duration_since(last_verified) < grace_period
    } else {
        false
    }
}

/// 获取宽限期剩余天数
pub fn get_grace_remaining_days(grace_days: i64) -> i64 {
    if let Some(last_verified) = get_last_verified_time() {
        let elapsed = Utc::now().signed_duration_since(last_verified);
        let remaining = Duration::days(grace_days) - elapsed;
        remaining.num_days().max(0)
    } else {
        0
    }
}
```

### 3.2 试用期实现

创建文件 `src-tauri/src/trial.rs`：

```rust
use chrono::{DateTime, Utc, Duration};
use std::fs;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
struct TrialInfo {
    first_run: DateTime<Utc>,
    trial_days: i64,
}

fn get_trial_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap();
    path.push("miko-bot");
    path.push("trial.json");
    path
}

/// 初始化试用期
pub fn init_trial(trial_days: i64) {
    let path = get_trial_path();
    
    // 如果已存在，不覆盖
    if path.exists() {
        return;
    }
    
    let trial = TrialInfo {
        first_run: Utc::now(),
        trial_days,
    };
    
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    
    if let Ok(json) = serde_json::to_string(&trial) {
        let _ = fs::write(path, json);
    }
}

/// 检查是否在试用期内
pub fn is_within_trial_period() -> bool {
    let path = get_trial_path();
    let content = fs::read_to_string(path).ok();
    
    if let Some(content) = content {
        if let Ok(trial) = serde_json::from_str::<TrialInfo>(&content) {
            let elapsed = Utc::now().signed_duration_since(trial.first_run);
            return elapsed < Duration::days(trial.trial_days);
        }
    }
    
    false
}

/// 获取试用期剩余天数
pub fn get_trial_remaining_days() -> i64 {
    let path = get_trial_path();
    let content = fs::read_to_string(path).ok();
    
    if let Some(content) = content {
        if let Ok(trial) = serde_json::from_str::<TrialInfo>(&content) {
            let elapsed = Utc::now().signed_duration_since(trial.first_run);
            let remaining = Duration::days(trial.trial_days) - elapsed;
            return remaining.num_days().max(0);
        }
    }
    
    0
}
```

### 3.3 完整的平衡模式实现

修改 `src-tauri/src/auth.rs`：

```rust
use crate::grace_period::{save_last_verified_time, is_within_grace_period, get_grace_remaining_days};
use crate::trial::{init_trial, is_within_trial_period, get_trial_remaining_days};

const GRACE_PERIOD_DAYS: i64 = 7;  // 宽限期天数
const TRIAL_PERIOD_DAYS: i64 = 30; // 试用期天数

/// 平衡模式验证
pub async fn verify_with_balanced_mode() -> Result<(), String> {
    match verify_device_authorization().await {
        Ok(response) => {
            if response.authorized {
                // ✅ 授权成功
                println!("[授权] ✅ 设备已授权");
                
                // 保存验证时间
                let fingerprints = get_device_fingerprints();
                save_last_verified_time(&fingerprints.combined_id);
                
                Ok(())
            } else {
                // ❌ 未授权：检查试用期
                println!("[授权] ⚠️ 设备未授权，检查试用期");
                
                // 初始化试用期（如果是首次运行）
                init_trial(TRIAL_PERIOD_DAYS);
                
                if is_within_trial_period() {
                    let remaining = get_trial_remaining_days();
                    println!("[授权] ℹ️ 试用模式：剩余 {} 天", remaining);
                    
                    show_trial_dialog(&format!(
                        "试用模式\n\n剩余 {} 天\n\n您的设备 ID：\n{}\n\n请将此 ID 发送给管理员申请正式授权",
                        remaining,
                        get_device_fingerprints().combined_id
                    ));
                    
                    Ok(())
                } else {
                    println!("[授权] ❌ 试用期已结束");
                    
                    show_error_dialog(&format!(
                        "试用期已结束\n\n您的设备 ID：\n{}\n\n请联系管理员申请授权",
                        get_device_fingerprints().combined_id
                    ));
                    
                    Err("试用期已结束".to_string())
                }
            }
        }
        Err(e) => {
            // ⚠️ 网络错误：使用宽限期
            println!("[授权] ⚠️ 网络错误: {}", e);
            
            if is_within_grace_period(GRACE_PERIOD_DAYS) {
                let remaining = get_grace_remaining_days(GRACE_PERIOD_DAYS);
                println!("[授权] ℹ️ 离线模式：宽限期剩余 {} 天", remaining);
                
                show_warning_dialog(&format!(
                    "离线模式\n\n无法连接授权服务器\n使用缓存授权\n\n宽限期剩余 {} 天\n请尽快联网验证",
                    remaining
                ));
                
                Ok(())
            } else {
                println!("[授权] ❌ 离线时间过长或首次启动");
                
                show_error_dialog(&format!(
                    "无法验证授权\n\n{}\n\n请检查网络连接后重试",
                    e
                ));
                
                Err("离线时间过长".to_string())
            }
        }
    }
}

// 对话框辅助函数
fn show_trial_dialog(message: &str) {
    // 使用 Tauri 对话框或自定义 UI
    eprintln!("[试用] {}", message);
}

fn show_warning_dialog(message: &str) {
    eprintln!("[警告] {}", message);
}

fn show_error_dialog(message: &str) {
    eprintln!("[错误] {}", message);
}
```

---

## 四、配置建议

### 4.1 根据应用类型选择策略

| 应用类型 | 推荐策略 | 理由 |
|---------|---------|------|
| **企业内部工具** | 严格模式 | 安全性优先，网络稳定 |
| **商业软件** | 平衡模式 | 平衡安全和体验 |
| **个人项目** | 宽松模式 | 用户体验优先 |
| **SaaS 应用** | 平衡模式 + 订阅 | 支持试用和订阅 |

### 4.2 参数配置

```rust
// 在 auth.rs 中配置
const GRACE_PERIOD_DAYS: i64 = 7;   // 离线宽限期（天）
const TRIAL_PERIOD_DAYS: i64 = 30;  // 试用期（天）
const MAX_OFFLINE_DAYS: i64 = 30;   // 最长离线时间（天）
```

---

## 五、用户体验优化

### 5.1 友好的错误提示

```rust
fn show_friendly_error(error_type: &str) {
    let message = match error_type {
        "network" => "😕 无法连接到授权服务器\n\n请检查：\n• 网络连接是否正常\n• 防火墙是否阻止了应用\n• VPN 是否影响连接",
        "unauthorized" => "🔒 设备未授权\n\n如需使用本应用，请：\n1. 复制下方的设备 ID\n2. 发送给管理员申请授权\n3. 等待管理员添加到白名单",
        "expired" => "⏰ 授权已过期\n\n您的授权已于 X 天前过期\n请联系管理员续费",
        _ => "❌ 未知错误",
    };
    
    show_dialog(message);
}
```

### 5.2 提供自助服务

```rust
fn show_unauthorized_with_actions() {
    let fingerprints = get_device_fingerprints();
    
    // 显示对话框，包含：
    // 1. 设备 ID（可复制）
    // 2. "复制设备 ID" 按钮
    // 3. "发送邮件给管理员" 按钮
    // 4. "查看帮助文档" 按钮
    // 5. "退出" 按钮
}
```

---

## 六、总结

选择合适的策略需要考虑：

1. **安全需求**：数据敏感度、防盗版需求
2. **用户场景**：网络稳定性、使用频率
3. **商业模式**：免费/付费、订阅/买断
4. **技术能力**：开发成本、维护成本

**推荐配置**：
- 生产环境：平衡模式（7天宽限期 + 30天试用期）
- 开发环境：宽松模式（方便测试）
- 企业版：严格模式（安全优先）
