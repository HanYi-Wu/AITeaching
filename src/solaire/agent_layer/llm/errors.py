"""User-facing provider failures without leaking request bodies or credentials."""


def llm_error_message(exc: Exception) -> str:
    marker = f"{type(exc).__name__} {exc}".casefold()
    if any(value in marker for value in ("401", "403", "authentication", "unauthorized", "api key")):
        return "连接失败：API 密钥无效或服务拒绝访问"
    if any(value in marker for value in ("404", "model_not_found", "not found")):
        return "连接失败：模型不存在或当前账号无权使用"
    if "429" in marker or "rate limit" in marker:
        return "连接失败：服务请求过于频繁或额度不足"
    if any(value in marker for value in ("timeout", "timed out")):
        return "模型响应超时：请稍后重试，并检查服务器到模型服务的网络；如该域名需要代理，请检查 EH_PROXY_HOSTS 和 EH_EXTERNAL_PROXY_URL。请求未自动重发。"
    if any(value in marker for value in ("connection", "network", "dns")):
        return "连接失败：服务器无法访问模型服务，请检查 API 地址、DNS 和该域名的代理设置"
    return "模型服务返回错误，请检查供应商、地址和模型名称；请求未自动重发"
