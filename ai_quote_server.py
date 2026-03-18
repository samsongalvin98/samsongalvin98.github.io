import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# To run:
#   pip install -r requirements-ai.txt
#   set GEMINI_API_KEY=...
#   python -m uvicorn ai_quote_server:app --host 0.0.0.0 --port 8787

# IMPORTANT:
# - Do NOT put your API key in frontend JS.
# - Host this server separately from GitHub Pages.

try:
    from google import genai
except Exception as exc:  # pragma: no cover
    raise RuntimeError(
        "google-genai is not installed. Run: pip install -r requirements-ai.txt"
    ) from exc


class ChatTurn(BaseModel):
    role: str  # "user" | "ai"
    text: str


class QuoteRequest(BaseModel):
    message: str
    requestType: Optional[str] = ""
    history: Optional[List[ChatTurn]] = None


app = FastAPI()

allowed_origins = os.environ.get("AI_CORS_ORIGINS", "*").split(",")
allowed_origins = [o.strip() for o in allowed_origins if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"]
)


def build_system_prompt(request_type: str) -> str:
    return (
        "You are an assistant helping a small product development / prototyping shop provide quick, approximate quotes. "
        "You must be concise and practical.\n\n"
        "Goals:\n"
        "- Ask only the minimum clarifying questions needed.\n"
        "- Provide an approximate quote range and what it includes.\n"
        "- Clearly state assumptions and uncertainties.\n\n"
        "Output format:\n"
        "- 2-5 short bullets: clarifying questions (only if needed)\n"
        "- 2-5 short bullets: estimate (range in USD) + timeline\n"
        "- 1-3 bullets: assumptions\n\n"
        "If the user requestType is present, tailor your questions and estimate to that type (CAD/DFM, prototype build, test fixture, mechanism, general).\n"
        "Never claim a guaranteed price; always frame as an approximate range."
    )


@app.post("/api/quote")
def api_quote(req: QuoteRequest) -> Dict[str, Any]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {"text": "Server is missing GEMINI_API_KEY."}

    client = genai.Client(api_key=api_key)

    model = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")

    # Build a lightweight text transcript.
    transcript: List[str] = []
    transcript.append("SYSTEM: " + build_system_prompt(req.requestType or ""))

    if req.history:
        for turn in req.history[-12:]:
            role = (turn.role or "").strip().lower()
            if role not in {"user", "ai", "assistant", "model"}:
                role = "user"
            label = "USER" if role == "user" else "ASSISTANT"
            transcript.append(f"{label}: {turn.text}")

    transcript.append(f"USER: {req.message}")

    prompt = "\n".join(transcript)

    # Simple, non-streaming response to keep the client easy.
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
    )

    text = getattr(resp, "text", None)
    if not text:
        text = "I couldn’t generate a quote right now. Please try again."

    return {"text": text}
