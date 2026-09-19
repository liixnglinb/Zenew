# Zenew Server（M1 云端最小后端）

## 运行

```bash
cd server
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env        # 填 LLM_API_KEY 后把 LLM_PROVIDER 改为 openai
uvicorn app.main:app --port 8765 --reload
```

## 端点

- GET /health — 健康检查（返回当前 provider）
- POST /auth/register · /auth/login — 邮箱注册/登录
- GET /me — 用户 + 本月额度用量
- GET /courses — 内置课程目录
- POST /gen/outline · /gen/cards — LLM 生成（需登录，计量+限流）

## 说明

- `LLM_PROVIDER=mock` 时生成返回确定性假数据（无 key 联调管线用）；`openai` 时走 OpenAI 兼容协议（默认百炼 qwen-flash）。
- key 只存在于服务端 .env；客户端永远接触不到。
