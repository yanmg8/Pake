# 出口 IP 显示功能

## 功能说明

在所有打包的应用窗口右下角自动显示当前的出口 IP 地址。这对于使用代理或需要确认网络出口的场景非常有用。

## 功能特性

### 🎯 核心功能
- ✅ **自动显示**：应用启动后自动获取并显示出口 IP
- ✅ **右下角悬浮**：固定在窗口右下角，不影响页面内容
- ✅ **点击复制**：点击 IP 地址即可复制到剪贴板
- ✅ **自动刷新**：每 5 分钟自动更新一次 IP
- ✅ **多源备份**：使用多个 IP 查询服务，确保可靠性
- ✅ **优雅样式**：半透明黑色背景，毛玻璃效果，悬停高亮

### 🎨 视觉效果
- 半透明黑色背景（75% 不透明度）
- 毛玻璃模糊效果（backdrop-filter）
- 圆角设计（6px）
- 阴影效果
- 悬停时放大 1.05 倍并完全不透明
- 地球图标 + IP 文本

### 🔄 IP 查询服务
使用以下服务按顺序查询（自动故障转移）：
1. `api.ipify.org` - 主要服务
2. `api.ip.sb` - 备用服务 1
3. `ifconfig.me` - 备用服务 2
4. `icanhazip.com` - 备用服务 3
5. `api.myip.com` - 备用服务 4

### ⏱️ 超时和重试
- 每个服务 5 秒超时
- 如果所有服务失败，显示 "Error"
- 失败后 10 秒自动重试
- 成功后每 5 分钟自动刷新

## 使用方法

### 默认启用
此功能在所有打包的应用中**默认启用**，无需任何配置：

```bash
# 正常打包应用，IP 显示会自动启用
pake https://example.com --name MyApp

# 与其他功能组合使用
pake https://github.com --name GitHub \
  --width 1400 \
  --height 900 \
  --hide-title-bar
```

### 交互操作

#### 1. 查看 IP
应用启动后，右下角会自动显示当前出口 IP：
```
🌐 192.168.1.100
```

#### 2. 复制 IP
点击 IP 显示区域，IP 地址会自动复制到剪贴板，并显示 "Copied!" 提示。

#### 3. 悬停效果
鼠标悬停在 IP 显示区域上时：
- 不透明度从 70% 变为 100%
- 轻微放大（1.05 倍）
- 更加醒目

## 显示状态

### 加载中
```
🌐 Loading...
```
应用启动时，正在获取 IP 地址。

### 正常显示
```
🌐 123.45.67.89
```
成功获取到出口 IP 地址。

### 错误状态
```
🌐 Error
```
所有 IP 查询服务都失败，10 秒后会自动重试。

## 技术实现

### 实现方式
通过 JavaScript 注入实现，在页面加载时自动执行：

1. **创建悬浮元素**：在页面右下角创建固定定位的 div
2. **获取 IP**：调用公共 IP 查询 API
3. **显示 IP**：更新元素内容
4. **定时刷新**：每 5 分钟自动更新
5. **复制功能**：点击时复制到剪贴板

### 注入文件
- `src-tauri/src/inject/ip_display.js` - IP 显示脚本
- 在 `src-tauri/src/app/window.rs` 中自动注入

### 样式特点
```css
position: fixed;           /* 固定定位 */
bottom: 10px;              /* 距底部 10px */
right: 10px;               /* 距右侧 10px */
z-index: 999999;           /* 最高层级 */
backdrop-filter: blur(10px); /* 毛玻璃效果 */
```

## 使用场景

### 1. 代理验证
验证代理是否生效：
```bash
pake https://example.com --name MyApp --proxy-url http://127.0.0.1:7890
```
打开应用后，查看右下角 IP 是否为代理服务器的出口 IP。

### 2. VPN 确认
确认 VPN 连接状态：
- 连接 VPN 前后对比 IP 变化
- 实时监控 VPN 是否断开

### 3. 网络切换
在不同网络环境下工作时：
- 快速确认当前网络的出口 IP
- 验证网络切换是否成功

### 4. 多地区访问
使用不同地区的代理时：
- 确认当前使用的是哪个地区的 IP
- 验证地理位置切换

### 5. 开发调试
开发需要特定 IP 的应用时：
- 快速查看当前 IP
- 点击复制用于配置或日志

## 隐私和安全

### 数据传输
- IP 查询请求直接发送到公共 IP 查询服务
- 不经过 Pake 服务器
- 不收集或存储任何数据

### 查询服务
使用的都是知名的公共 IP 查询服务：
- ipify.org - 开源项目
- ip.sb - 免费服务
- ifconfig.me - 老牌服务
- icanhazip.com - Cloudflare 服务
- myip.com - 商业服务

### 本地处理
- IP 地址仅在本地显示
- 复制功能使用本地剪贴板 API
- 不上传任何信息

## 自定义修改

如果你想自定义 IP 显示的样式或行为，可以编辑：

### 修改位置
编辑 `src-tauri/src/inject/ip_display.js`：

```javascript
// 修改位置（例如改到左下角）
ipContainer.style.cssText = `
  position: fixed;
  bottom: 10px;
  left: 10px;  // 改为 left
  ...
`;
```

### 修改样式
```javascript
// 修改背景颜色
background: rgba(0, 0, 0, 0.75);  // 改为其他颜色

// 修改字体大小
font-size: 12px;  // 改为其他大小

// 修改圆角
border-radius: 6px;  // 改为其他值
```

### 修改刷新间隔
```javascript
// 修改自动刷新时间（默认 5 分钟）
setInterval(updateIP, 5 * 60 * 1000);  // 改为其他时间
```

### 禁用此功能
如果不需要 IP 显示功能，可以：

1. 删除注入脚本：
   ```bash
   rm src-tauri/src/inject/ip_display.js
   ```

2. 在 `src-tauri/src/app/window.rs` 中移除注入：
   ```rust
   // 删除或注释这一行
   .initialization_script(include_str!("../inject/ip_display.js"))
   ```

3. 重新构建：
   ```bash
   pnpm run cli:build
   ```

## 故障排除

### IP 显示为 "Error"
**可能原因：**
- 网络连接问题
- 防火墙阻止了 IP 查询请求
- 所有 IP 查询服务都不可用

**解决方法：**
1. 检查网络连接
2. 等待 10 秒自动重试
3. 检查防火墙设置
4. 使用 `--debug` 参数查看详细日志

### IP 显示不出来
**可能原因：**
- 页面加载过慢
- JavaScript 被页面阻止

**解决方法：**
1. 等待页面完全加载
2. 刷新页面（Cmd/Ctrl + R）
3. 查看浏览器控制台是否有错误

### 点击复制无反应
**可能原因：**
- 浏览器不支持剪贴板 API
- 权限被拒绝

**解决方法：**
1. 使用较新版本的浏览器内核
2. 手动选择 IP 文本复制

## 开发调试

### 查看日志
使用 `--debug` 参数启动应用：
```bash
node dist/cli.js https://example.com --name MyApp --debug
```

在开发者工具的 Console 中查看：
```
[Pake IP] Exit IP: 123.45.67.89
```

### 测试不同服务
可以在 `ip_display.js` 中修改服务顺序或添加新服务。

### 模拟错误
可以暂时断开网络连接，测试错误处理和重试逻辑。

## 示例

### 基础使用
```bash
# 打包任意应用，自动显示 IP
pake https://github.com --name GitHub
```

### 配合代理使用
```bash
# 使用代理并验证 IP
pake https://example.com \
  --name MyApp \
  --proxy-url http://127.0.0.1:7890
```

### 完整配置
```bash
# 完整的应用配置
pake https://api.example.com \
  --name MyAPI \
  --width 1400 \
  --height 900 \
  --custom-headers "Authorization:Bearer token123" \
  --proxy-url http://127.0.0.1:7890 \
  --debug
```

打开应用后：
1. 右下角显示代理的出口 IP
2. 点击 IP 可以复制
3. 每 5 分钟自动刷新
4. 悬停时高亮显示

## 总结

出口 IP 显示功能是一个实用的小工具，特别适合：
- 🔒 使用代理或 VPN 的用户
- 🌍 需要确认网络出口的场景
- 🛠️ 开发和调试网络应用
- 📊 监控网络状态变化

功能默认启用，无需配置，开箱即用！
