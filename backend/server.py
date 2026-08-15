from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form, Query
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import IndexModel, ASCENDING
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
import logging
import bcrypt
import jwt
import httpx
import time
import secrets
import hashlib
import re
import asyncio
from collections import defaultdict, deque
from urllib.parse import urlparse

from backend.services.timezone import (
    get_today_date,
    get_yesterday_date,
    get_month_bounds,
    validate_past_or_today,
    now_tz,
    BUSINESS_TIMEZONE_NAME,
)
from backend.services.payroll import PayrollService
from backend.services.storage import VoiceStorage, ProfilePhotoStorage, PHOTO_UPLOAD_DIR
from backend.services.email import email_service
from backend.services.salary_slip_pdf import generate_salary_slip_pdf, sanitize_filename
from backend.services import push

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL')
if not mongo_url:
    raise RuntimeError('MONGO_URL environment variable is required. See backend/.env.example')
try:
    import certifi
    _ca_file = certifi.where()
except Exception:
    _ca_file = None

_client_kwargs: dict[str, Any] = {
    "serverSelectionTimeoutMS": int(os.environ.get("MONGO_SERVER_SELECTION_TIMEOUT_MS", "5000")),
    "connectTimeoutMS": int(os.environ.get("MONGO_CONNECT_TIMEOUT_MS", "5000")),
}
if _ca_file and ("mongodb+srv://" in mongo_url or "ssl=true" in mongo_url.lower() or "tls=true" in mongo_url.lower()):
    _client_kwargs["tlsCAFile"] = _ca_file

client = AsyncIOMotorClient(mongo_url, **_client_kwargs)
_db_name = os.environ.get('DB_NAME')
if not _db_name:
    raise RuntimeError('DB_NAME environment variable is required. See backend/.env.example')
db = client[_db_name]

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    raise RuntimeError('JWT_SECRET environment variable is required. See backend/.env.example')
JWT_ALGORITHM = "HS256"

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"
COOKIE_SECURE = IS_PRODUCTION or os.environ.get("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "none" if IS_PRODUCTION else "lax").lower()
SESSION_MAX_AGE = int(os.environ.get("SESSION_MAX_AGE_SECONDS", "5184000"))
MESSAGE_RETENTION = timedelta(hours=48)
voice_storage = VoiceStorage()
photo_storage = ProfilePhotoStorage()

app = FastAPI(title="WorkForce API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
_rate_buckets: dict[str, deque] = defaultdict(deque)
_voice_expiration_task = None


def parse_utc_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def message_expiry_from_created_at(created_at: Any) -> Optional[datetime]:
    parsed = parse_utc_datetime(created_at)
    return parsed + MESSAGE_RETENTION if parsed else None


def visible_message_filter(now: Optional[datetime] = None) -> dict:
    cutoff = now or datetime.now(timezone.utc)
    return {"$or": [{"expires_at": {"$exists": False}}, {"expires_at": {"$gt": cutoff}}]}


def validate_environment() -> None:
    if voice_storage.provider not in {"local", "cloudinary"}:
        raise RuntimeError("MEDIA_STORAGE must be either 'local' or 'cloudinary'")

    required = []
    if voice_storage.provider == "cloudinary":
        required += ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]
    if IS_PRODUCTION:
        required += ["MONGO_URL", "DB_NAME", "JWT_SECRET", "CORS_ORIGINS", "FRONTEND_URL"]
    for name in required:
        if not os.environ.get(name, "").strip():
            raise RuntimeError(f"Missing required environment variable: {name}")
    if not IS_PRODUCTION:
        return
    if os.environ.get("CORS_ORIGINS", "").strip() == "*":
        raise RuntimeError("CORS_ORIGINS must be an explicit allowlist in production")
    if len(JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters in production")


def set_session_cookie(response: Response, name: str, value: str, csrf_token: Optional[str] = None) -> str:
    response.set_cookie(name, value, httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE,
                        max_age=SESSION_MAX_AGE, path="/")
    csrf = csrf_token or secrets.token_urlsafe(24)
    response.set_cookie("csrf_token", csrf, httponly=False, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE,
                        max_age=SESSION_MAX_AGE, path="/")
    return csrf


def rate_limit(request: Request, scope: str, limit: int, window: int = 60) -> None:
    key = f"{scope}:{request.client.host if request.client else 'unknown'}"
    now = time.monotonic()
    bucket = _rate_buckets[key]
    while bucket and bucket[0] <= now - window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please try again shortly.")
    bucket.append(now)


# ---------------- Helpers & Auth Dependencies ----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(admin_id: str, email: str, business_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": admin_id,
        "email": email,
        "business_id": business_id,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(seconds=SESSION_MAX_AGE),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_or_create_business_for_admin(admin: dict) -> dict:
    """Ensures the admin has an associated business workspace."""
    biz = await db.businesses.find_one({"owner_admin_id": admin["id"]}, {"_id": 0})
    if not biz:
        biz_id = str(uuid.uuid4())
        name = f"{admin.get('name', 'My')} Workspace"
        biz_doc = {
            "id": biz_id,
            "name": name,
            "owner_admin_id": admin["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.businesses.insert_one(biz_doc)
        biz = {k: v for k, v in biz_doc.items() if k != "_id"}
        logger.info(f"Created new business workspace {biz_id} for admin {admin['id']}")
    return biz


async def get_current_admin(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid session")
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        if await db.revoked_admin_tokens.find_one({"token_hash": token_hash}):
            raise HTTPException(status_code=401, detail="Session expired")
        admin = await db.admins.find_one(
            {"id": payload["sub"], "is_active": {"$ne": False}, "disabled_at": {"$in": [None, ""]}},
            {"_id": 0, "password_hash": 0}
        )
        if not admin:
            raise HTTPException(status_code=401, detail="Admin not found or deactivated")
        changed_at = admin.get("password_changed_at")
        issued_at = payload.get("iat")
        if changed_at and issued_at:
            changed = datetime.fromisoformat(changed_at) if isinstance(changed_at, str) else changed_at
            if changed.tzinfo is None:
                changed = changed.replace(tzinfo=timezone.utc)
            if datetime.fromtimestamp(issued_at, timezone.utc) < changed:
                raise HTTPException(status_code=401, detail="Session expired")
        
        # Verify and attach business ownership
        business = await get_or_create_business_for_admin(admin)
        admin["business_id"] = business["id"]
        admin["business"] = business
        return admin
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_worker(request: Request) -> dict:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    session = await db.worker_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        await db.worker_sessions.delete_one({"session_token": token})
        raise HTTPException(status_code=401, detail="Session expired")

    worker = await db.workers.find_one(
        {"id": session["worker_id"], "business_id": session["business_id"]},
        {"_id": 0, "password_hash": 0}
    )
    if not worker:
        await db.worker_sessions.delete_one({"session_token": token})
        raise HTTPException(status_code=401, detail="Worker profile not found")
    if worker.get("status", "ACTIVE") == "INACTIVE":
        await db.worker_sessions.delete_many({"worker_id": worker["id"]})
        raise HTTPException(
            status_code=403,
            detail="Your account is currently inactive. Please contact your owner. / आपका खाता अभी बंद है। मालिक से संपर्क करें।"
        )
    if not worker.get("portal_enabled", False):
        await db.worker_sessions.delete_many({"worker_id": worker["id"]})
        raise HTTPException(status_code=403, detail="Portal access is disabled for this worker")

    # A valid authenticated request renews the server-side session window.
    await db.worker_sessions.update_one(
        {"session_token": token},
        {"$set": {"expires_at": (datetime.now(timezone.utc) + timedelta(seconds=SESSION_MAX_AGE)).isoformat(),
                  "last_seen_at": datetime.now(timezone.utc).isoformat()}},
    )

    worker["worker_id"] = worker["id"]
    worker["user_id"] = worker["id"]
    return worker


# ---------------- Pydantic Models ----------------
class AdminSignup(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    business_name: str = Field(min_length=2, max_length=100)
    username: str = Field(min_length=3, max_length=50)
    email: str
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str) -> str:
        norm = value.strip().lower()
        if not re.match(r"^[a-z0-9_-]{3,50}$", norm):
            raise ValueError("Username must be 3-50 characters (letters, numbers, underscores, hyphens)")
        return norm

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        norm = value.strip().lower()
        if "@" not in norm or "." not in norm.rsplit("@", 1)[-1]:
            raise ValueError("Enter a valid email address")
        return norm


class AdminLogin(BaseModel):
    identifier: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=1, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        norm = value.strip().lower()
        if "@" not in norm or "." not in norm.rsplit("@", 1)[-1]:
            raise ValueError("Enter a valid email address")
        return norm


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=256)
    new_password: str = Field(min_length=8, max_length=128)


class BusinessUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    timezone: str = "Asia/Kolkata"

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(value)
        except Exception as exc:
            raise ValueError("Unknown timezone") from exc
        return value


class WorkerLogin(BaseModel):
    login_id: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=1, max_length=128)


def normalize_indian_phone_identifier(identifier: str) -> Optional[str]:
    """Return a valid ten-digit Indian mobile number, without touching Worker IDs."""
    compact = re.sub(r"[\s-]+", "", identifier.strip())
    if compact.startswith("+91"):
        compact = compact[3:]
    elif compact.startswith("91") and len(compact) == 12:
        compact = compact[2:]
    if re.fullmatch(r"[6-9]\d{9}", compact):
        return compact
    return None


class WorkerChangePassword(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class WorkerResetPasswordAdmin(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class WorkerStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def valid_status(cls, value: str) -> str:
        val = value.strip().upper()
        if val not in {"ACTIVE", "INACTIVE"}:
            raise ValueError("Status must be ACTIVE or INACTIVE")
        return val


class WorkTypeCreate(BaseModel):
    name: str = Field(min_length=2, max_length=50)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Work Type name is required")
        return value


class WorkTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=50)
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = " ".join(value.split())
        if not value:
            raise ValueError("Work Type name is required")
        return value


class WorkerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    mobile: str = Field(default="", max_length=20)
    work_type: str = Field(min_length=2, max_length=50)
    joining_date: str
    salary: float = Field(ge=0, le=100000000)
    email: Optional[str] = ""
    status: str = "ACTIVE"
    portal_enabled: bool = True
    login_id: Optional[str] = ""
    password: Optional[str] = ""
    profile_photo_url: Optional[str] = None
    profile_photo_asset_id: Optional[str] = None
    profile_photo_provider: Optional[str] = None
    profile_photo_updated_at: Optional[str] = None

    @field_validator("name", "mobile", "work_type")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("joining_date")
    @classmethod
    def valid_joining_date(cls, value: str) -> str:
        datetime.strptime(value, "%Y-%m-%d")
        return value

    @field_validator("status")
    @classmethod
    def valid_status(cls, value: str) -> str:
        val = (value or "ACTIVE").strip().upper()
        if val not in {"ACTIVE", "INACTIVE"}:
            raise ValueError("Status must be ACTIVE or INACTIVE")
        return val

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: Optional[str]) -> str:
        email = (value or "").strip().lower()
        if email and ("@" not in email or "." not in email.rsplit("@", 1)[-1]):
            raise ValueError("Enter a valid email address")
        return email

    @field_validator("login_id")
    @classmethod
    def valid_login_id(cls, value: Optional[str]) -> str:
        login_id = (value or "").strip().upper()
        if login_id and not re.match(r"^WF-[A-Z0-9]{6,20}$", login_id):
            raise ValueError("Worker ID must use format WF-XXXXXX with uppercase letters or numbers")
        return login_id


class WorkerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    mobile: Optional[str] = Field(None, max_length=20)
    work_type: Optional[str] = Field(None, min_length=2, max_length=50)
    joining_date: Optional[str] = None
    salary: Optional[float] = Field(None, ge=0, le=100000000)
    email: Optional[str] = None
    status: Optional[str] = None
    portal_enabled: Optional[bool] = None
    login_id: Optional[str] = None
    password: Optional[str] = None
    profile_photo_url: Optional[str] = None
    profile_photo_asset_id: Optional[str] = None
    profile_photo_provider: Optional[str] = None
    profile_photo_updated_at: Optional[str] = None

    @field_validator("joining_date")
    @classmethod
    def valid_joining_date(cls, value: Optional[str]) -> Optional[str]:
        if value:
            datetime.strptime(value, "%Y-%m-%d")
        return value

    @field_validator("status")
    @classmethod
    def valid_status(cls, value: Optional[str]) -> Optional[str]:
        if value:
            val = value.strip().upper()
            if val not in {"ACTIVE", "INACTIVE"}:
                raise ValueError("Status must be ACTIVE or INACTIVE")
            return val
        return value

    @field_validator("login_id")
    @classmethod
    def valid_login_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        login_id = value.strip().upper()
        if login_id and not re.match(r"^WF-[A-Z0-9]{6,20}$", login_id):
            raise ValueError("Worker ID must use format WF-XXXXXX with uppercase letters or numbers")
        return login_id


class AttendanceMark(BaseModel):
    worker_id: str
    date: str
    status: str  # Present, Absent, Half Day

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        datetime.strptime(value, "%Y-%m-%d")
        return value

    @field_validator("status")
    @classmethod
    def valid_status(cls, value: str) -> str:
        if value not in {"Present", "Absent", "Half Day"}:
            raise ValueError("Status must be Present, Absent, or Half Day")
        return value


class PaymentCreate(BaseModel):
    worker_id: str
    amount: float = Field(gt=0, le=100000000)
    date: str
    type: str = "SALARY_PAYMENT"  # SALARY_PAYMENT, ADVANCE, EXTRA_WORK_PAYMENT, ADJUSTMENT
    note: Optional[str] = ""

    @field_validator("type")
    @classmethod
    def valid_type(cls, value: str) -> str:
        valid_types = {"SALARY_PAYMENT", "ADVANCE", "EXTRA_WORK_PAYMENT", "ADJUSTMENT"}
        if value not in valid_types:
            raise ValueError(f"Type must be one of {valid_types}")
        return value

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        datetime.strptime(value, "%Y-%m-%d")
        return value


class PaymentUpdate(BaseModel):
    amount: Optional[float] = Field(None, gt=0, le=100000000)
    date: Optional[str] = None
    type: Optional[str] = None
    note: Optional[str] = None


class ExtraWorkCreate(BaseModel):
    worker_id: str
    description: str = Field(min_length=2, max_length=500)
    date: str
    amount: float = Field(gt=0, le=100000000)


class MessageCreate(BaseModel):
    conversation_id: Optional[str] = None
    worker_id: Optional[str] = None
    message_type: str = "text"  # text or audio
    text: Optional[str] = Field("", max_length=4000)
    audio_asset_id: Optional[str] = None
    duration: Optional[float] = 0.0


class PushSubscriptionCreate(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: Dict[str, str]

    @field_validator("keys")
    @classmethod
    def valid_keys(cls, value: Dict[str, str]) -> Dict[str, str]:
        if not value.get("p256dh") or not value.get("auth"):
            raise ValueError("Push subscription keys are incomplete")
        return value


def generate_unique_worker_id() -> str:
    """Generates an alphanumeric Worker ID like WF-7F3K92."""
    suffix = secrets.token_hex(3).upper()
    return f"WF-{suffix}"


def clean_worker_document(worker: dict) -> dict:
    """Return the admin-safe worker representation without any password material."""
    return {k: v for k, v in worker.items() if k not in {"_id", "password", "password_hash", "temporary_password"}}


# ---------------- Admin Authentication Routes ----------------
@api_router.post("/admin/signup")
async def admin_signup(body: AdminSignup, response: Response, request: Request):
    rate_limit(request, "admin-signup", 10, 60)
    username = body.username
    email = body.email

    existing_username = await db.admins.find_one({"username": username})
    if existing_username:
        raise HTTPException(status_code=409, detail="This username is already taken. Please choose another.")

    existing_email = await db.admins.find_one({"email": email})
    if existing_email:
        raise HTTPException(status_code=409, detail="An account with this email address already exists.")

    admin_id = str(uuid.uuid4())
    biz_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    admin_doc = {
        "id": admin_id,
        "name": body.name.strip(),
        "username": username,
        "email": email,
        "password_hash": hash_password(body.password),
        "is_active": True,
        "created_at": now_iso,
        "updated_at": now_iso,
        "last_login_at": now_iso,
    }
    await db.admins.insert_one(admin_doc)

    biz_doc = {
        "id": biz_id,
        "name": body.business_name.strip(),
        "owner_admin_id": admin_id,
        "timezone": "Asia/Kolkata",
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.businesses.insert_one(biz_doc)

    token = create_access_token(admin_id, email, biz_id)
    csrf_token = set_session_cookie(response, "access_token", token)

    return {
        "admin": {
            "id": admin_id,
            "name": admin_doc["name"],
            "username": username,
            "email": email,
            "business_id": biz_id,
            "business_name": biz_doc["name"],
        },
        "business": {k: v for k, v in biz_doc.items() if k != "_id"},
        "csrf_token": csrf_token,
    }


@api_router.post("/admin/login")
async def admin_login(body: AdminLogin, response: Response, request: Request):
    rate_limit(request, "admin-login", 15, 60)
    ident = body.identifier.strip().lower()

    admin = await db.admins.find_one(
        {"$or": [{"email": ident}, {"username": ident}], "disabled_at": {"$in": [None, ""]}}
    )
    if not admin or admin.get("is_active") is False or not admin.get("password_hash") or not verify_password(body.password, admin["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username/email or password")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.admins.update_one({"id": admin["id"]}, {"$set": {"last_login_at": now_iso}})

    business = await get_or_create_business_for_admin(admin)
    token = create_access_token(admin["id"], admin["email"], business["id"])
    csrf_token = set_session_cookie(response, "access_token", token)

    return {
        "admin": {
            "id": admin["id"],
            "name": admin.get("name", "Admin"),
            "username": admin.get("username", ""),
            "email": admin["email"],
            "business_id": business["id"],
            "business_name": business.get("name", ""),
        },
        "business": business,
        "csrf_token": csrf_token,
    }


@api_router.post("/admin/forgot-password")
async def admin_forgot_password(body: ForgotPasswordRequest, request: Request):
    rate_limit(request, "admin-forgot-password", 10, 60)
    email = body.email.strip().lower()

    admin = await db.admins.find_one({"email": email, "disabled_at": {"$in": [None, ""]}})
    if admin and admin.get("is_active") is not False:
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()

        # Invalidate existing unused tokens for this admin
        await db.password_reset_tokens.update_many(
            {"admin_id": admin["id"], "used_at": None},
            {"$set": {"used_at": "invalidated_by_new_request"}}
        )

        await db.password_reset_tokens.insert_one({
            "id": str(uuid.uuid4()),
            "admin_id": admin["id"],
            "token_hash": token_hash,
            "expires_at": expires_at,
            "used_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        reset_base = os.environ.get("PASSWORD_RESET_URL", "http://localhost:3000/reset-password").strip()
        reset_link = f"{reset_base}?token={raw_token}"
        await email_service.send_password_reset_email(email, admin.get("name", "Admin"), reset_link)

    # Always return safe generic response
    return {"message": "If an account exists for this email, a reset link has been sent."}


@api_router.post("/admin/reset-password")
async def admin_reset_password(body: ResetPasswordRequest, request: Request):
    rate_limit(request, "admin-reset-password", 10, 60)
    token_hash = hashlib.sha256(body.token.strip().encode("utf-8")).hexdigest()

    reset_doc = await db.password_reset_tokens.find_one({"token_hash": token_hash, "used_at": None})
    if not reset_doc:
        raise HTTPException(status_code=400, detail="Invalid or expired password reset link")

    expires_at = reset_doc.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Password reset link has expired. Please request a new one.")

    now_iso = datetime.now(timezone.utc).isoformat()
    new_hash = hash_password(body.new_password)

    await db.admins.update_one(
        {"id": reset_doc["admin_id"]},
        {"$set": {"password_hash": new_hash, "updated_at": now_iso, "password_changed_at": now_iso}}
    )
    await db.password_reset_tokens.update_one(
        {"id": reset_doc["id"]},
        {"$set": {"used_at": now_iso}}
    )

    return {"message": "Password successfully reset. You can now login with your new password."}


@api_router.get("/admin/me")
async def admin_me(request: Request, response: Response, admin: dict = Depends(get_current_admin)):
    # Renew the secure cookie only after a valid authenticated request.
    csrf_token = set_session_cookie(
        response,
        "access_token",
        create_access_token(admin["id"], admin["email"], admin["business_id"]),
        request.cookies.get("csrf_token"),
    )
    return {**admin, "csrf_token": csrf_token}


@api_router.put("/admin/business")
async def update_business(body: BusinessUpdate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    await db.businesses.update_one(
        {"id": biz_id, "owner_admin_id": admin["id"]},
        {"$set": {"name": body.name.strip(), "timezone": body.timezone, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return await db.businesses.find_one({"id": biz_id}, {"_id": 0})


@api_router.post("/admin/logout")
async def admin_logout(request: Request, response: Response):
    token = request.cookies.get("access_token") or ""
    if token:
        await db.revoked_admin_tokens.update_one(
            {"token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest()},
            {"$set": {"token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest(), "expires_at": datetime.now(timezone.utc) + timedelta(seconds=SESSION_MAX_AGE)}},
            upsert=True,
        )
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("csrf_token", path="/")
    return {"ok": True}


# ---------------- Worker Authentication Routes ----------------
@api_router.post("/worker/login")
async def worker_login(body: WorkerLogin, response: Response, request: Request):
    rate_limit(request, "worker-login", 15, 60)
    identifier = body.login_id.strip()
    phone = normalize_indian_phone_identifier(identifier)
    base_query = {"archived_at": {"$in": [None, ""]}, "deleted_at": {"$in": [None, ""]}}
    if phone:
        # Existing data may use several phone display formats. Normalize candidates in
        # Python and refuse ambiguous matches instead of crossing tenant boundaries.
        candidates = await db.workers.find(base_query).to_list(10000)
        matches = [worker for worker in candidates if normalize_indian_phone_identifier(str(worker.get("mobile", ""))) == phone]
        if len(matches) > 1:
            raise HTTPException(status_code=401, detail="इस मोबाइल नंबर से एक से ज्यादा account जुड़े हैं। कृपया Worker ID से login करें।")
    else:
        matches = await db.workers.find({
            **base_query,
            "login_id": {"$regex": f"^{re.escape(identifier)}$", "$options": "i"},
        }).to_list(2)
    worker = matches[0] if len(matches) == 1 else None
    if not worker or not worker.get("portal_enabled", False) or not worker.get("password_hash") or not verify_password(body.password, worker["password_hash"]):
        raise HTTPException(
            status_code=401,
            detail="Invalid Worker ID / Phone Number or Password. वर्कर आईडी / मोबाइल नंबर या पासवर्ड गलत है।"
        )

    if worker.get("status", "ACTIVE") == "INACTIVE":
        raise HTTPException(
            status_code=403,
            detail="Your account is currently inactive. Please contact your owner. / आपका खाता अभी बंद है। मालिक से संपर्क करें।"
        )

    biz_id = worker["business_id"]
    business = await db.businesses.find_one({"id": biz_id}, {"_id": 0})

    session_token = str(uuid.uuid4())
    now_dt = datetime.now(timezone.utc)
    await db.worker_sessions.insert_one({
        "session_token": session_token,
        "worker_id": worker["id"],
        "business_id": biz_id,
        "expires_at": (now_dt + timedelta(seconds=SESSION_MAX_AGE)).isoformat(),
        "created_at": now_dt.isoformat(),
    })

    csrf_token = set_session_cookie(response, "session_token", session_token)
    clean_worker = {k: v for k, v in worker.items() if k not in {"_id", "password_hash"}}

    return {
        "user": {"user_id": worker["id"], "worker_id": worker["id"], "name": worker.get("name")},
        "worker": clean_worker,
        "business": business,
        "csrf_token": csrf_token,
    }


@api_router.get("/worker/auth/me")
@api_router.get("/worker/me")
async def worker_me(request: Request, response: Response, worker: dict = Depends(get_current_worker)):
    biz_id = worker.get("business_id")
    business = await db.businesses.find_one({"id": biz_id}, {"_id": 0}) if biz_id else None
    csrf_token = set_session_cookie(
        response,
        "session_token",
        request.cookies.get("session_token", ""),
        request.cookies.get("csrf_token"),
    )
    return {
        "user": {"user_id": worker["id"], "worker_id": worker["id"], "name": worker.get("name")},
        "worker": worker,
        "business": business,
        "csrf_token": csrf_token,
    }


@api_router.post("/worker/auth/logout")
@api_router.post("/worker/logout")
async def worker_logout(request: Request, response: Response):
    token = request.cookies.get("session_token") or ""
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        await db.worker_sessions.delete_many({"session_token": token})
    response.delete_cookie("session_token", path="/")
    response.delete_cookie("csrf_token", path="/")
    return {"ok": True}


@api_router.post("/worker/change-password")
async def worker_change_password(body: WorkerChangePassword, worker: dict = Depends(get_current_worker)):
    worker_doc = await db.workers.find_one({"id": worker["id"], "business_id": worker["business_id"]})
    if not worker_doc or not worker_doc.get("password_hash") or not verify_password(body.current_password, worker_doc["password_hash"]):
        raise HTTPException(status_code=400, detail="Incorrect current password / वर्तमान पासवर्ड गलत है")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.workers.update_one(
        {"id": worker["id"]},
        {"$set": {"password_hash": hash_password(body.new_password), "updated_at": now_iso}}
    )
    await db.worker_sessions.delete_many({"worker_id": worker["id"]})
    return {"message": "Password changed successfully / पासवर्ड सफलतापूर्वक बदल दिया गया"}


# ---------------- Business Work Types (Admin Isolated) ----------------
DEFAULT_WORK_TYPES = ("Driver", "Mason", "Helper", "Labour", "Technician", "Supervisor", "Electrician", "Plumber", "Painter")


def normalize_work_type(name: str) -> str:
    return " ".join((name or "").split()).casefold()


async def ensure_default_work_types(business_id: str) -> None:
    """Idempotently provide useful choices without touching worker records."""
    now = datetime.now(timezone.utc).isoformat()
    for name in DEFAULT_WORK_TYPES:
        await db.work_types.update_one(
            {"business_id": business_id, "normalized_name": normalize_work_type(name)},
            {"$setOnInsert": {"id": str(uuid.uuid4()), "business_id": business_id, "name": name,
                              "normalized_name": normalize_work_type(name), "is_active": True,
                              "created_at": now, "updated_at": now}},
            upsert=True,
        )


async def require_active_work_type(business_id: str, name: str) -> None:
    await ensure_default_work_types(business_id)
    work_type = await db.work_types.find_one({
        "business_id": business_id, "normalized_name": normalize_work_type(name), "is_active": True,
    })
    if not work_type:
        raise HTTPException(status_code=422, detail="Select an active Work Type or add a new one first")


@api_router.get("/work-types")
async def list_work_types(include_inactive: bool = False, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    await ensure_default_work_types(biz_id)
    query = {"business_id": biz_id}
    if not include_inactive:
        query["is_active"] = True
    return await db.work_types.find(query, {"_id": 0}).sort("name", 1).to_list(200)


@api_router.post("/work-types")
async def create_work_type(body: WorkTypeCreate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    await ensure_default_work_types(biz_id)
    normalized = normalize_work_type(body.name)
    if await db.work_types.find_one({"business_id": biz_id, "normalized_name": normalized}):
        raise HTTPException(status_code=409, detail="This Work Type already exists.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), "business_id": biz_id, "name": body.name,
           "normalized_name": normalized, "is_active": True, "created_at": now, "updated_at": now}
    try:
        await db.work_types.insert_one(doc)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="This Work Type already exists.") from exc
    return doc


@api_router.put("/work-types/{work_type_id}")
async def update_work_type(work_type_id: str, body: WorkTypeUpdate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    current = await db.work_types.find_one({"id": work_type_id, "business_id": biz_id})
    if not current:
        raise HTTPException(status_code=404, detail="Work Type not found")
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.name is not None:
        normalized = normalize_work_type(body.name)
        duplicate = await db.work_types.find_one({"business_id": biz_id, "normalized_name": normalized, "id": {"$ne": work_type_id}})
        if duplicate:
            raise HTTPException(status_code=409, detail="This Work Type already exists.")
        update.update({"name": body.name, "normalized_name": normalized})
    if body.is_active is not None:
        update["is_active"] = body.is_active
    await db.work_types.update_one({"id": work_type_id, "business_id": biz_id}, {"$set": update})
    return await db.work_types.find_one({"id": work_type_id, "business_id": biz_id}, {"_id": 0})


@api_router.delete("/work-types/{work_type_id}")
async def delete_work_type(work_type_id: str, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    current = await db.work_types.find_one({"id": work_type_id, "business_id": biz_id})
    if not current:
        raise HTTPException(status_code=404, detail="Work Type not found")
    assigned = await db.workers.count_documents({"business_id": biz_id, "work_type": {"$regex": f"^{re.escape(current['name'])}$", "$options": "i"}})
    if assigned:
        raise HTTPException(status_code=409, detail=f"Cannot delete this Work Type because {assigned} workers are using it. Deactivate it instead.")
    await db.work_types.delete_one({"id": work_type_id, "business_id": biz_id})
    return {"ok": True}


# ---------------- Worker CRUD & Management (Admin Isolated) ----------------
@api_router.get("/workers")
async def list_workers(
    search: str = "",
    status: str = "ALL",
    limit: int = 100,
    skip: int = 0,
    admin: dict = Depends(get_current_admin),
):
    biz_id = admin["business_id"]
    limit = min(max(limit, 1), 500)
    q: dict[str, Any] = {"business_id": biz_id}

    if status.upper() in {"ACTIVE", "INACTIVE"}:
        q["status"] = status.upper()

    if search.strip():
        safe = re.escape(search.strip())
        q["$or"] = [{k: {"$regex": safe, "$options": "i"}} for k in ("name", "mobile", "email", "work_type", "login_id")]

    return await db.workers.find(q, {"_id": 0, "password_hash": 0}).sort("created_at", -1).skip(max(skip, 0)).to_list(limit)


@api_router.post("/workers")
async def create_worker(body: WorkerCreate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    doc = body.model_dump()
    await require_active_work_type(biz_id, doc["work_type"])
    doc["email"] = (doc.get("email") or "").strip().lower()
    doc["status"] = (doc.get("status") or "ACTIVE").strip().upper()

    # Check duplicates within business
    dup_or = []
    if doc.get("mobile"):
        dup_or.append({"mobile": doc["mobile"]})
    if doc.get("email"):
        dup_or.append({"email": doc["email"]})
    if doc.get("portal_enabled") and doc.get("login_id"):
        dup_or.append({"login_id": doc["login_id"]})

    if dup_or:
        existing = await db.workers.find_one({"business_id": biz_id, "$or": dup_or})
        if existing:
            if doc.get("mobile") and existing.get("mobile") == doc["mobile"]:
                raise HTTPException(status_code=409, detail="A worker with this mobile number already exists in your workspace")
            if doc.get("email") and existing.get("email") == doc["email"]:
                raise HTTPException(status_code=409, detail="A worker with this email address already exists in your workspace")
            if doc.get("login_id") and existing.get("login_id") == doc["login_id"]:
                raise HTTPException(status_code=409, detail="A worker with this Worker ID already exists in your workspace")

    raw_pwd = (doc.pop("password", "") or "").strip()
    if doc.get("portal_enabled") and len(raw_pwd) < 6:
        raise HTTPException(status_code=422, detail="A password of at least 6 characters is required when Worker Login is enabled")
    if not doc.get("portal_enabled"):
        doc["login_id"] = None

    # If portal enabled but no login_id provided, generate unique Worker ID
    if doc.get("portal_enabled") and not doc.get("login_id"):
        for _ in range(10):
            cand = generate_unique_worker_id()
            if not await db.workers.find_one({"business_id": biz_id, "login_id": cand}):
                doc["login_id"] = cand
                break
        if not doc.get("login_id"):
            raise HTTPException(status_code=503, detail="Could not generate a unique Worker ID. Please try again.")

    if doc.get("portal_enabled") and raw_pwd:
        doc["password_hash"] = hash_password(raw_pwd)
    else:
        doc["password_hash"] = None

    doc["id"] = str(uuid.uuid4())
    doc["business_id"] = biz_id
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = doc["created_at"]

    try:
        await db.workers.insert_one(doc)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Worker ID already exists. Generate another Worker ID and try again.") from exc
    result = clean_worker_document(doc)
    if doc.get("portal_enabled"):
        result["one_time_credentials"] = {"login_id": doc["login_id"], "password": raw_pwd}
    return result


@api_router.put("/workers/{worker_id}")
async def update_worker(worker_id: str, body: WorkerUpdate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    current_worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id})
    if not current_worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    update_data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "work_type" in update_data and normalize_work_type(update_data["work_type"]) != normalize_work_type(current_worker.get("work_type", "")):
        await require_active_work_type(biz_id, update_data["work_type"])
    if "email" in update_data:
        update_data["email"] = (update_data["email"] or "").strip().lower()
    if "status" in update_data:
        update_data["status"] = (update_data["status"] or "ACTIVE").strip().upper()

    # Duplicate check excluding this worker
    dup_or = []
    if update_data.get("mobile"):
        dup_or.append({"mobile": update_data["mobile"]})
    if update_data.get("email"):
        dup_or.append({"email": update_data["email"]})
    if update_data.get("login_id"):
        dup_or.append({"login_id": update_data["login_id"]})

    if dup_or:
        existing = await db.workers.find_one({"business_id": biz_id, "id": {"$ne": worker_id}, "$or": dup_or})
        if existing:
            if update_data.get("mobile") and existing.get("mobile") == update_data["mobile"]:
                raise HTTPException(status_code=409, detail="Another worker already uses this mobile number")
            if update_data.get("email") and existing.get("email") == update_data["email"]:
                raise HTTPException(status_code=409, detail="Another worker already uses this email address")
            if update_data.get("login_id") and existing.get("login_id") == update_data["login_id"]:
                raise HTTPException(status_code=409, detail="Another worker already uses this Worker ID")

    # Portal enablement logic
    portal_on = update_data.get("portal_enabled", current_worker.get("portal_enabled", False))
    if portal_on and not update_data.get("login_id") and not current_worker.get("login_id"):
        for _ in range(10):
            cand = generate_unique_worker_id()
            if not await db.workers.find_one({"business_id": biz_id, "login_id": cand}):
                update_data["login_id"] = cand
                break
        if not update_data.get("login_id"):
            raise HTTPException(status_code=503, detail="Could not generate a unique Worker ID. Please try again.")

    # Password update
    raw_pwd = (update_data.pop("password", None) or "").strip()
    enabling_portal = portal_on and not current_worker.get("portal_enabled", False)
    if enabling_portal and not raw_pwd:
        raise HTTPException(status_code=422, detail="Generate or enter a temporary password to enable Worker Login")
    if raw_pwd and len(raw_pwd) < 6:
        raise HTTPException(status_code=422, detail="Worker password must be at least 6 characters")
    if raw_pwd:
        update_data["password_hash"] = hash_password(raw_pwd)

    # Invalidate sessions if deactivated or portal disabled
    if update_data.get("status") == "INACTIVE" or update_data.get("portal_enabled") is False or raw_pwd:
        await db.worker_sessions.delete_many({"worker_id": worker_id})

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        await db.workers.update_one({"id": worker_id, "business_id": biz_id}, {"$set": update_data})
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Worker ID already exists. Generate another Worker ID and try again.") from exc
    result = await db.workers.find_one({"id": worker_id, "business_id": biz_id}, {"_id": 0, "password_hash": 0})
    if portal_on and raw_pwd:
        result["one_time_credentials"] = {"login_id": result["login_id"], "password": raw_pwd}
    return result


@api_router.patch("/workers/{worker_id}/status")
async def set_worker_status(worker_id: str, body: WorkerStatusUpdate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    new_status = body.status
    now_iso = datetime.now(timezone.utc).isoformat()

    if new_status == "INACTIVE":
        await db.worker_sessions.delete_many({"worker_id": worker_id})

    await db.workers.update_one(
        {"id": worker_id, "business_id": biz_id},
        {"$set": {"status": new_status, "updated_at": now_iso}}
    )
    return await db.workers.find_one({"id": worker_id, "business_id": biz_id}, {"_id": 0, "password_hash": 0})


@api_router.post("/workers/{worker_id}/reset-password")
async def reset_worker_password_by_admin(
    worker_id: str,
    body: WorkerResetPasswordAdmin,
    admin: dict = Depends(get_current_admin),
):
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    login_id = worker.get("login_id")
    if not login_id:
        for _ in range(10):
            cand = generate_unique_worker_id()
            if not await db.workers.find_one({"business_id": biz_id, "login_id": cand}):
                login_id = cand
                break

    await db.workers.update_one(
        {"id": worker_id, "business_id": biz_id},
        {
            "$set": {
                "password_hash": hash_password(body.new_password),
                "portal_enabled": True,
                "login_id": login_id,
                "updated_at": now_iso,
            }
        }
    )
    await db.worker_sessions.delete_many({"worker_id": worker_id})
    return {
        "message": "Worker password updated successfully / पासवर्ड सफलतापूर्वक बदल दिया गया",
        "worker_id": worker_id,
        "login_id": login_id,
        "one_time_credentials": {"login_id": login_id, "password": body.new_password},
    }


@api_router.get("/workers/photos/{filename}")
async def serve_worker_photo(filename: str):
    """Safely serves locally stored profile photos."""
    safe_name = os.path.basename(filename)
    if not safe_name or safe_name != filename:
        raise HTTPException(status_code=400, detail="Invalid photo filename")
    photo_path = PHOTO_UPLOAD_DIR / safe_name
    if not photo_path.is_file():
        raise HTTPException(status_code=404, detail="Profile photo not found")
    media_type = "image/jpeg"
    if safe_name.lower().endswith(".png"):
        media_type = "image/png"
    elif safe_name.lower().endswith(".webp"):
        media_type = "image/webp"
    return FileResponse(
        path=photo_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@api_router.post("/workers/{worker_id}/profile-photo")
async def upload_worker_profile_photo(
    worker_id: str,
    file: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    """Uploads/updates a profile photo for a worker within the admin's business."""
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    # If the worker already has a photo asset, delete it safely
    old_asset = worker.get("profile_photo_asset_id")
    if old_asset:
        await photo_storage.delete_profile_photo(worker)

    upload_result = await photo_storage.upload_profile_photo(file, worker_id=worker_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    update_data = {
        "profile_photo_url": upload_result["secure_url"],
        "profile_photo_asset_id": upload_result["public_id"],
        "profile_photo_provider": upload_result["storage_provider"],
        "profile_photo_updated_at": now_iso,
        "updated_at": now_iso,
    }

    await db.workers.update_one(
        {"id": worker_id, "business_id": biz_id},
        {"$set": update_data},
    )

    updated_worker = await db.workers.find_one(
        {"id": worker_id, "business_id": biz_id},
        {"_id": 0, "password_hash": 0},
    )
    return clean_worker_document(updated_worker)


@api_router.delete("/workers/{worker_id}/profile-photo")
async def remove_worker_profile_photo(
    worker_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Removes a worker's profile photo while preserving history and records."""
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    if worker.get("profile_photo_asset_id"):
        await photo_storage.delete_profile_photo(worker)

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.workers.update_one(
        {"id": worker_id, "business_id": biz_id},
        {
            "$unset": {
                "profile_photo_url": "",
                "profile_photo_asset_id": "",
                "profile_photo_provider": "",
                "profile_photo_updated_at": "",
            },
            "$set": {"updated_at": now_iso},
        },
    )

    updated_worker = await db.workers.find_one(
        {"id": worker_id, "business_id": biz_id},
        {"_id": 0, "password_hash": 0},
    )
    return clean_worker_document(updated_worker)


@api_router.delete("/workers/{worker_id}")
async def delete_worker(worker_id: str, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    if worker.get("profile_photo_asset_id"):
        await photo_storage.delete_profile_photo(worker)

    await db.workers.delete_one({"id": worker_id, "business_id": biz_id})
    await db.worker_sessions.delete_many({"worker_id": worker_id})
    await db.attendance.delete_many({"worker_id": worker_id, "business_id": biz_id})
    await db.payments.delete_many({"worker_id": worker_id, "business_id": biz_id})
    await db.extra_work.delete_many({"worker_id": worker_id, "business_id": biz_id})
    await db.conversations.delete_many({"worker_id": worker_id, "business_id": biz_id})
    await db.messages.delete_many({"worker_id": worker_id, "business_id": biz_id})
    return {"ok": True}


# ---------------- Attendance (Admin - Business Isolated) ----------------
@api_router.post("/attendance")
async def mark_attendance(body: AttendanceMark, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    
    # Validate date is past or today in Asia/Kolkata
    try:
        validate_past_or_today(body.date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    worker = await db.workers.find_one({"id": body.worker_id, "business_id": biz_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found in your workspace")

    await db.attendance.update_one(
        {"business_id": biz_id, "worker_id": body.worker_id, "date": body.date},
        {
            "$set": {
                "status": body.status,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "business_id": biz_id,
            }
        },
        upsert=True,
    )
    return await db.attendance.find_one(
        {"business_id": biz_id, "worker_id": body.worker_id, "date": body.date},
        {"_id": 0}
    )


@api_router.get("/attendance")
async def get_attendance(
    date: Optional[str] = None,
    worker_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin),
):
    biz_id = admin["business_id"]
    q = {"business_id": biz_id}
    if date:
        q["date"] = date
    if worker_id:
        q["worker_id"] = worker_id
    return await db.attendance.find(q, {"_id": 0}).sort("date", -1).to_list(5000)


@api_router.get("/workers/{worker_id}/attendance/month")
async def get_worker_month_attendance(
    worker_id: str,
    year: int = Query(..., ge=1900, le=2100),
    month: int = Query(..., ge=1, le=12),
    admin: dict = Depends(get_current_admin),
):
    """
    Returns monthly attendance calendar data and authoritative summary for a worker.
    Strictly scoped to the authenticated admin's business.
    """
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id}, {"_id": 0, "password_hash": 0})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found in your workspace")

    prefix = f"{year:04d}-{month:02d}-"
    attendance_records = await db.attendance.find(
        {"business_id": biz_id, "worker_id": worker_id, "date": {"$regex": f"^{prefix}"}},
        {"_id": 0},
    ).to_list(100)

    result = PayrollService.calculate_worker_month_attendance(
        worker=worker,
        attendance_records=attendance_records,
        year=year,
        month=month,
        today_date_str=get_today_date(),
    )
    result["worker"] = clean_worker_document(worker)
    return result


@api_router.get("/workers/{worker_id}/salary-slip")
async def get_worker_salary_slip_pdf(
    worker_id: str,
    year: int = Query(..., ge=1900, le=2100),
    month: int = Query(..., ge=1, le=12),
    admin: dict = Depends(get_current_admin),
):
    """
    Generates and streams an authoritative Salary Slip PDF for a worker.
    Strictly scoped to the authenticated admin's business.
    """
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id}, {"_id": 0, "password_hash": 0})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found in your workspace")

    business = await db.businesses.find_one({"id": biz_id}, {"_id": 0})

    prefix = f"{year:04d}-{month:02d}-"
    m_start = f"{prefix}01"
    if month == 12:
        m_end = f"{year + 1:04d}-01-01"
    else:
        m_end = f"{year:04d}-{month + 1:02d}-01"

    attendance_records = await db.attendance.find(
        {"business_id": biz_id, "worker_id": worker_id, "date": {"$regex": f"^{prefix}"}},
        {"_id": 0},
    ).sort("date", 1).to_list(100)

    payments = await db.payments.find(
        {"business_id": biz_id, "worker_id": worker_id, "deleted_at": None, "date": {"$gte": m_start, "$lt": m_end}},
        {"_id": 0},
    ).sort("date", 1).to_list(500)

    extra_work = await db.extra_work.find(
        {"business_id": biz_id, "worker_id": worker_id, "deleted_at": None, "date": {"$gte": m_start, "$lt": m_end}},
        {"_id": 0},
    ).sort("date", 1).to_list(500)

    summary = PayrollService.calculate_worker_month_summary(
        worker=worker,
        attendance_list=attendance_records,
        payments_list=payments,
        extra_work_list=extra_work,
        date_str=m_start,
    )

    attendance_summary = PayrollService.calculate_worker_month_attendance(
        worker=worker,
        attendance_records=attendance_records,
        year=year,
        month=month,
        today_date_str=get_today_date(),
    )

    pdf_bytes = generate_salary_slip_pdf(
        worker=worker,
        business=business,
        summary=summary,
        attendance_summary=attendance_summary.get("summary", {}),
        year=year,
        month=month,
        recent_payments=payments,
    )

    month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    m_name = month_names[month - 1] if 1 <= month <= 12 else str(month)
    safe_worker_name = sanitize_filename(worker.get("name", "Worker"))
    filename = f"WorkForce_Salary_Slip_{safe_worker_name}_{m_name}_{year}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store, private",
        },
    )



# ---------------- Payments & Advances (Admin - Business Isolated) ----------------
@api_router.post("/payments")
async def create_payment(body: PaymentCreate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": body.worker_id, "business_id": biz_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found in your workspace")
    try:
        validate_past_or_today(body.date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["business_id"] = biz_id
    doc["created_by"] = admin["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = doc["created_at"]
    doc["deleted_at"] = None
    
    await db.payments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/payments")
async def list_payments(
    worker_id: Optional[str] = None,
    limit: int = 200,
    skip: int = 0,
    admin: dict = Depends(get_current_admin),
):
    biz_id = admin["business_id"]
    q = {"business_id": biz_id, "deleted_at": None}
    if worker_id:
        q["worker_id"] = worker_id
    return await db.payments.find(q, {"_id": 0}).sort("date", -1).skip(max(skip, 0)).to_list(min(max(limit, 1), 500))


@api_router.put("/payments/{payment_id}")
async def update_payment(payment_id: str, body: PaymentUpdate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    payment = await db.payments.find_one({"id": payment_id, "business_id": biz_id, "deleted_at": None})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment transaction not found")

    update_fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_fields:
        return payment

    if "date" in update_fields:
        try:
            validate_past_or_today(update_fields["date"])
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "type" in update_fields and update_fields["type"] not in {"SALARY_PAYMENT", "ADVANCE", "EXTRA_WORK_PAYMENT", "ADJUSTMENT"}:
        raise HTTPException(status_code=400, detail="Invalid transaction type")
    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_fields["updated_by"] = admin["id"]
    await db.payments.update_one({"id": payment_id, "business_id": biz_id}, {"$set": update_fields})
    return await db.payments.find_one({"id": payment_id, "business_id": biz_id}, {"_id": 0})


@api_router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    payment = await db.payments.find_one({"id": payment_id, "business_id": biz_id, "deleted_at": None})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment transaction not found")

    # Soft-delete for financial audit trail
    await db.payments.update_one(
        {"id": payment_id, "business_id": biz_id},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat(), "updated_by": admin["id"], "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"ok": True, "message": "Transaction soft-deleted"}


# ---------------- Extra Work (Admin - Business Isolated) ----------------
@api_router.post("/extra-work")
async def create_extra_work(body: ExtraWorkCreate, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": body.worker_id, "business_id": biz_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found in your workspace")
    
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["business_id"] = biz_id
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["deleted_at"] = None
    
    await db.extra_work.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/extra-work")
async def list_extra_work(
    worker_id: Optional[str] = None,
    limit: int = 200,
    skip: int = 0,
    admin: dict = Depends(get_current_admin),
):
    biz_id = admin["business_id"]
    q = {"business_id": biz_id, "deleted_at": None}
    if worker_id:
        q["worker_id"] = worker_id
    return await db.extra_work.find(q, {"_id": 0}).sort("date", -1).skip(max(skip, 0)).to_list(min(max(limit, 1), 500))


# ---------------- Summary & Dashboard Endpoints ----------------
async def calculate_summary_for_worker(worker: dict, biz_id: str, date_str: Optional[str] = None) -> dict:
    wid = worker["id"]
    att = await db.attendance.find({"business_id": biz_id, "worker_id": wid}, {"_id": 0}).to_list(5000)
    payments = await db.payments.find({"business_id": biz_id, "worker_id": wid, "deleted_at": None}, {"_id": 0}).to_list(5000)
    extra = await db.extra_work.find({"business_id": biz_id, "worker_id": wid, "deleted_at": None}, {"_id": 0}).to_list(5000)
    return PayrollService.calculate_worker_month_summary(worker, att, payments, extra, date_str=date_str)


@api_router.get("/workers/{worker_id}/summary")
async def get_worker_summary(worker_id: str, admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id}, {"_id": 0})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return await calculate_summary_for_worker(worker, biz_id)


@api_router.get("/workers/{worker_id}/details")
async def get_worker_full_details(worker_id: str, admin: dict = Depends(get_current_admin)):
    """Provides full data for Owner's Worker View display mode."""
    biz_id = admin["business_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id}, {"_id": 0})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    
    attendance = await db.attendance.find({"business_id": biz_id, "worker_id": worker_id}, {"_id": 0}).sort("date", -1).to_list(5000)
    payments = await db.payments.find({"business_id": biz_id, "worker_id": worker_id, "deleted_at": None}, {"_id": 0}).sort("date", -1).to_list(5000)
    extra = await db.extra_work.find({"business_id": biz_id, "worker_id": worker_id, "deleted_at": None}, {"_id": 0}).sort("date", -1).to_list(5000)
    summary = await calculate_summary_for_worker(worker, biz_id)
    
    # Check if worker portal is enabled
    is_connected = bool(worker.get("portal_enabled"))

    return {
        "worker": worker,
        "connected": is_connected,
        "attendance": attendance,
        "payments": payments,
        "extra_work": extra,
        "summary": summary,
    }


@api_router.get("/admin/stats")
async def admin_stats(admin: dict = Depends(get_current_admin)):
    biz_id = admin["business_id"]
    workers = await db.workers.find({"business_id": biz_id}, {"_id": 0}).to_list(1000)
    today = get_today_date()
    yesterday = get_yesterday_date()
    
    m_start, m_end, _, _ = get_month_bounds(today)
    attendance, payments, extra_works = await asyncio.gather(
        db.attendance.find({"business_id": biz_id, "date": {"$gte": m_start, "$lt": m_end}}, {"_id": 0}).to_list(50000),
        db.payments.find({"business_id": biz_id, "deleted_at": None}, {"_id": 0}).to_list(10000),
        db.extra_work.find({"business_id": biz_id, "deleted_at": None}, {"_id": 0}).to_list(10000),
    )
    att_today = [item for item in attendance if item.get("date") == today]
    month_payments = [p for p in payments if m_start <= p.get("date", "") < m_end]
    month_extra = [e for e in extra_works if m_start <= e.get("date", "") < m_end]

    total_monthly_salary = sum(float(w.get("salary", 0) or 0) for w in workers)
    
    present = sum(1 for a in att_today if a["status"] == "Present")
    half = sum(1 for a in att_today if a["status"] == "Half Day")
    absent = sum(1 for a in att_today if a["status"] == "Absent")
    marked_workers = {a["worker_id"] for a in att_today}
    not_marked = len([w for w in workers if w["id"] not in marked_workers])

    attendance_by_worker: dict[str, list[dict]] = defaultdict(list)
    payments_by_worker: dict[str, list[dict]] = defaultdict(list)
    extra_work_by_worker: dict[str, list[dict]] = defaultdict(list)
    for item in attendance:
        attendance_by_worker[item.get("worker_id", "")].append(item)
    for item in payments:
        payments_by_worker[item.get("worker_id", "")].append(item)
    for item in extra_works:
        extra_work_by_worker[item.get("worker_id", "")].append(item)

    # Reuse the canonical payroll service with batched, tenant-scoped records.
    earned_salary_month = 0.0
    for w in workers:
        s = PayrollService.calculate_worker_month_summary(
            w,
            attendance_by_worker.get(w["id"], []),
            payments_by_worker.get(w["id"], []),
            extra_work_by_worker.get(w["id"], []),
            date_str=today,
        )
        earned_salary_month += s["earned_salary"]

    salary_paid_month = sum(float(p.get("amount", 0)) for p in month_payments if p.get("type", "SALARY_PAYMENT") == "SALARY_PAYMENT")
    advances_month = sum(float(p.get("amount", 0)) for p in month_payments if p.get("type") == "ADVANCE")
    extra_work_paid_month = sum(float(p.get("amount", 0)) for p in month_payments if p.get("type") == "EXTRA_WORK_PAYMENT")
    adjustments_month = sum(float(p.get("amount", 0)) for p in month_payments if p.get("type") == "ADJUSTMENT")
    total_paid_month = salary_paid_month + advances_month + extra_work_paid_month + adjustments_month
    extra_earned_month = sum(float(e.get("amount", 0)) for e in month_extra)
    gross_earned_month = earned_salary_month + extra_earned_month
    remaining_payable = max(0.0, gross_earned_month - total_paid_month)
    today_payments = sum(float(p.get("amount", 0) or 0) for p in month_payments if p.get("date") == today)

    month_trend = {}
    for item in attendance:
        day = item.get("date")
        if not day:
            continue
        point = month_trend.setdefault(day, {"date": day, "present": 0, "absent": 0, "half_day": 0})
        if item.get("status") == "Present":
            point["present"] += 1
        elif item.get("status") == "Absent":
            point["absent"] += 1
        elif item.get("status") == "Half Day":
            point["half_day"] += 1

    worker_names = {worker["id"]: worker.get("name", "Worker") for worker in workers}
    activity = []
    for item in att_today:
        activity.append({
            "kind": "attendance", "worker_name": worker_names.get(item.get("worker_id"), "Worker"),
            "status": item.get("status"), "date": item.get("date"), "time": item.get("updated_at") or item.get("date"),
        })
    for item in month_payments:
        activity.append({
            "kind": "payment", "worker_name": worker_names.get(item.get("worker_id"), "Worker"),
            "amount": float(item.get("amount", 0) or 0), "payment_type": item.get("type", "SALARY_PAYMENT"),
            "date": item.get("date"), "time": item.get("updated_at") or item.get("created_at") or item.get("date"),
        })
    for item in month_extra:
        activity.append({
            "kind": "extra_work", "worker_name": worker_names.get(item.get("worker_id"), "Worker"),
            "amount": float(item.get("amount", 0) or 0), "description": item.get("description", "Extra work"),
            "date": item.get("date"), "time": item.get("created_at") or item.get("date"),
        })
    activity.sort(key=lambda item: item.get("time") or "", reverse=True)

    return {
        "total_workers": len(workers),
        "present_today": present,
        "half_day_today": half,
        "absent_today": absent,
        "not_marked_today": not_marked,
        "today_date": today,
        "yesterday_date": yesterday,
        "total_monthly_salary": total_monthly_salary,
        "earned_salary_month": round(earned_salary_month, 2),
        "gross_earned_month": round(gross_earned_month, 2),
        "paid_this_month": round(salary_paid_month, 2),
        "advances_this_month": round(advances_month, 2),
        "adjustments_this_month": round(adjustments_month, 2),
        "total_paid_month": round(total_paid_month, 2),
        "remaining_this_month": round(remaining_payable, 2),
        "remaining_payable": round(remaining_payable, 2),
        "today_payments": round(today_payments, 2),
        "payment_count_this_month": len(month_payments),
        "extra_work_paid_this_month": round(extra_work_paid_month, 2),
        "attendance_rate": round(((present + (half * 0.5)) / len(workers) * 100) if workers else 0, 1),
        "monthly_attendance": [month_trend[key] for key in sorted(month_trend)],
        "recent_activity": activity[:8],
    }


# ---------------- Worker Self Endpoints ----------------
@api_router.get("/worker/me/data")
async def worker_self_data(user: dict = Depends(get_current_worker)):
    worker = await db.workers.find_one({"id": user["worker_id"], "business_id": user["business_id"]}, {"_id": 0})
    if not worker:
        raise HTTPException(
            status_code=404,
            detail="No worker profile linked to your account. Ask your employer / admin to enable portal access."
        )
    
    biz_id = worker.get("business_id")
    wid = worker["id"]
    
    attendance = await db.attendance.find({"business_id": biz_id, "worker_id": wid}, {"_id": 0}).sort("date", -1).to_list(500)
    payments = await db.payments.find({"business_id": biz_id, "worker_id": wid, "deleted_at": None}, {"_id": 0}).sort("date", -1).to_list(500)
    extra = await db.extra_work.find({"business_id": biz_id, "worker_id": wid, "deleted_at": None}, {"_id": 0}).sort("date", -1).to_list(500)
    
    summary = PayrollService.calculate_worker_month_summary(worker, attendance, payments, extra)
    
    # Get business name if available
    business = None
    if biz_id:
        business = await db.businesses.find_one({"id": biz_id}, {"_id": 0})

    return {
        "worker": worker,
        "business": business,
        "attendance": attendance,
        "payments": payments,
        "extra_work": extra,
        "summary": summary,
    }


@api_router.get("/worker/me/attendance/month")
async def get_worker_self_month_attendance(
    year: int = Query(..., ge=1900, le=2100),
    month: int = Query(..., ge=1, le=12),
    user: dict = Depends(get_current_worker),
):
    """
    Returns monthly attendance calendar data for the authenticated worker.
    Identity and business isolation are derived strictly from the session.
    """
    biz_id = user["business_id"]
    worker_id = user["worker_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id}, {"_id": 0, "password_hash": 0})
    if not worker:
        raise HTTPException(
            status_code=404,
            detail="No worker profile linked to your account. Ask your employer / admin to enable portal access."
        )

    prefix = f"{year:04d}-{month:02d}-"
    attendance_records = await db.attendance.find(
        {"business_id": biz_id, "worker_id": worker_id, "date": {"$regex": f"^{prefix}"}},
        {"_id": 0},
    ).to_list(100)

    result = PayrollService.calculate_worker_month_attendance(
        worker=worker,
        attendance_records=attendance_records,
        year=year,
        month=month,
        today_date_str=get_today_date(),
    )
    result["worker"] = clean_worker_document(worker)
    return result


@api_router.get("/worker/me/salary-slip")
async def get_worker_self_salary_slip_pdf(
    year: int = Query(..., ge=1900, le=2100),
    month: int = Query(..., ge=1, le=12),
    user: dict = Depends(get_current_worker),
):
    """
    Generates and streams an authoritative Salary Slip PDF for the authenticated worker.
    Worker identity and business scoping are derived strictly from the verified session.
    """
    biz_id = user["business_id"]
    worker_id = user["worker_id"]
    worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id}, {"_id": 0, "password_hash": 0})
    if not worker:
        raise HTTPException(
            status_code=404,
            detail="No worker profile linked to your account. Ask your employer / admin to enable portal access."
        )

    business = await db.businesses.find_one({"id": biz_id}, {"_id": 0})

    prefix = f"{year:04d}-{month:02d}-"
    m_start = f"{prefix}01"
    if month == 12:
        m_end = f"{year + 1:04d}-01-01"
    else:
        m_end = f"{year:04d}-{month + 1:02d}-01"

    attendance_records = await db.attendance.find(
        {"business_id": biz_id, "worker_id": worker_id, "date": {"$regex": f"^{prefix}"}},
        {"_id": 0},
    ).sort("date", 1).to_list(100)

    payments = await db.payments.find(
        {"business_id": biz_id, "worker_id": worker_id, "deleted_at": None, "date": {"$gte": m_start, "$lt": m_end}},
        {"_id": 0},
    ).sort("date", 1).to_list(500)

    extra_work = await db.extra_work.find(
        {"business_id": biz_id, "worker_id": worker_id, "deleted_at": None, "date": {"$gte": m_start, "$lt": m_end}},
        {"_id": 0},
    ).sort("date", 1).to_list(500)

    summary = PayrollService.calculate_worker_month_summary(
        worker=worker,
        attendance_list=attendance_records,
        payments_list=payments,
        extra_work_list=extra_work,
        date_str=m_start,
    )

    attendance_summary = PayrollService.calculate_worker_month_attendance(
        worker=worker,
        attendance_records=attendance_records,
        year=year,
        month=month,
        today_date_str=get_today_date(),
    )

    pdf_bytes = generate_salary_slip_pdf(
        worker=worker,
        business=business,
        summary=summary,
        attendance_summary=attendance_summary.get("summary", {}),
        year=year,
        month=month,
        recent_payments=payments,
    )

    month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    m_name = month_names[month - 1] if 1 <= month <= 12 else str(month)
    safe_worker_name = sanitize_filename(worker.get("name", "Worker"))
    filename = f"WorkForce_Salary_Slip_{safe_worker_name}_{m_name}_{year}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store, private",
        },
    )




# ---------------- Owner ↔ Worker Chat Endpoints ----------------
@api_router.get("/push/public-key")
async def push_public_key():
    """Exposes only the VAPID public key; the private key never leaves the server."""
    return {"public_key": push.public_key()}


@api_router.post("/push/subscribe")
async def subscribe_to_push(body: PushSubscriptionCreate, request: Request):
    """Store a subscription for the authenticated principal only."""
    try:
        actor = await get_current_admin(request)
        recipient_type, recipient_id = "admin", actor["id"]
    except Exception:
        try:
            actor = await get_current_worker(request)
            recipient_type, recipient_id = "worker", actor["worker_id"]
        except Exception:
            raise HTTPException(status_code=401, detail="Not authenticated")
    await db.push_subscriptions.update_one(
        {"endpoint": body.endpoint},
        {"$set": {
            "endpoint": body.endpoint, "keys": body.keys, "business_id": actor["business_id"],
            "recipient_type": recipient_type, "recipient_id": recipient_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True}


async def deliver_chat_push(*, business_id: str, worker_id: str, sender_type: str,
                            conversation_id: str, preview: str) -> None:
    """Deliver best-effort push only to the server-selected other participant."""
    if not push.configured():
        return
    if sender_type == "owner":
        worker = await db.workers.find_one({"id": worker_id, "business_id": business_id}, {"_id": 0, "status": 1})
        if not worker or worker.get("status", "ACTIVE") == "INACTIVE":
            return
        query = {"business_id": business_id, "recipient_type": "worker", "recipient_id": worker_id}
        unread_query = {"business_id": business_id, "worker_id": worker_id, "sender_type": "owner", "read_at": None}
        url = f"/worker?conversation={conversation_id}"
        title = "WorkForce: नया संदेश / New message"
    else:
        query = {"business_id": business_id, "recipient_type": "admin"}
        unread_query = {"business_id": business_id, "sender_type": "worker", "read_at": None}
        url = f"/admin?conversation={conversation_id}"
        title = "WorkForce: Worker message"
    subscriptions = await db.push_subscriptions.find(query, {"_id": 0}).to_list(100)
    unread_count = await db.messages.count_documents(unread_query)
    payload = {
        "title": title, "body": preview[:160], "url": url,
        "conversation_id": conversation_id, "unread_count": unread_count,
    }
    for subscription in subscriptions:
        await push.send(subscription, payload)


@api_router.get("/chat/conversations")
async def list_admin_conversations(admin: dict = Depends(get_current_admin)):
    """Returns conversation list for all workers in the admin's business."""
    biz_id = admin["business_id"]
    workers = await db.workers.find({"business_id": biz_id}, {"_id": 0}).to_list(1000)
    
    results = []
    for w in workers:
        wid = w["id"]
        conv = await db.conversations.find_one({"business_id": biz_id, "worker_id": wid}, {"_id": 0})
        if not conv:
            conv_id = str(uuid.uuid4())
            conv_doc = {
                "id": conv_id,
                "business_id": biz_id,
                "worker_id": wid,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "last_message": None,
            }
            await db.conversations.insert_one(conv_doc)
            conv = conv_doc

        # Calculate unread count from worker to owner
        unread_count = await db.messages.count_documents({
            "conversation_id": conv["id"],
            "sender_type": "worker",
            "read_at": None,
        })

        results.append({
            "conversation_id": conv["id"],
            "worker": w,
            "unread_count": unread_count,
            "last_message": conv.get("last_message"),
            "updated_at": conv.get("updated_at", ""),
        })

    # Sort by most recent updated_at
    results.sort(key=lambda x: x.get("updated_at", "") or "", reverse=True)
    return results


@api_router.get("/chat/worker-conversation")
async def get_worker_conversation(user: dict = Depends(get_current_worker)):
    """Returns or creates the private conversation for the current logged-in worker."""
    worker = await db.workers.find_one({"id": user["worker_id"], "business_id": user["business_id"]}, {"_id": 0})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker profile not linked.")

    biz_id = worker.get("business_id")
    wid = worker["id"]
    
    conv = await db.conversations.find_one({"business_id": biz_id, "worker_id": wid}, {"_id": 0})
    if not conv:
        conv_id = str(uuid.uuid4())
        conv_doc = {
            "id": conv_id,
            "business_id": biz_id,
            "worker_id": wid,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "last_message": None,
        }
        await db.conversations.insert_one(conv_doc)
        conv = conv_doc

    unread_count = await db.messages.count_documents({
        "conversation_id": conv["id"],
        "sender_type": "owner",
        "read_at": None,
    })

    return {
        "conversation_id": conv["id"],
        "worker": worker,
        "unread_count": unread_count,
        "last_message": conv.get("last_message"),
    }


async def resolve_conversation_actor(conversation_id: str, request: Request):
    """Resolve and tenant-check the current chat actor and conversation."""
    is_admin = False
    is_worker = False
    auth_user = None

    try:
        auth_user = await get_current_admin(request)
        is_admin = True
    except Exception:
        try:
            auth_user = await get_current_worker(request)
            is_worker = True
        except Exception:
            raise HTTPException(status_code=401, detail="Not authenticated")

    conv = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if is_admin and conv.get("business_id") != auth_user["business_id"]:
        raise HTTPException(status_code=403, detail="Unauthorized")

    if is_worker:
        if conv.get("worker_id") != auth_user["worker_id"] or conv.get("business_id") != auth_user["business_id"]:
            raise HTTPException(status_code=403, detail="Unauthorized")

    return is_admin, is_worker, auth_user, conv


async def persist_conversation_read(conversation_id: str, is_admin: bool, conv: dict):
    """Persist incoming-message read state and return authoritative unread totals."""
    incoming_sender = "worker" if is_admin else "owner"
    unread_query = {
        "conversation_id": conversation_id,
        "business_id": conv["business_id"],
        "worker_id": conv["worker_id"],
        "sender_type": incoming_sender,
        "read_at": None,
    }
    first_unread = await db.messages.find_one(
        unread_query,
        {"_id": 0, "id": 1},
        sort=[("created_at", ASCENDING)],
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.messages.update_many(
        unread_query,
        {"$set": {"read_at": now_iso}},
    )

    total_query = {
        "business_id": conv["business_id"],
        "sender_type": incoming_sender,
        "read_at": None,
    }
    if not is_admin:
        total_query["worker_id"] = conv["worker_id"]

    unread_count = await db.messages.count_documents(unread_query)
    total_unread_count = await db.messages.count_documents(total_query)
    return {
        "conversation_id": conversation_id,
        "marked_read": result.modified_count,
        "read_at": now_iso,
        "first_unread_message_id": first_unread.get("id") if first_unread else None,
        "unread_count": unread_count,
        "total_unread_count": total_unread_count,
    }


async def migrate_message_expirations() -> int:
    """Backfill creation-based expiry for old messages without touching unrelated data."""
    migrated = 0
    cursor = db.messages.find(
        {"created_at": {"$nin": [None, ""]}, "expires_at": {"$exists": False}},
        {"_id": 1, "id": 1, "business_id": 1, "conversation_id": 1, "audio_asset_id": 1, "created_at": 1},
    )
    async for message in cursor:
        expires_at = message_expiry_from_created_at(message.get("created_at"))
        if not expires_at:
            logger.warning("Skipping message with invalid created_at during expiry migration id=%s", message.get("id"))
            continue
        selector = {"_id": message["_id"]} if message.get("_id") is not None else {
            "id": message.get("id"),
            "business_id": message.get("business_id"),
            "conversation_id": message.get("conversation_id"),
        }
        result = await db.messages.update_one(
            {**selector, "expires_at": {"$exists": False}},
            {"$set": {"expires_at": expires_at}},
        )
        migrated += result.modified_count
        if result.modified_count and message.get("audio_asset_id"):
            await db.voice_assets.update_one(
                {
                    "id": message["audio_asset_id"],
                    "business_id": message.get("business_id"),
                    "conversation_id": message.get("conversation_id"),
                },
                {"$set": {"expires_at": expires_at}},
            )
    return migrated


async def cleanup_expired_voice_assets() -> int:
    """Delete expired private voice binaries and their scoped metadata."""
    removed = 0
    cursor = db.voice_assets.find(
        {"expires_at": {"$lte": datetime.now(timezone.utc)}},
        {"_id": 0},
    )
    async for asset in cursor:
        try:
            await voice_storage.delete_voice_message(asset)
            result = await db.voice_assets.delete_one({
                "id": asset.get("id"),
                "business_id": asset.get("business_id"),
                "conversation_id": asset.get("conversation_id"),
                "expires_at": asset.get("expires_at"),
            })
            removed += result.deleted_count
        except Exception:
            logger.exception("Expired voice asset cleanup failed id=%s", asset.get("id"))
    return removed


async def voice_expiration_loop() -> None:
    while True:
        await asyncio.sleep(30)
        await cleanup_expired_voice_assets()


@api_router.post("/chat/conversations/{conversation_id}/read")
async def mark_conversation_read(conversation_id: str, request: Request):
    """Mark only incoming messages read and return persisted backend unread totals."""
    is_admin, _, _, conv = await resolve_conversation_actor(conversation_id, request)
    return await persist_conversation_read(conversation_id, is_admin, conv)


@api_router.get("/chat/conversations/{conversation_id}/messages")
async def get_messages(conversation_id: str, request: Request, limit: int = 50, before: Optional[str] = None):
    """Loads message history; legacy callers also mark incoming messages as read."""
    is_admin, _, _, conv = await resolve_conversation_actor(conversation_id, request)

    await persist_conversation_read(conversation_id, is_admin, conv)

    q = {
        "conversation_id": conversation_id,
        "business_id": conv["business_id"],
        "worker_id": conv["worker_id"],
        **visible_message_filter(),
    }
    if before:
        q["created_at"] = {"$lt": before}
    messages = await db.messages.find(q, {"_id": 0}).sort("created_at", -1).to_list(min(max(limit, 1), 100))
    messages.reverse()
    for message in messages:
        if message.get("message_type") == "audio":
            message["audio_url"] = f"/api/chat/audio/{message['id']}"
    return messages


@api_router.post("/chat/messages")
async def send_message(body: MessageCreate, request: Request):
    """Sends a text or audio chat message."""
    is_admin = False
    is_worker = False
    auth_user = None

    try:
        auth_user = await get_current_admin(request)
        is_admin = True
    except Exception:
        try:
            auth_user = await get_current_worker(request)
            is_worker = True
        except Exception:
            raise HTTPException(status_code=401, detail="Not authenticated")

    rate_limit(request, "chat-message", 60, 60)
    conv_id = body.conversation_id
    worker_id = body.worker_id

    if not conv_id:
        if not worker_id:
            raise HTTPException(status_code=400, detail="conversation_id or worker_id required")
        
        if is_worker and worker_id != auth_user["worker_id"]:
            raise HTTPException(status_code=404, detail="Conversation not found")
        biz_id = auth_user["business_id"]
        owned_worker = await db.workers.find_one({"id": worker_id, "business_id": biz_id})
        if not owned_worker:
            raise HTTPException(status_code=404, detail="Worker not found")
        conv = await db.conversations.find_one({"business_id": biz_id, "worker_id": worker_id})
        if not conv:
            conv_id = str(uuid.uuid4())
            await db.conversations.insert_one({
                "id": conv_id,
                "business_id": biz_id,
                "worker_id": worker_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "last_message": None,
            })
        else:
            conv_id = conv["id"]
    else:
        conv = await db.conversations.find_one({"id": conv_id})
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        worker_id = conv["worker_id"]
        biz_id = conv.get("business_id")

    if is_admin and biz_id != auth_user["business_id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if is_worker and (biz_id != auth_user["business_id"] or worker_id != auth_user["worker_id"]):
        raise HTTPException(status_code=404, detail="Conversation not found")
    if body.message_type not in {"text", "audio"}:
        raise HTTPException(status_code=400, detail="Invalid message type")
    if body.message_type == "text" and not (body.text or "").strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    audio_asset = None
    if body.message_type == "audio":
        if not body.audio_asset_id:
            raise HTTPException(status_code=400, detail="Audio asset is required")
        audio_asset = await db.voice_assets.find_one({
            "id": body.audio_asset_id, "business_id": biz_id, "worker_id": worker_id,
            "conversation_id": conv_id, "uploaded_by": auth_user["id"] if is_admin else auth_user["user_id"],
            "message_id": None,
        }, {"_id": 0})
        if not audio_asset:
            raise HTTPException(status_code=404, detail="Audio asset not found")

    if is_admin:
        sender_type = "owner"
        sender_id = auth_user["id"]
    else:
        sender_type = "worker"
        sender_id = auth_user["user_id"]

    msg_id = str(uuid.uuid4())
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    expires_at = now_dt + MESSAGE_RETENTION

    msg_doc = {
        "id": msg_id,
        "business_id": biz_id,
        "conversation_id": conv_id,
        "worker_id": worker_id,
        "sender_type": sender_type,
        "sender_id": sender_id,
        "message_type": body.message_type,
        "text": (body.text or "").strip(),
        "audio_asset_id": body.audio_asset_id,
        "duration": (audio_asset or {}).get("duration") or body.duration or 0.0,
        "created_at": now_iso,
        "read_at": None,
        "expires_at": expires_at,
    }

    await db.messages.insert_one(msg_doc)
    if audio_asset:
        await db.voice_assets.update_one(
            {"id": audio_asset["id"], "message_id": None},
            {"$set": {"message_id": msg_id, "expires_at": expires_at}},
        )

    # Update conversation's last message
    preview = body.text if body.message_type == "text" else "🎤 Audio Message / आवाज़ संदेश"
    await db.conversations.update_one(
        {"id": conv_id},
        {
            "$set": {
                "updated_at": now_iso,
                "last_message": {
                    "text": preview,
                    "sender_type": sender_type,
                    "created_at": now_iso,
                }
            }
        }
    )

    # Notification delivery is deliberately detached from the successful chat write.
    asyncio.create_task(deliver_chat_push(
        business_id=biz_id, worker_id=worker_id, sender_type=sender_type,
        conversation_id=conv_id, preview=preview,
    ))

    msg_doc.pop("_id", None)
    return msg_doc


@api_router.post("/chat/upload-audio")
async def upload_audio(conversation_id: str = Form(...), file: UploadFile = File(...), request: Request = None):
    """Uploads an audio recording for chat."""
    # Verify auth
    is_admin = False
    try:
        actor = await get_current_admin(request)
        is_admin = True
    except Exception:
        try:
            actor = await get_current_worker(request)
        except Exception:
            raise HTTPException(status_code=401, detail="Not authenticated")
    rate_limit(request, "chat-audio", 20, 60)
    conv = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not conv or (is_admin and conv.get("business_id") != actor["business_id"]) or (
        not is_admin and (conv.get("business_id") != actor["business_id"] or conv.get("worker_id") != actor["worker_id"])
    ):
        raise HTTPException(status_code=404, detail="Conversation not found")
    metadata = await voice_storage.upload_voice_message(file)
    asset_id = str(uuid.uuid4())
    asset = {
        "id": asset_id, "business_id": conv["business_id"], "worker_id": conv["worker_id"],
        "conversation_id": conversation_id, "uploaded_by": actor["id"] if is_admin else actor["user_id"],
        "message_id": None, "created_at": datetime.now(timezone.utc).isoformat(), **metadata,
    }
    await db.voice_assets.insert_one(asset)
    return {"audio_asset_id": asset_id, "duration": metadata.get("duration", 0)}


@api_router.get("/chat/audio/{message_id}")
async def get_audio_file(message_id: str, request: Request):
    try:
        actor, is_admin = await get_current_admin(request), True
    except Exception:
        try:
            actor, is_admin = await get_current_worker(request), False
        except Exception:
            raise HTTPException(status_code=401, detail="Not authenticated")
    message = await db.messages.find_one(
        {"id": message_id, "message_type": "audio", **visible_message_filter()},
        {"_id": 0},
    )
    if not message or (is_admin and message.get("business_id") != actor["business_id"]) or (
        not is_admin and (message.get("business_id") != actor["business_id"] or message.get("worker_id") != actor["worker_id"])
    ):
        raise HTTPException(status_code=404, detail="Audio message not found")
    asset = await db.voice_assets.find_one({"id": message.get("audio_asset_id"), "message_id": message_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Audio message not found")
    target = voice_storage.get_voice_message_url(asset)
    if isinstance(target, Path):
        return FileResponse(target, media_type=asset.get("mime_type", "audio/webm"))
    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as http:
        upstream = await http.get(target)
    if upstream.status_code != 200:
        raise HTTPException(status_code=502, detail="Audio storage is temporarily unavailable")
    return Response(content=upstream.content, media_type=asset.get("mime_type", "audio/webm"),
                    headers={"Cache-Control": "private, no-store"})


# ---------------- Base & Health ----------------
@api_router.get("/")
async def root():
    return {
        "message": "WorkForce Management API",
        "timezone": BUSINESS_TIMEZONE_NAME,
        "status": "healthy",
    }


@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.get("/ready")
async def ready():
    try:
        await db.command("ping")
    except Exception as exc:
        logger.error("Readiness dependency check failed", exc_info=exc)
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ready"}


app.include_router(api_router)


@app.middleware("http")
async def production_security(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", "")[:100] or str(uuid.uuid4())
    started = time.monotonic()
    try:
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path not in {
            "/api/admin/signup", "/api/admin/login", "/api/admin/forgot-password",
            "/api/admin/reset-password", "/api/worker/login"
        } and (request.cookies.get("access_token") or request.cookies.get("session_token")):
            cookie_token = request.cookies.get("csrf_token")
            header_token = request.headers.get("X-CSRF-Token")
            if not cookie_token or not header_token or not secrets.compare_digest(cookie_token, header_token):
                return JSONResponse({"detail": "CSRF validation failed", "request_id": request_id}, status_code=403)
        response = await call_next(request)
    except Exception as exc:
        logger.exception("Unhandled request error request_id=%s", request_id)
        response = JSONResponse({"detail": "Internal server error", "request_id": request_id}, status_code=500)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(self)"
    logger.info("request_id=%s method=%s path=%s status=%s duration_ms=%d", request_id, request.method,
                request.url.path, response.status_code, (time.monotonic() - started) * 1000)
    return response

_cors_origins = os.environ.get('CORS_ORIGINS', '*')
if _cors_origins.strip() == '*':
    _allow_origins = ["*"]
else:
    _allow_origins = [o.strip() for o in _cors_origins.split(',') if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_origins != ["*"],
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    global _voice_expiration_task
    validate_environment()
    logger.info("Initializing database indexes and migrations...")
    try:
        await db.command("ping")
    except Exception as exc:
        logger.error("MongoDB is unavailable; backend startup aborted")
        raise RuntimeError("MongoDB is unavailable. Check MONGO_URL and database network access.") from exc

    # Backfill only chat-message expiry state before enabling TTL. Every message
    # expires from its creation time, whether it was read or not.
    migrated_messages = await migrate_message_expirations()
    removed_voice_assets = await cleanup_expired_voice_assets()
    if migrated_messages or removed_voice_assets:
        logger.info(
            "Message expiration migration completed migrated=%d voice_assets_removed=%d",
            migrated_messages,
            removed_voice_assets,
        )

    # These indexes are required for the retention guarantee. Fail startup rather
    # than silently run without expiry or with an unindexed cleanup scan.
    await db.messages.create_index("expires_at", expireAfterSeconds=0, name="messages_expires_at_ttl")
    await db.voice_assets.create_index("expires_at", name="voice_assets_expiration_cleanup")
    
    # 1. Ensure safe MongoDB indexes
    try:
        await db.admins.create_index("username", unique=True, sparse=True)
        await db.admins.create_index("email", unique=True, sparse=True)
        await db.businesses.create_index("owner_admin_id")
        await db.workers.create_index([("business_id", ASCENDING), ("mobile", ASCENDING)], unique=True,
                                      partialFilterExpression={"mobile": {"$type": "string", "$gt": ""}})
        await db.workers.create_index([("business_id", ASCENDING), ("email", ASCENDING)], unique=True,
                                      partialFilterExpression={"email": {"$type": "string", "$gt": ""}})
        await db.workers.create_index([("business_id", ASCENDING), ("login_id", ASCENDING)], unique=True,
                                      partialFilterExpression={"login_id": {"$type": "string", "$gt": ""}})
        await db.work_types.create_index([("business_id", ASCENDING), ("normalized_name", ASCENDING)], unique=True)
        await db.work_types.create_index([("business_id", ASCENDING), ("is_active", ASCENDING), ("name", ASCENDING)])
        await db.attendance.create_index([("business_id", ASCENDING), ("worker_id", ASCENDING), ("date", ASCENDING)], unique=True)
        await db.payments.create_index([("business_id", ASCENDING), ("worker_id", ASCENDING), ("date", ASCENDING)])
        await db.extra_work.create_index([("business_id", ASCENDING), ("worker_id", ASCENDING), ("date", ASCENDING)])
        await db.conversations.create_index([("business_id", ASCENDING), ("worker_id", ASCENDING)], unique=True)
        await db.messages.create_index([("conversation_id", ASCENDING), ("created_at", ASCENDING)])
        await db.messages.create_index([("business_id", ASCENDING), ("worker_id", ASCENDING)])
        await db.worker_sessions.create_index("session_token", unique=True)
        await db.worker_sessions.create_index("worker_id")
        await db.password_reset_tokens.create_index("token_hash", unique=True)
        await db.password_reset_tokens.create_index("expires_at")
        await db.voice_assets.create_index([("business_id", ASCENDING), ("conversation_id", ASCENDING)])
        await db.push_subscriptions.create_index("endpoint", unique=True)
        await db.push_subscriptions.create_index([("business_id", ASCENDING), ("recipient_type", ASCENDING), ("recipient_id", ASCENDING)])
        await db.revoked_admin_tokens.create_index("token_hash", unique=True)
        await db.revoked_admin_tokens.create_index("expires_at", expireAfterSeconds=0)
        logger.info("Database indexes successfully verified.")
    except Exception as e:
        logger.warning(f"Index creation notice: {e}")

    # 2. Backward-compatibility data migration: backfill records created before
    #    multi-business support. Any records missing a business_id are assigned
    #    to the first admin's primary business if one exists. This is a no-op
    #    when all records already have a business_id.
    try:
        orphan_worker = await db.workers.find_one(
            {"$or": [{"business_id": {"$exists": False}}, {"business_id": None}, {"business_id": ""}]},
            {"_id": 0}
        )
        if orphan_worker:
            # Find the oldest admin to use as the reference owner for orphaned records
            ref_admin = await db.admins.find_one({}, sort=[("created_at", ASCENDING)])
            if ref_admin:
                primary_biz = await get_or_create_business_for_admin(ref_admin)
                primary_biz_id = primary_biz["id"]

                workers_bf = await db.workers.update_many(
                    {"$or": [{"business_id": {"$exists": False}}, {"business_id": None}, {"business_id": ""}]},
                    {"$set": {"business_id": primary_biz_id}}
                )
                if workers_bf.modified_count > 0:
                    logger.info(f"Backfilled {workers_bf.modified_count} workers to business {primary_biz_id}")

                att_bf = await db.attendance.update_many(
                    {"$or": [{"business_id": {"$exists": False}}, {"business_id": None}, {"business_id": ""}]},
                    {"$set": {"business_id": primary_biz_id}}
                )
                if att_bf.modified_count > 0:
                    logger.info(f"Backfilled {att_bf.modified_count} attendance records to business {primary_biz_id}")

                pay_bf = await db.payments.update_many(
                    {"$or": [{"business_id": {"$exists": False}}, {"business_id": None}, {"business_id": ""}]},
                    {"$set": {"business_id": primary_biz_id, "type": "SALARY_PAYMENT", "deleted_at": None}}
                )
                if pay_bf.modified_count > 0:
                    logger.info(f"Backfilled {pay_bf.modified_count} payment records to business {primary_biz_id}")

                extra_bf = await db.extra_work.update_many(
                    {"$or": [{"business_id": {"$exists": False}}, {"business_id": None}, {"business_id": ""}]},
                    {"$set": {"business_id": primary_biz_id, "deleted_at": None}}
                )
                if extra_bf.modified_count > 0:
                    logger.info(f"Backfilled {extra_bf.modified_count} extra-work records to business {primary_biz_id}")
    except Exception as e:
        logger.warning(f"Backfill migration notice: {e}")

    _voice_expiration_task = asyncio.create_task(voice_expiration_loop())


@app.on_event("shutdown")
async def shutdown_db_client():
    if _voice_expiration_task:
        _voice_expiration_task.cancel()
        try:
            await _voice_expiration_task
        except asyncio.CancelledError:
            pass
    client.close()
