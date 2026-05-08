from pathlib import Path
from dotenv import load_dotenv
import os

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
MANUAL_PAGES_DIR = DATA_DIR / "manual_pages"
CHROMA_DIR = DATA_DIR / "chroma"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MANUAL_PAGES_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)

load_dotenv(ENV_FILE)

# 敏感密钥映射：内部 key → 环境变量名
ENV_SECRETS = {
    "llm_api_key": "LLM_API_KEY",
    "llm_embedding_api_key": "LLM_EMBEDDING_API_KEY",
    "rag_rerank_api_key": "RAG_RERANK_API_KEY",
    "search_api_key": "SEARCH_API_KEY",
    "ocr_llm_api_key": "OCR_LLM_API_KEY",
}

# 明文展示的字段（不脱敏）
PLAIN_DISPLAY_KEYS = {"ocr_tencent_secret_id"}

# 非敏感配置 - 存数据库
DEFAULT_SETTINGS = {
    "llm_api_url": "https://api.openai.com/v1",
    "llm_model": "gpt-4o",
    "llm_embedding_api_url": "https://api.openai.com/v1",
    "llm_embedding_model": "text-embedding-3-small",
    "ocr_llm_api_url": "",
    "ocr_llm_model": "qwen-vl-plus",
    "rag_rerank_enabled": "false",
    "rag_rerank_api_url": "",
    "rag_rerank_model": "",
    "rag_top_k": "5",
    "rag_score_threshold": "0.5",
    "rag_embed_max_chars": "200",
    "search_api_url": "https://api.tavily.com",
    "search_monthly_limit": "1000",
}

MASK = "****"


def get_secret(key: str) -> str:
    """从环境变量读取敏感密钥（明文）"""
    env_key = ENV_SECRETS.get(key, "")
    return os.getenv(env_key, "") if env_key else ""


def get_all_secrets() -> dict[str, str]:
    """返回所有密钥的视图（部分脱敏、部分明文）"""
    result = {}
    for key, env_key in ENV_SECRETS.items():
        val = os.getenv(env_key, "")
        if val:
            result[key] = val if key in PLAIN_DISPLAY_KEYS else (val[:4] + MASK + val[-4:] if len(val) > 8 else MASK)
        else:
            result[key] = ""
    return result


def is_masked(value: str) -> bool:
    """判断值是否是脱敏格式"""
    return MASK in value


def update_secrets(updates: dict[str, str]):
    """更新密钥到 .env 文件（只更新非脱敏的新值）"""
    changed = False
    lines: list[str] = []

    # 读取现有 .env
    if ENV_FILE.exists():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()

    existing_keys = set()
    for i, line in enumerate(lines):
        if "=" not in line or line.strip().startswith("#"):
            continue
        k = line.split("=", 1)[0].strip()
        existing_keys.add(k)
        # 查找对应的内部 key
        for internal_key, env_key in ENV_SECRETS.items():
            if env_key == k and internal_key in updates and not is_masked(updates[internal_key]):
                lines[i] = f"{env_key}={updates[internal_key]}"
                os.environ[env_key] = updates[internal_key]
                changed = True

    # 新增不存在的 key
    for internal_key, env_key in ENV_SECRETS.items():
        if env_key not in existing_keys and internal_key in updates and not is_masked(updates[internal_key]):
            lines.append(f"{env_key}={updates[internal_key]}")
            os.environ[env_key] = updates[internal_key]
            changed = True

    if changed:
        ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
