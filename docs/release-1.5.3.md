# EducationHelper 1.5.3：AI 超时修复与服务器更新

## 更新方法

将交付的 `EducationHelper-1.5.3-update.tar.gz` 上传到 Linux 当前目录，执行：

```bash
tar -xzf EducationHelper-1.5.3-update.tar.gz && bash EducationHelper-1.5.3-update/update.sh
```

适用于先前安装在 `/opt/educationhelper/current` 的 systemd 部署，不是首次安装脚本。升级包内包含源代码归档、SHA256 清单及升级脚本，无需从 Sites/GitHub 下载代码。不含账号、密钥、学校数据、Windows 虚拟环境或 node_modules；安装 Python/Node 等依赖仍需网络。依赖下载确实需要代理时：

```bash
EH_INSTALL_PROXY_URL=http://192.168.0.4:7890 bash EducationHelper-1.5.3-update/update.sh
```

脚本校验归档，构建新版本，再切换 current 并重启 backend/web；健康检查失败会回切原代码。数据库和上传文件仍在原数据目录，环境配置保留（移除历史全局代理项）。升级前建议备份 `/var/lib/educationhelper` 和 `/etc/educationhelper`；回切代码不是数据库回滚。不需要重启 Linux。

若自定义安装路径，传入 `EH_APP_BASE` / `EH_DATA_DIR` / `EH_CONFIG_DIR`。本次交付包独立于公共下载站；旧在线升级命令不保证获取 1.5.3。

## AI 修复与接口行为

- `POST /api/agent/llm-settings/test`：使用有效配置的快速模型流式请求，首个内容、思考或结束响应即表示 API 可达；最多等待 45 秒，不等待完整推理答案。响应仍为 `ok/provider/model/latency_ms`，其中延迟现指首个有效响应；不能替代完整工具调用验收。
- `POST /api/agent/chat`：空闲每 10 秒发送 `: keepalive` SSE 注释，客户端不展示，也不消耗模型 token。响应头 `Cache-Control: no-cache, no-transform`、`X-Accel-Buffering: no`。浏览器断连时取消对应后台回合。
- 所有三类模型 SDK：连接超时 10 秒、读取空闲超时 180 秒，自动重试 0 次；对话层仅在适配器明确不支持流式时退回普通请求。实际网络错误不会自动再发送一次收费请求。
- 保留思考与工具调用协议，不改变正常回答的 token 上限。报错不回显供应商原始请求/密钥。
- 依然默认直连，不继承系统全局代理。需要代理的域名须明确列入 `EH_PROXY_HOSTS`，代理地址为 `EH_EXTERNAL_PROXY_URL`；VPN 关闭仍会影响主动配置为代理的域名。

## 更新后检查

```bash
systemctl is-active educationhelper-backend.service educationhelper-web.service
curl --noproxy '*' -fsS http://127.0.0.1:8000/api/health
```

在管理员 AI 设置中点击连接测试，再发一次简单对话。若仍超时，应检查服务器实际网络，而不是继续盲目升级：

```bash
# 用你实际填写的 API 域名替代这里；不带密钥，401 也说明 HTTP 服务可达。
curl --noproxy '*' --connect-timeout 10 --max-time 20 -I https://api.deepseek.com
sudo journalctl -u educationhelper-backend.service -n 80 --no-pager
```

不要将密钥或完整配置发到公开聊天。若通过 Nginx 反向代理访问，请在现有 `/api/` location 核对 `proxy_buffering off; proxy_read_timeout 240s;`，通过 `nginx -t` 后再 reload；其他代理也须允许 SSE/长连接。这份更新不擅自覆盖站点代理配置。

## 验证边界

本机现有 DeepSeek 配置的新连接测试实测成功（约 1.2 秒）。网络、设置接口、心跳、断连取消、禁止隐式重复请求、版本及本地升级入口共 38 项测试通过；前端生产构建通过，保留依赖浏览器数据库较旧及大分块警告。额外旧测试集出现一条 OCR 假图片测试失败：其模拟对象不符合当前 OCR 图片/引擎校验要求，与此次 AI 网络变更无关；不声称全量测试通过。服务器网络、域名反代及上线操作由管理员实机验证。
