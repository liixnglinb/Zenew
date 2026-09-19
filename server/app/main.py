# 知新 Zenew 云端最小后端（M1）
# 邮箱登录 + LLM 网关（服务端持 key）+ 额度计量 + 课程目录
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "zenew.db"
COURSES_JSON = BASE_DIR / "courses.json"


def load_env() -> None:
    env_file = BASE_DIR.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())


load_env()

JWT_SECRET = os.environ.get("JWT_SECRET", "zenew-dev-secret-change-me")
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "mock")  # mock | openai
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen-flash")
FREE_MONTHLY_TOKENS = int(os.environ.get("FREE_MONTHLY_TOKENS", "200000"))
RATE_PER_MIN = int(os.environ.get("RATE_PER_MIN", "10"))

app = FastAPI(title="Zenew Server", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5199", "http://127.0.0.1:5199", "tauri://localhost", "https://tauri.localhost", "http://localhost:*", "http://127.0.0.1:*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- storage ----------

def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              email TEXT UNIQUE NOT NULL,
              pw_hash TEXT NOT NULL,
              salt TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS usage_log(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              endpoint TEXT NOT NULL,
              provider TEXT NOT NULL,
              model TEXT NOT NULL,
              tokens_in INTEGER NOT NULL DEFAULT 0,
              tokens_out INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );
            """
        )


init_db()

# ---------- auth ----------

def hash_pw(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


class AuthIn(BaseModel):
    email: str
    password: str


def make_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def current_user(authorization: str = Header(default="")) -> sqlite3.Row:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "未登录")
    token = authorization.removeprefix("Bearer ")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "登录已过期")
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE id=?", (int(payload["sub"]),)).fetchone()
    if user is None:
        raise HTTPException(401, "用户不存在")
    return user


def month_prefix() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def check_rate(user_id: int) -> None:
    now = time.time()
    bucket = _rate.setdefault(user_id, [])
    _rate[user_id] = [t for t in bucket if now - t < 60]
    if len(_rate[user_id]) >= RATE_PER_MIN:
        raise HTTPException(429, "请求太频繁，请稍后再试")
    _rate[user_id].append(now)


_rate: dict[int, list[float]] = {}


@app.post("/auth/register")
def register(body: AuthIn):
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(400, "邮箱格式不正确")
    if len(body.password) < 8:
        raise HTTPException(400, "密码至少 8 位")
    salt = os.urandom(16).hex()
    with db() as conn:
        if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise HTTPException(400, "该邮箱已注册")
        cur = conn.execute(
            "INSERT INTO users(email,pw_hash,salt,created_at) VALUES(?,?,?,?)",
            (email, hash_pw(body.password, salt), salt, datetime.now(timezone.utc).isoformat()),
        )
        user_id = cur.lastrowid
    return {"token": make_token(user_id), "email": email}


@app.post("/auth/login")
def login(body: AuthIn):
    email = body.email.strip().lower()
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if user is None or hash_pw(body.password, user["salt"]) != user["pw_hash"]:
        raise HTTPException(401, "邮箱或密码错误")
    return {"token": make_token(user["id"]), "email": email}


@app.get("/me")
def me(user: sqlite3.Row = Depends(current_user)):
    with db() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(tokens_in+tokens_out),0) AS used FROM usage_log WHERE user_id=? AND created_at LIKE ?",
            (user["id"], month_prefix() + "%"),
        ).fetchone()
    return {"email": user["email"], "used_tokens": row["used"], "quota_tokens": FREE_MONTHLY_TOKENS}


# ---------- courses ----------

@app.get("/courses")
def courses():
    return json.loads(COURSES_JSON.read_text(encoding="utf-8"))


# ---------- LLM gateway ----------

class OutlineIn(BaseModel):
    title: str
    source_hint: Optional[str] = None
    num_chapters: int = Field(default=5, ge=1, le=12)


class CardsIn(BaseModel):
    topic_title: str
    context: Optional[str] = None
    n: int = Field(default=5, ge=1, le=12)
    types: list[str] = Field(default=["basic", "why", "choice"])


def llm_chat(system: str, user: str) -> tuple[str, dict]:
    """调用 LLM，返回 (content, usage)。mock 模式返回确定性内容（联调用）。"""
    if LLM_PROVIDER == "mock":
        return "", {"prompt_tokens": 100, "completion_tokens": 200}
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json={
                "model": LLM_MODEL,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "response_format": {"type": "json_object"},
                "temperature": 0.3,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    return content, {
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
    }


def log_usage(user_id: int, endpoint: str, usage: dict) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO usage_log(user_id,endpoint,provider,model,tokens_in,tokens_out,created_at) VALUES(?,?,?,?,?,?,?)",
            (user_id, endpoint, LLM_PROVIDER, LLM_MODEL if LLM_PROVIDER != "mock" else "mock",
             usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
             datetime.now(timezone.utc).isoformat()),
        )


def check_quota(user_id: int) -> None:
    with db() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(tokens_in+tokens_out),0) AS used FROM usage_log WHERE user_id=? AND created_at LIKE ?",
            (user_id, month_prefix() + "%"),
        ).fetchone()
    if row["used"] >= FREE_MONTHLY_TOKENS:
        raise HTTPException(402, "本月免费额度已用完")


def extract_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise HTTPException(502, "模型未返回 JSON")
    return json.loads(m.group(0))


CARD_LINT_NOTES = []


def lint_cards(cards: list[dict]) -> tuple[list[dict], list[dict]]:
    ok, bad = [], []
    for c in cards:
        front, back = (c.get("front") or "").strip(), (c.get("back") or "").strip()
        ctype = c.get("type", "basic")
        reasons = []
        if not front or not back:
            reasons.append("空题面或空答案")
        if not (c.get("explanation") or "").strip():
            reasons.append("缺少解释")
        if len(front) > 100:
            reasons.append("题面过长（>100 字）")
        if front == back:
            reasons.append("题面与答案相同")
        if ctype == "choice":
            ch = c.get("choices") or []
            if len(ch) != 4 or not isinstance(c.get("answer_index"), int) or not (0 <= c["answer_index"] < 4):
                reasons.append("选择题选项/答案无效")
        if re.search(r"？.+\？| two", front) and front.count("？") > 1:
            reasons.append("一题多问")
        (ok.append(c) if not reasons else bad.append({**c, "reject": reasons}))
    return ok, bad


@app.post("/gen/outline")
def gen_outline(body: OutlineIn, user: sqlite3.Row = Depends(current_user)):
    check_rate(user["id"])
    check_quota(user["id"])
    system = "你是大学课程大纲专家。只输出 JSON。"
    user_prompt = (
        f"为大学课程《{body.title}》生成教学大纲，{body.num_chapters} 章。"
        '输出 JSON：{"chapters":[{"title":"章标题","topics":["知识点1","知识点2"]}]}，每章 3-6 个知识点。'
    )
    if LLM_PROVIDER == "mock":
        chapters = [
            {"title": f"第{i}章 {body.title}基础模块{i}", "topics": [f"{body.title}核心概念{i}-{j}" for j in range(1, 4)]}
            for i in range(1, body.num_chapters + 1)
        ]
        content, usage = json.dumps({"chapters": chapters}, ensure_ascii=False), {"prompt_tokens": 100, "completion_tokens": 200}
    else:
        content, usage = llm_chat(system, user_prompt)
        content = extract_json(content) and content
    log_usage(user["id"], "/gen/outline", usage)
    data = json.loads(content)
    return {"outline": data["chapters"], "provider": LLM_PROVIDER, "usage": usage}


@app.post("/gen/cards")
def gen_cards(body: CardsIn, user: sqlite3.Row = Depends(current_user)):
    check_rate(user["id"])
    check_quota(user["id"])
    types = [t for t in body.types if t in ("basic", "why", "choice")] or ["basic"]
    system = (
        "你是精通学习科学的大学助教，依据提取练习原理出卡。每张卡只考一个点；"
        "front 是单一问句；back 简洁；explanation 必填（为什么/常见错误）；不要出现 emoji。只输出 JSON。"
    )
    user_prompt = (
        f"知识点：《{body.topic_title}》"
        + (f"\n参考材料片段：\n{body.context[:4000] if body.context else '（无，凭可靠学科知识生成）'}")
        + f"\n生成 {body.n} 张卡片，类型从 {types} 中选择，choice 卡需 4 个选项。"
        '输出 JSON：{"cards":[{"type":"basic|why|choice","front":"...","back":"...","explanation":"...","choices":["A","B","C","D"],"answer_index":0}]}'
        "（choices/answer_index 仅 choice 卡需要）"
    )
    if LLM_PROVIDER == "mock":
        cards = []
        for i in range(body.n):
            t = types[i % len(types)]
            card = {"type": t, "front": f"（mock）{body.topic_title}的要点{i+1}是什么？", "back": f"要点{i+1}的内容", "explanation": "mock 解释：用于联调"}
            if t == "choice":
                card.update({"choices": ["甲", "乙", "丙", "丁"], "answer_index": i % 4})
            cards.append(card)
        content, usage = json.dumps({"cards": cards}, ensure_ascii=False), {"prompt_tokens": 100, "completion_tokens": 200}
    else:
        content, usage = llm_chat(system, user_prompt)
    log_usage(user["id"], "/gen/cards", usage)
    data = json.loads(content)
    ok, bad = lint_cards(data.get("cards", []))
    return {"cards": ok, "rejected": bad, "provider": LLM_PROVIDER, "usage": usage}


@app.get("/health")
def health():
    return {"ok": True, "provider": LLM_PROVIDER}
