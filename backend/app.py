import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel
from starlette.status import HTTP_303_SEE_OTHER

try:
    from google import genai
except Exception:  # pragma: no cover
    genai = None


ROOT_DIR = Path(__file__).resolve().parent
SUBMISSIONS_DIR = Path(os.environ.get("SUBMISSIONS_DIR", ROOT_DIR / "submissions"))
SUCCESS_REDIRECT_URL = os.environ.get("SUCCESS_REDIRECT_URL", "").strip()
SUBMISSIONS_ADMIN_PASSWORD = os.environ.get("SUBMISSIONS_ADMIN_PASSWORD", "").strip()
PRINT_COLOR_OPTIONS_PATH = ROOT_DIR.parent / "assets" / "data" / "print-color-options.csv"
AI_USAGE_LOG_PATH = Path(os.environ.get("AI_USAGE_LOG_PATH", ROOT_DIR / "ai_usage.json"))
AI_DAILY_TOKEN_LIMIT = max(0, int(os.environ.get("AI_DAILY_TOKEN_LIMIT", "25000") or "0"))

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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


class ChatTurn(BaseModel):
    role: str
    text: str


class QuoteRequest(BaseModel):
    message: str
    requestType: Optional[str] = ""
    history: Optional[List[ChatTurn]] = None
    adminPassword: Optional[str] = None


class CsvUpdateRequest(BaseModel):
    content: str


class AiUsageResetRequest(BaseModel):
    user: str
    dayKey: Optional[str] = None

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


def filter_blank_uploads(files: Optional[Sequence[UploadFile]]) -> List[UploadFile]:
    filtered: List[UploadFile] = []
    for upload in files or []:
        if not upload:
            continue

        filename = (upload.filename or "").strip()
        if not filename:
            continue

        filtered.append(upload)

    return filtered


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


def success_response(request: Request, kind: str) -> Response:
    if request.url.path.startswith("/api/"):
        return JSONResponse({"status": "ok", "submitted": kind})

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


def read_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def write_json_file(path: Path, payload: Any) -> None:
    ensure_directory(path.parent)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def require_admin_password(password: Optional[str]) -> None:
    if not SUBMISSIONS_ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Submission download access is not configured.")

    if not password or not secrets.compare_digest(password, SUBMISSIONS_ADMIN_PASSWORD):
        raise HTTPException(status_code=403, detail="Invalid password.")


def has_valid_admin_password(password: Optional[str]) -> bool:
    if not SUBMISSIONS_ADMIN_PASSWORD:
        return False

    if not password:
        return False

    return secrets.compare_digest(password, SUBMISSIONS_ADMIN_PASSWORD)


def list_submission_files() -> List[Dict[str, Any]]:
    if not SUBMISSIONS_DIR.exists():
        return []

    files: List[Dict[str, Any]] = []
    for path in SUBMISSIONS_DIR.rglob("*"):
        if not path.is_file():
            continue

        relative_path = path.relative_to(SUBMISSIONS_DIR)
        if len(relative_path.parts) < 2:
            continue

        stat = path.stat()
        files.append(
            {
                "name": path.name,
                "path": relative_path.as_posix(),
                "category": relative_path.parts[0] if len(relative_path.parts) > 0 else "",
                "submissionId": relative_path.parts[1] if len(relative_path.parts) > 1 else "",
                "bytes": stat.st_size,
                "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).replace(microsecond=0).isoformat(),
            }
        )

    files.sort(key=lambda item: item["modifiedAt"], reverse=True)
    return files


def resolve_submission_path(relative_path: str) -> Path:
    candidate = (SUBMISSIONS_DIR / relative_path).resolve()
    submissions_root = SUBMISSIONS_DIR.resolve()

    try:
        candidate.relative_to(submissions_root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="File not found.") from exc

    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    return candidate


def resolve_submission_directory(category: str, submission_id: str) -> Path:
    candidate = (SUBMISSIONS_DIR / category / submission_id).resolve()
    submissions_root = SUBMISSIONS_DIR.resolve()

    try:
        candidate.relative_to(submissions_root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Submission folder not found.") from exc

    if not candidate.is_dir():
        raise HTTPException(status_code=404, detail="Submission folder not found.")

    return candidate


def resolve_submission_directory_from_file(relative_path: str) -> Path:
    parts = Path(relative_path).parts
    if len(parts) < 3:
        raise HTTPException(status_code=404, detail="Submission folder not found.")

    category = parts[0]
    submission_id = parts[1]
    return resolve_submission_directory(category, submission_id)


def remove_empty_parent_dirs(path: Path) -> None:
    submissions_root = SUBMISSIONS_DIR.resolve()
    current = path.parent

    while current != submissions_root and current.exists():
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def list_submission_groups() -> List[Dict[str, Any]]:
    if not SUBMISSIONS_DIR.exists():
        return []

    groups: List[Dict[str, Any]] = []
    for category_dir in SUBMISSIONS_DIR.iterdir():
        if not category_dir.is_dir():
            continue

        for submission_dir in category_dir.iterdir():
            if not submission_dir.is_dir():
                continue

            file_count = 0
            total_bytes = 0
            latest_modified = submission_dir.stat().st_mtime

            for file_path in submission_dir.rglob("*"):
                if not file_path.is_file():
                    continue

                stat = file_path.stat()
                file_count += 1
                total_bytes += stat.st_size
                latest_modified = max(latest_modified, stat.st_mtime)

            groups.append(
                {
                    "category": category_dir.name,
                    "submissionId": submission_dir.name,
                    "fileCount": file_count,
                    "bytes": total_bytes,
                    "modifiedAt": datetime.fromtimestamp(latest_modified, timezone.utc)
                    .replace(microsecond=0)
                    .isoformat(),
                }
            )

    groups.sort(key=lambda item: item["modifiedAt"], reverse=True)
    return groups


def delete_submission_directory(path: Path) -> None:
    for child in sorted(path.rglob("*"), reverse=True):
        if child.is_file() or child.is_symlink():
            child.unlink()
            continue

        child.rmdir()

    path.rmdir()
    remove_empty_parent_dirs(path)


def delete_submission_file(path: Path) -> None:
    path.unlink()
    remove_empty_parent_dirs(path)


def read_print_color_options() -> str:
    if not PRINT_COLOR_OPTIONS_PATH.exists():
        return ""

    return PRINT_COLOR_OPTIONS_PATH.read_text(encoding="utf-8")


def validate_print_color_options(content: str) -> str:
    normalized = content.replace("\r\n", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="CSV content cannot be empty.")

    lines = [line.strip() for line in normalized.split("\n") if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="CSV content cannot be empty.")

    header = lines[0].replace("\ufeff", "")
    if header != "Material,Common colors":
        raise HTTPException(status_code=400, detail='CSV header must be exactly "Material,Common colors".')

    return normalized + "\n"


def get_request_ip(request: Request) -> str:
    header_candidates = [
        request.headers.get("cf-connecting-ip"),
        request.headers.get("x-forwarded-for"),
        request.headers.get("x-real-ip"),
    ]

    for value in header_candidates:
        if value:
            return value.split(",")[0].strip()

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


def client_metadata(request: Request) -> Dict[str, Optional[str]]:
    return {
        "receivedAt": now_iso(),
        "ip": get_request_ip(request),
        "userAgent": request.headers.get("user-agent"),
        "referer": request.headers.get("referer"),
    }


def build_system_prompt(request_type: str = "") -> str:
    request_type_line = (
        f"- Prioritize guidance for this request type: {request_type.strip()}.\n"
        if request_type and request_type.strip()
        else ""
    )

    return (
        "You are an assistant for a small product development and prototyping shop providing quick, approximate quotes for custom work. "
        "Be concise, practical, and cautiously worded.\n\n"

        "Shop background:\n"
        "- Run by a mechanical/mechatronics engineer with multidisciplinary experience.\n"
        "- Strong background in machine learning, robotics (kinematics, control), and embedded systems.\n"
        "- Experience with Arduino, ESP32, IoT systems, and custom electronics.\n"
        "- Skilled in CAD (SolidWorks/Fusion 360), rapid prototyping, and product design.\n"
        "- Hands-on fabrication: 3D printing (FDM/resin), laser cutting/engraving, and basic machining.\n"
        "- PCB design and electronics integration experience.\n"
        "- LED systems and embedded lighting/control systems.\n"
        "- Web development experience (frontends, APIs, device interfaces).\n"
        "- Experience in medical device R&D environments.\n"
        "- Designed and sold physical products (e.g., fidget toys, LED art).\n"
        "- Holds patents and has experience with product/IP development.\n"
        "- Focus on custom, low-volume prototype and product development work.\n\n"

        "Pricing philosophy:\n"
        "- Pricing should reflect specialized, high-skill engineering work.\n"
        "- Default toward slightly higher, professional freelance engineering rates.\n"
        "- Complex multidisciplinary or full-system builds should skew higher.\n"
        "- Hardware + software + integration work should be priced at a premium.\n\n"

        "Royalty structure (use when project involves novel product, IP, or commercialization):\n"
        "- Provide FOUR scenarios:\n"
        "  1) No royalties (0%) -> highest upfront cost\n"
        "  2) Low royalties (~3-5%) -> slightly reduced upfront cost\n"
        "  3) Mid royalties (~5-10%) -> moderately reduced upfront cost\n"
        "  4) High royalties (~10-20%) -> significantly reduced upfront cost\n"
        "  5) Partnership (>20%) -> very low upfront cost, treated like shared upside\n"
        "- Pricing should decrease progressively as royalty percentage increases.\n"
        "- Partnership implies ongoing involvement or shared product ownership.\n"
        "- If royalties are not relevant, provide a single estimate only.\n\n"

        "Primary goals:\n"
        "- Understand the request quickly.\n"
        "- Ask at most ONE essential clarifying question, only if needed.\n"
        "- Provide rough price ranges in USD.\n"
        "- Briefly state what is included.\n"
        "- State key assumptions when appropriate.\n\n"

        "Rules:\n"
        "- Keep the response short.\n"
        "- Do not include time estimates, lead times, schedules, turnaround, or timelines.\n"
        "- Never mention days, weeks, months, hours, delivery windows, or timelines.\n"
        "- If enough info is available, skip questions.\n"
        "- Ask zero questions when a reasonable estimate can still be given.\n"
        "- If there is not enough information, ask exactly one short question and stop.\n"
        "- Do not make assumptions when key project details are missing.\n"
        "- Only include assumptions when enough detail is present.\n"
        "- Always frame pricing as approximate and uncertain.\n"
        "- Avoid confident or definitive language.\n"
        "- Never invent missing scope or requirements.\n"
        "- If the request is unrealistic or unsafe, respond only with: 'This request is outside the scope of this quote tool.'\n"
        + request_type_line
        + "\n"

        "Output format:\n"
        "Question:\n"
        "- 0 or 1 short bullet (only if critical)\n"
        "- If insufficient info, ask one question and STOP\n\n"

        "Estimate:\n"
        "- If royalties apply:\n"
        "  • No royalties:\n"
        "  • Low royalties (3-5%):\n"
        "  • High royalties (20-40%):\n"
        "- Each option: 1 short bullet with USD range + what it covers\n"
        "- If royalties do NOT apply: 1-3 bullets total\n\n"

        "Assumptions:\n"
        "- 1 to 3 short bullets\n"
        "- Only include if enough detail exists\n\n"

        "Tone:\n"
        "- Short, clear, and practical\n"
        "- Slightly cautious and non-committal\n"
        "- No long explanations\n"
    )


        "- Do not include time estimates, schedules, or timelines.\n"
        "- Never mention hours, days, weeks, or delivery timing.\n"
    if not raw_text:
        return "I couldn’t generate a quote right now. Please try again."
        "- If insufficient information, ask exactly one short question and stop.\n"
    money_matches = re.findall(r"\$\s*(\d[\d,]*(?:\.\d+)?)\s*([kKmM]?)", normalized)
    if money_matches:
        max_amount = 0.0
        "- Avoid definitive language.\n"
            amount = float(amount_text.replace(",", ""))

            if suffix.lower() == "k":
                amount *= 1_000
            elif suffix.lower() == "m":
                amount *= 1_000_000

            max_amount = max(max_amount, amount)

        if max_amount > 500_000:
        "- If royalties apply, use this structure:\n"
        "  • No royalties (0%):\n"
        "  • Low royalties (3-5%):\n"
        "  • Mid royalties (5-10%):\n"
        "  • High royalties (10-20%):\n"
        "  • Partnership (>20%):\n"
    current_section = ""
        "- If royalties do NOT apply: 1-3 bullets total\n\n"
    time_pattern = re.compile(
        r"\b(day|days|week|weeks|month|months|hour|hours|timeline|timelines|lead time|lead times|turnaround|schedule|eta|etas|business day|business days)\b",
        re.IGNORECASE,
    )

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if filtered_lines and filtered_lines[-1] != "":
                filtered_lines.append("")
            continue

        if stripped.endswith(":"):
            current_section = stripped.lower().rstrip(":")
            filtered_lines.append(stripped)
            continue

        if time_pattern.search(stripped):
            continue

        if current_section == "question":
            if stripped.startswith("-"):
                if question_count >= 1:
                    continue
                question_count += 1
                filtered_lines.append(stripped)
                continue

            if question_count >= 1:
                continue

        filtered_lines.append(stripped)

    sanitized_lines: List[str] = []
    for line in filtered_lines:
        if line == "" and (not sanitized_lines or sanitized_lines[-1] == ""):
            continue
        sanitized_lines.append(line)

    sanitized = "\n".join(sanitized_lines).strip()
    return sanitized or "This request is outside the scope of this quote tool."


def estimate_token_count(text: str) -> int:
    content = (text or "").strip()
    if not content:
        return 0
    return max(1, (len(content) + 3) // 4)


def read_usage_metadata_token_counts(response: Any) -> Dict[str, int]:
    usage_metadata = getattr(response, "usage_metadata", None)
    if usage_metadata is None:
        return {}

    def read_attr(name: str) -> int:
        value = getattr(usage_metadata, name, 0)
        return int(value or 0)

    return {
        "promptTokens": read_attr("prompt_token_count"),
        "candidatesTokens": read_attr("candidates_token_count"),
        "totalTokens": read_attr("total_token_count"),
    }


def get_daily_usage_snapshot(user_key: str) -> Dict[str, Any]:
    day_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    usage_log = read_json_file(AI_USAGE_LOG_PATH, {})
    days = usage_log.get("days") if isinstance(usage_log, dict) else {}
    day_entry = days.get(day_key) if isinstance(days, dict) else {}
    users = day_entry.get("users") if isinstance(day_entry, dict) else {}
    user_entry = users.get(user_key) if isinstance(users, dict) else {}

    return {
        "dayKey": day_key,
        "usageLog": usage_log if isinstance(usage_log, dict) else {},
        "userEntry": user_entry if isinstance(user_entry, dict) else {},
    }


def get_usage_log() -> Dict[str, Any]:
    usage_log = read_json_file(AI_USAGE_LOG_PATH, {})
    return usage_log if isinstance(usage_log, dict) else {}


def list_ai_usage_users(day_key: Optional[str] = None) -> Dict[str, Any]:
    usage_log = get_usage_log()
    resolved_day_key = day_key or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    days = usage_log.get("days") if isinstance(usage_log, dict) else {}
    day_entry = days.get(resolved_day_key) if isinstance(days, dict) else {}
    users = day_entry.get("users") if isinstance(day_entry, dict) else {}

    rows: List[Dict[str, Any]] = []
    if isinstance(users, dict):
        for user_key, entry in users.items():
            if not isinstance(entry, dict):
                continue

            rows.append(
                {
                    "user": user_key,
                    "promptTokens": int(entry.get("promptTokens", 0) or 0),
                    "candidatesTokens": int(entry.get("candidatesTokens", 0) or 0),
                    "totalTokens": int(entry.get("totalTokens", 0) or 0),
                    "requestCount": int(entry.get("requestCount", 0) or 0),
                    "lastRequestType": str(entry.get("lastRequestType", "") or ""),
                    "lastModel": str(entry.get("lastModel", "") or ""),
                    "updatedAt": str(entry.get("updatedAt", "") or ""),
                }
            )

    rows.sort(key=lambda item: (item["totalTokens"], item["updatedAt"]), reverse=True)
    return {
        "dayKey": resolved_day_key,
        "users": rows,
        "dailyLimit": AI_DAILY_TOKEN_LIMIT,
        "logPath": str(AI_USAGE_LOG_PATH),
        "updatedAt": str(day_entry.get("updatedAt", "") or "") if isinstance(day_entry, dict) else "",
    }


def reset_ai_usage_user(user_key: str, day_key: Optional[str] = None) -> Dict[str, Any]:
    target_user = (user_key or "").strip()
    if not target_user:
        raise HTTPException(status_code=400, detail="User is required.")

    usage_log = get_usage_log()
    resolved_day_key = day_key or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    days = usage_log.get("days")
    if not isinstance(days, dict):
        raise HTTPException(status_code=404, detail="No AI usage data found.")

    day_entry = days.get(resolved_day_key)
    if not isinstance(day_entry, dict):
        raise HTTPException(status_code=404, detail="No AI usage data found for that day.")

    users = day_entry.get("users")
    if not isinstance(users, dict) or target_user not in users:
        raise HTTPException(status_code=404, detail="User not found in AI usage log.")

    del users[target_user]
    day_entry["updatedAt"] = now_iso()
    write_json_file(AI_USAGE_LOG_PATH, usage_log)
    return {"status": "reset", "user": target_user, "dayKey": resolved_day_key}


def get_user_used_tokens_today(user_key: str) -> int:
    snapshot = get_daily_usage_snapshot(user_key)
    user_entry = snapshot["userEntry"]
    return int(user_entry.get("totalTokens", 0))


def append_usage_log(user_key: str, model: str, token_counts: Dict[str, int], request_type: str) -> Dict[str, int]:
    snapshot = get_daily_usage_snapshot(user_key)
    usage_log = snapshot["usageLog"]
    day_key = snapshot["dayKey"]

    days = usage_log.setdefault("days", {})
    day_entry = days.setdefault(day_key, {"users": {}, "updatedAt": now_iso()})
    users = day_entry.setdefault("users", {})
    user_entry = users.setdefault(
        user_key,
        {
            "promptTokens": 0,
            "candidatesTokens": 0,
            "totalTokens": 0,
            "requestCount": 0,
            "lastRequestType": "",
            "lastModel": "",
            "updatedAt": now_iso(),
        },
    )

    user_entry["promptTokens"] = int(user_entry.get("promptTokens", 0)) + int(token_counts.get("promptTokens", 0))
    user_entry["candidatesTokens"] = int(user_entry.get("candidatesTokens", 0)) + int(token_counts.get("candidatesTokens", 0))
    user_entry["totalTokens"] = int(user_entry.get("totalTokens", 0)) + int(token_counts.get("totalTokens", 0))
    user_entry["requestCount"] = int(user_entry.get("requestCount", 0)) + 1
    user_entry["lastRequestType"] = request_type.strip()
    user_entry["lastModel"] = model
    user_entry["updatedAt"] = now_iso()
    day_entry["updatedAt"] = now_iso()

    write_json_file(AI_USAGE_LOG_PATH, usage_log)
    return {
        "promptTokens": int(user_entry["promptTokens"]),
        "candidatesTokens": int(user_entry["candidatesTokens"]),
        "totalTokens": int(user_entry["totalTokens"]),
        "requestCount": int(user_entry["requestCount"]),
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/admin/submissions")
def admin_submissions(x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password")) -> Dict[str, Any]:
    require_admin_password(x_admin_password)
    return {"files": list_submission_files(), "groups": list_submission_groups()}


@app.get("/api/admin/submissions/download")
def admin_download_submission(
    path: str,
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
) -> Response:
    require_admin_password(x_admin_password)
    target = resolve_submission_path(path)
    return FileResponse(target, filename=target.name)


@app.post("/api/admin/submissions/upload")
async def admin_upload_submissions(
    uploaded_files: List[UploadFile] = File(..., alias="file"),
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
) -> Dict[str, Any]:
    require_admin_password(x_admin_password)
    submission_dir = make_submission_dir("admin")
    files = await save_files(uploaded_files, submission_dir / "files")
    return {"saved": files}


@app.delete("/api/admin/submissions")
def admin_delete_submission(
    path: str,
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
) -> Dict[str, str]:
    require_admin_password(x_admin_password)
    target = resolve_submission_path(path)
    delete_submission_file(target)
    return {"status": "deleted"}


@app.delete("/api/admin/submission-folders")
def admin_delete_submission_folder(
    category: str,
    submission_id: str,
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
) -> Dict[str, str]:
    require_admin_password(x_admin_password)
    target = resolve_submission_directory(category, submission_id)
    delete_submission_directory(target)
    return {"status": "deleted"}


@app.get("/api/admin/print-color-options")
def admin_get_print_color_options(
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
) -> Dict[str, str]:
    require_admin_password(x_admin_password)
    return {"content": read_print_color_options()}


@app.put("/api/admin/print-color-options")
def admin_update_print_color_options(
    payload: CsvUpdateRequest,
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
) -> Dict[str, str]:
    require_admin_password(x_admin_password)
    validated = validate_print_color_options(payload.content)
    PRINT_COLOR_OPTIONS_PATH.write_text(validated, encoding="utf-8")
    return {"status": "saved"}


@app.get("/api/admin/ai-usage")
def admin_get_ai_usage(
    day_key: Optional[str] = None,
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
) -> Dict[str, Any]:
    require_admin_password(x_admin_password)
    return list_ai_usage_users(day_key)


@app.delete("/api/admin/ai-usage")
def admin_reset_ai_usage(
    payload: AiUsageResetRequest,
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
) -> Dict[str, Any]:
    require_admin_password(x_admin_password)
    return reset_ai_usage_user(payload.user, payload.dayKey)


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
    return success_response(request, "printing")


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
    return success_response(request, "laser")


@app.post("/api/product-request")
async def product_request(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    org: Optional[str] = Form(None),
    timeline: Optional[str] = Form(None),
    requestType: str = Form(...),
    notes: str = Form(...),
    aiConversation: Optional[str] = Form(None),
    uploaded_files: Optional[List[UploadFile]] = File(None, alias="file"),
) -> Response:
    uploads = filter_blank_uploads(uploaded_files)
    if uploads:
        validate_files(uploads, FILE_RULES["product"], "product development request")

    parsed_ai_conversation: List[Dict[str, str]] = []
    if aiConversation:
        try:
            payload = json.loads(aiConversation)
        except json.JSONDecodeError:
            payload = []

        if isinstance(payload, list):
            for turn in payload:
                if not isinstance(turn, dict):
                    continue

                role = str(turn.get("role") or "").strip()
                text = str(turn.get("text") or "").strip()
                if not role or not text:
                    continue
                parsed_ai_conversation.append({"role": role, "text": text})

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
                "aiConversation": parsed_ai_conversation,
            },
            "files": files,
        },
    )
    return success_response(request, "product")


@app.post("/api/quote")
def api_quote(req: QuoteRequest, request: Request) -> Dict[str, Any]:
    user_key = get_request_ip(request)
    raw_message = (req.message or "").strip()
    if raw_message and has_valid_admin_password(raw_message):
        usage_snapshot = get_daily_usage_snapshot(user_key)
        reset_ai_usage_user(user_key, usage_snapshot["dayKey"])
        return {
            "text": "Token count reset. Send your next message when ready.",
            "usage": {
                "user": user_key,
                "todayTotalTokens": 0,
                "requestCountToday": 0,
                "dailyLimit": AI_DAILY_TOKEN_LIMIT,
                "remainingTokens": AI_DAILY_TOKEN_LIMIT,
                "logPath": str(AI_USAGE_LOG_PATH),
                "adminOverrideUsed": True,
                "adminResetUsed": True,
                "adminResetCommandUsed": True,
            },
        }

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
    transcript_text = "\n".join(transcript)

    usage_snapshot = get_daily_usage_snapshot(user_key)
    used_tokens_today = get_user_used_tokens_today(user_key)
    estimated_prompt_tokens = estimate_token_count(transcript_text)
    is_admin_override = has_valid_admin_password(req.adminPassword)
    admin_reset_used = False
    if AI_DAILY_TOKEN_LIMIT and is_admin_override and used_tokens_today + estimated_prompt_tokens > AI_DAILY_TOKEN_LIMIT:
        reset_ai_usage_user(user_key, usage_snapshot["dayKey"])
        used_tokens_today = 0
        admin_reset_used = True

    if AI_DAILY_TOKEN_LIMIT and not is_admin_override and used_tokens_today + estimated_prompt_tokens > AI_DAILY_TOKEN_LIMIT:
        return {
            "text": "Daily AI limit reached for this user. Please try again later.",
            "usage": {
                "user": user_key,
                "todayTotalTokens": used_tokens_today,
                "dailyLimit": AI_DAILY_TOKEN_LIMIT,
                "remainingTokens": max(0, AI_DAILY_TOKEN_LIMIT - used_tokens_today),
                "logPath": str(AI_USAGE_LOG_PATH),
                "limitReached": True,
                "adminOverrideAvailable": bool(SUBMISSIONS_ADMIN_PASSWORD),
            },
        }

    resp = client.models.generate_content(model=model, contents=transcript_text)
    response_text = sanitize_quote_response(
        getattr(resp, "text", None) or "I couldn’t generate a quote right now. Please try again."
    )
    token_counts = read_usage_metadata_token_counts(resp)
    if not token_counts.get("totalTokens"):
        completion_tokens = estimate_token_count(response_text)
        token_counts = {
            "promptTokens": estimated_prompt_tokens,
            "candidatesTokens": completion_tokens,
            "totalTokens": estimated_prompt_tokens + completion_tokens,
        }

    updated_usage = append_usage_log(user_key, model, token_counts, req.requestType or "")
    return {
        "text": response_text,
        "usage": {
            "user": user_key,
            "requestTokens": token_counts,
            "todayTotalTokens": updated_usage["totalTokens"],
            "requestCountToday": updated_usage["requestCount"],
            "dailyLimit": AI_DAILY_TOKEN_LIMIT,
            "remainingTokens": max(0, AI_DAILY_TOKEN_LIMIT - updated_usage["totalTokens"]) if AI_DAILY_TOKEN_LIMIT else None,
            "logPath": str(AI_USAGE_LOG_PATH),
            "adminOverrideUsed": is_admin_override,
            "adminResetUsed": admin_reset_used,
        },
    }