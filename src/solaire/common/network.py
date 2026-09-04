"""AI traffic is direct unless its exact public hostname is explicitly opted in."""
import ipaddress
import os
from urllib.parse import urlsplit

import httpx


def ai_sdk_options() -> dict:
    # Read timeout is inactivity between chunks, not total time spent thinking.
    # Leave retry decisions to the teacher; SDK retries can duplicate paid calls.
    return {"timeout": httpx.Timeout(180, connect=10, write=30, pool=10), "max_retries": 0}


def ai_http_options(url: str) -> dict:
    options = {'trust_env': False}
    host = (urlsplit(url).hostname or '').lower().rstrip('.')
    if not host or host == 'localhost' or host.endswith(('.localhost', '.local')):
        return options
    try:
        if not ipaddress.ip_address(host).is_global:
            return options
    except ValueError:
        pass
    hosts = {h.strip().lower().rstrip('.') for h in os.environ.get('EH_PROXY_HOSTS', '').split(',')}
    proxy = os.environ.get('EH_EXTERNAL_PROXY_URL', '').strip()
    if host in hosts and proxy:
        parsed = urlsplit(proxy)
        if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
            raise ValueError('EH_EXTERNAL_PROXY_URL must be an HTTP(S) proxy URL')
        options['proxy'] = proxy
    return options
