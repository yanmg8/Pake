# 自定义 HTTP 请求头功能

## 功能说明

此功能允许你在打包的应用中为所有 HTTP 请求添加自定义请求头（Custom Headers）。这对于需要特定认证、API 密钥或其他自定义头部的应用非常有用。

## 使用方法

### CLI 命令行方式

使用 `--custom-headers` 参数，格式为 `"Key1:Value1,Key2:Value2"`：

```bash
# 基础示例：添加单个请求头
pake https://example.com --name MyApp --custom-headers "Authorization:Bearer token123"

# 添加多个请求头（用逗号分隔）
pake https://api.example.com --name MyAPI \
  --custom-headers "Authorization:Bearer token123,X-API-Key:your-api-key,X-Custom-Header:custom-value"

# 完整示例
pake https://example.com \
  --name MyApp \
  --width 1200 \
  --height 800 \
  --custom-headers "Authorization:Bearer abc123,X-Client-ID:client-001"
```

### 配置文件方式

如果你直接修改 `pake.json` 配置文件，可以这样添加：

```json
{
  "windows": [...],
  "user_agent": {...},
  "system_tray": {...},
  "custom_headers": {
    "Authorization": "Bearer token123",
    "X-API-Key": "your-api-key",
    "X-Custom-Header": "custom-value"
  }
}
```

## 工作原理

自定义请求头通过 JavaScript 拦截器实现，会自动拦截以下类型的请求：

1. **Fetch API** - 现代浏览器的标准请求方式
2. **XMLHttpRequest** - 传统的 AJAX 请求方式

拦截器会在每个请求发送前自动添加配置的自定义请求头。

## 使用场景

### 1. API 认证
```bash
pake https://api.example.com --name MyAPI \
  --custom-headers "Authorization:Bearer your-token"
```

### 2. 多个认证头
```bash
pake https://app.example.com --name MyApp \
  --custom-headers "X-API-Key:key123,X-Client-Secret:secret456"
```

### 3. 自定义客户端标识
```bash
pake https://service.example.com --name MyService \
  --custom-headers "X-Client-ID:desktop-app,X-Client-Version:1.0.0"
```

### 4. CORS 相关头部
```bash
pake https://api.example.com --name MyAPI \
  --custom-headers "X-Requested-With:XMLHttpRequest,Origin:https://example.com"
```

## 注意事项

1. **格式要求**：
   - 使用冒号 `:` 分隔键和值
   - 使用逗号 `,` 分隔多个请求头
   - 键和值会自动去除首尾空格

2. **特殊字符**：
   - 如果值中包含冒号，会正确处理（例如：`"Time:2024-01-17:12:00:00"`）
   - 如果需要在值中使用逗号，建议使用配置文件方式

3. **安全性**：
   - 不要在命令行中直接暴露敏感的 token 或密钥
   - 建议使用环境变量或配置文件管理敏感信息
   - 打包后的应用中，这些头部会被硬编码，请注意安全风险

4. **调试**：
   - 使用 `--debug` 参数可以在控制台看到注入的请求头信息
   - 浏览器开发者工具的 Network 标签可以查看实际发送的请求头

## 调试示例

```bash
# 启用调试模式查看请求头注入情况
pake https://httpbin.org/headers \
  --name HeaderTest \
  --custom-headers "X-Test-Header:test-value" \
  --debug
```

打开应用后，在开发者工具的控制台中会看到：
```
[Pake] Custom headers injected: {X-Test-Header: "test-value"}
```

## 开发环境测试

如果你在开发 Pake 本身，可以修改 `bin/defaults.ts` 中的 `DEFAULT_DEV_PAKE_OPTIONS` 来测试：

```typescript
export const DEFAULT_DEV_PAKE_OPTIONS: PakeCliOptions & { url: string } = {
  ...DEFAULT_PAKE_OPTIONS,
  url: 'https://httpbin.org/headers',
  name: 'HeaderTest',
  customHeaders: 'X-Test:value1,Authorization:Bearer test123',
  debug: true,
};
```

然后运行：
```bash
pnpm run cli:dev
```

## 技术实现

自定义请求头通过以下方式实现：

1. **CLI 层**：解析 `--custom-headers` 参数，转换为对象格式
2. **配置层**：将请求头对象写入 `pake.json` 配置文件
3. **Rust 层**：读取配置并生成 JavaScript 拦截器代码
4. **JavaScript 层**：在页面加载前注入拦截器，拦截所有 HTTP 请求

## 常见问题

### Q: 为什么我的请求头没有生效？
A: 检查以下几点：
- 确认格式正确（`Key:Value,Key2:Value2`）
- 使用 `--debug` 查看是否正确注入
- 某些网站可能使用其他请求方式（如 WebSocket），这些不会被拦截

### Q: 可以添加多少个请求头？
A: 理论上没有限制，但建议不要超过 10 个，以保持配置清晰。

### Q: 请求头会影响性能吗？
A: 影响极小，拦截器在页面加载前注入，对每个请求的开销可以忽略不计。

### Q: 可以动态修改请求头吗？
A: 当前版本不支持运行时动态修改，请求头在应用启动时固定。如需动态修改，需要重新打包应用。

## 相关文档

- [CLI 使用指南](docs/cli-usage_CN.md)
- [高级用法](docs/advanced-usage_CN.md)
- [JavaScript 注入](docs/advanced-usage_CN.md#javascript-注入)
