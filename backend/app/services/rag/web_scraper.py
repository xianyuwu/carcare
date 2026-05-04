"""网页正文提取服务"""
import logging
import re
import httpx
from urllib.parse import urlparse
from html.parser import HTMLParser

logger = logging.getLogger(__name__)


def _extract_title(html: str) -> str:
    """从 HTML 中提取 <title> 标签内容"""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if m:
        title = m.group(1).strip()
        # 去掉常见分隔符后面的站点名后缀，如 "标题 - 汽车之家"
        # 保留完整标题，让前端按需截断
        return title if title else ""
    return ""


async def fetch_web_text(url: str) -> tuple[str, str]:
    """抓取网页并提取正文纯文本和页面标题

    返回 (正文文本, 页面标题)。标题为空字符串表示提取失败。
    """
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"无效的 URL: {url}")

    try:
        return await _fetch_with_trafilatura(url)
    except ImportError:
        logger.info("trafilatura 未安装，使用简易 HTML 提取")
        return await _fetch_simple(url)


async def _fetch_with_trafilatura(url: str) -> tuple[str, str]:
    """用 trafilatura 提取网页正文（效果最好，能去除导航/广告/侧边栏）"""
    import trafilatura

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    title = _extract_title(resp.text)
    result = trafilatura.extract(resp.text, include_links=False, include_tables=True)
    if not result:
        raise ValueError("无法从网页提取正文内容")
    return result, title


async def _fetch_simple(url: str) -> tuple[str, str]:
    """简易 HTML 正文提取（不依赖 trafilatura 的回退方案）"""
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text

    title = _extract_title(html)

    class TextExtractor(HTMLParser):
        SKIP_TAGS = {"script", "style", "nav", "header", "footer", "noscript"}

        def __init__(self):
            super().__init__()
            self.parts: list[str] = []
            self._skip_depth = 0

        def handle_starttag(self, tag, attrs):
            if tag in self.SKIP_TAGS:
                self._skip_depth += 1

        def handle_endtag(self, tag):
            if tag in self.SKIP_TAGS and self._skip_depth > 0:
                self._skip_depth -= 1
            elif tag in ("p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr"):
                self.parts.append("\n")

        def handle_data(self, data):
            if self._skip_depth == 0:
                text = data.strip()
                if text:
                    self.parts.append(text)

    extractor = TextExtractor()
    extractor.feed(html)
    text = " ".join(extractor.parts)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip(), title
