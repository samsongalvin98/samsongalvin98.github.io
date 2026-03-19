import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel
from starlette.status import HTTP_303_SEE_OTHER

try:
    from google import genai
except Exception:  # pragma: no cover
    genai = None


ROOT_DIR = Path(__file__).resolve().parent
SUBMISSIONS_DIR = Path(os.environ.get("SUBMISSIONS_DIR", ROOT_DIR / "submissions"))
SUCCESS_REDIRECT_URL = os.environ.get("SUCCESS_REDIRECT_URL", "").strip()

allowed_origins = os.environ.get("BACKEND_CORS_ORIGINS", "*").split(",")
allowed_origins = [origin.strip() for origin in allowed_origins if origin.strip()]

FILE_RULES = {
    "printing": {".stl", ".step", ".zip"},
    "laser": {".svg", ".dxf", ".png", ".jpeg", ".pdf", ".zip"},
    "product": {".pdf", ".zip"},
}

_filename_strip_re = re.compile(r"[^A-Za-z0-9._-]+")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class ChatTurn(BaseModel):
    role: str
    text: str


class QuoteRequest(BaseModel):
    message: str
    requestType: Optional[str] = ""
    history: Optional[List[ChatTurn]] = None


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sanitize_filename(name: str) -> str:
    base = Path(name or "file").name.strip().strip(".")
    if not base:
        base = "file"
    base = _filename_strip_re.sub("_", base)
    return base[:180]


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def normalize_extension(filename: str) -> str:
    return Path(filename or "").suffix.lower()


def validate_files(files: Sequence[UploadFile], allowed_extensions: set[str], label: str) -> None:
    if not files:
        raise HTTPException(status_code=400, detail=f"{label} requires at least one file.")

    for upload in files:
        ext = normalize_extension(upload.filename or "")
        if ext not in allowed_extensions:
            allowed = ", ".join(sorted(allowed_extensions))
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ext or '(none)'}'. Allowed: {allowed}",
            )


async def save_files(files: Sequence[UploadFile], target_dir: Path) -> List[Dict[str, Any]]:
    saved: List[Dict[str, Any]] = []
    ensure_directory(target_dir)

    for upload in files:
        safe_name = sanitize_filename(upload.filename or "file")
        destination = target_dir / safe_name
        if destination.exists():
            destination = target_dir / f"{destination.stem}_{uuid.uuid4().hex[:6]}{destination.suffix}"

        size_bytes = 0
        with destination.open("wb") as handle:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size_bytes += len(chunk)
                handle.write(chunk)

        saved.append(
            {
                "originalName": upload.filename,
                "savedName": destination.name,
                "contentType": upload.content_type,
                "bytes": size_bytes,
            }
        )

    return saved


def make_submission_dir(category: str) -> Path:
    submission_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:10]}"
    submission_dir = SUBMISSIONS_DIR / category / submission_id
    ensure_directory(submission_dir)
    return submission_dir


def success_response(kind: str) -> Response:
    if SUCCESS_REDIRECT_URL:
        separator = "&" if "?" in SUCCESS_REDIRECT_URL else "?"
        return RedirectResponse(
            url=f"{SUCCESS_REDIRECT_URL}{separator}submitted={kind}",
            status_code=HTTP_303_SEE_OTHER,
        )

    return HTMLResponse(
        f"<h2>{kind.title()} request received.</h2><p>You can close this tab.</p>",
        status_code=200,
    )


def write_metadata(submission_dir: Path, payload: Dict[str, Any]) -> None:
    (submission_dir / "metadata.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def client_metadata(request: Request) -> Dict[str, Optional[str]]:
    return {
        "receivedAt": now_iso(),
        "ip": request.client.host if request.client else None,
        "userAgent": request.headers.get("user-agent"),
        "referer": request.headers.get("referer"),
    }


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


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/print-request")
async def print_request(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    quantity: int = Form(...),
    deadline: Optional[str] = Form(None),
    material: str = Form(...),
    color: Optional[str] = Form(None),
    stlModelUnit: Optional[str] = Form(None),
    notes: str = Form(...),
    uploaded_files: List[UploadFile] = File(..., alias="file"),
) -> Response:
    validate_files(uploaded_files, FILE_RULES["printing"], "3D printing request")
    submission_dir = make_submission_dir("printing")
    files = await save_files(uploaded_files, submission_dir / "files")
    write_metadata(
        submission_dir,
        {
            "type": "printing",
            "client": client_metadata(request),
            "form": {
                "name": name,
                "email": email,
                "quantity": quantity,
                "deadline": deadline,
                "material": material,
                "color": color,
                "stlModelUnit": stlModelUnit,
                "notes": notes,
            },
            "files": files,
        },
    )
    return success_response("printing")


@app.post("/api/laser-request")
async def laser_request(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    quantity: int = Form(...),
    deadline: Optional[str] = Form(None),
    material: str = Form(...),
    laserWidth: float = Form(...),
    laserHeight: float = Form(...),
    laserUnit: str = Form(...),
    size: Optional[str] = Form(None),
    process: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    uploaded_files: List[UploadFile] = File(..., alias="file"),
) -> Response:
    validate_files(uploaded_files, FILE_RULES["laser"], "laser engraving request")
    submission_dir = make_submission_dir("laser")
    files = await save_files(uploaded_files, submission_dir / "files")
    write_metadata(
        submission_dir,
        {
            "type": "laser",
            "client": client_metadata(request),
            "form": {
                "name": name,
                "email": email,
                "quantity": quantity,
                "deadline": deadline,
                "material": material,
                "laserWidth": laserWidth,
                "laserHeight": laserHeight,
                "laserUnit": laserUnit,
                "size": size,
                "process": process,
                "notes": notes,
            },
            "files": files,
        },
    )
    return success_response("laser")


@app.post("/api/product-request")
async def product_request(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    org: Optional[str] = Form(None),
    timeline: Optional[str] = Form(None),
    requestType: str = Form(...),
    notes: str = Form(...),
    uploaded_files: Optional[List[UploadFile]] = File(None, alias="file"),
) -> Response:
    uploads = uploaded_files or []
    if uploads:
        validate_files(uploads, FILE_RULES["product"], "product development request")
    submission_dir = make_submission_dir("product")
    files = await save_files(uploads, submission_dir / "files") if uploads else []
    write_metadata(
        submission_dir,
        {
            "type": "product",
            "client": client_metadata(request),
            "form": {
                "name": name,
                "email": email,
                "org": org,
                "timeline": timeline,
                "requestType": requestType,
                "notes": notes,
            },
            "files": files,
        },
    )
    return success_response("product")


@app.post("/api/quote")
def api_quote(req: QuoteRequest) -> Dict[str, Any]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {"text": "Server is missing GEMINI_API_KEY."}
    if genai is None:
        return {"text": "google-genai is not installed. Install backend requirements first."}

    client = genai.Client(api_key=api_key)
    model = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")

    transcript: List[str] = ["SYSTEM: " + build_system_prompt(req.requestType or "")]
    if req.history:
        for turn in req.history[-12:]:
            role = (turn.role or "").strip().lower()
            label = "USER" if role == "user" else "ASSISTANT"
            transcript.append(f"{label}: {turn.text}")

    transcript.append(f"USER: {req.message}")
    resp = client.models.generate_content(model=model, contents="\n".join(transcript))
    return {"text": getattr(resp, "text", None) or "I couldn’t generate a quote right now. Please try again."}