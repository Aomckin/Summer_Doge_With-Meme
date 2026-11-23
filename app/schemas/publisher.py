from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import UUID4, AnyHttpUrl, BaseModel, BeforeValidator, ConfigDict, Field


def utc_datetime(value: datetime) -> datetime:
    # SQLite does not preserve the timezone marker on a persisted datetime.
    return value.replace(tzinfo=UTC) if isinstance(value, datetime) and value.tzinfo is None else value


UtcDatetime = Annotated[datetime, BeforeValidator(utc_datetime)]

ProtocolVersion = Literal["1"]
Action = Literal["export", "prepare", "dry_run", "remote_draft", "publish"]
ResultStatus = Literal["prepared", "remote_draft", "published", "failed", "unknown"]
AttemptStatus = Literal["queued", "running"] | ResultStatus


class PostItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID4
    meme_id: int = Field(gt=0)
    meme_image_id: int = Field(gt=0)
    caption: str = Field(default="", max_length=12000)


class PostContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=255)
    intro_text: str = Field(default="", max_length=50000)
    outro_text: str = Field(default="", max_length=50000)
    items: list[PostItemInput] = Field(default_factory=list, max_length=500)


class PostUpdate(PostContent):
    revision: int = Field(gt=0)


class ItemAppend(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[PostItemInput] = Field(min_length=1, max_length=500)


class PostSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: Literal["draft"] = "draft"
    revision: int
    created_at: UtcDatetime
    updated_at: UtcDatetime


class PostItemResponse(PostItemInput):
    position: int
    meme_title: str | None = None
    image_url: str | None = None
    thumbnail_url: str | None = None


class PostResponse(PostSummary):
    intro_text: str
    outro_text: str
    items: list[PostItemResponse]


PluginId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,79}$")]
Capability = Literal["image_text", "multiple_images", "gif", "prepare", "remote_draft", "publish",
                     "external_url", "preview", "dry_run"]


class PublisherLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_images: int | None = Field(default=None, ge=1)
    max_image_bytes: int | None = Field(default=None, ge=1)
    max_package_bytes: int | None = Field(default=None, ge=1)


class PublisherManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plugin_id: PluginId
    name: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=80)
    protocol_version: ProtocolVersion
    supported_content_types: list[Literal["image_text"]] = Field(max_length=1)
    capabilities: list[Capability] = Field(max_length=9)
    limits: PublisherLimits
    execution_mode: Literal["local_process"]


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID4
    revision: int = Field(gt=0)
    action: Action
    plugin_id: PluginId | None = None
    retry_of: UUID4 | None = None


class PackageItem(BaseModel):
    position: int
    meme_id: int
    meme_image_id: int
    caption: str
    asset: str
    mime_type: str
    size: int
    width: int
    height: int
    sha256: str


class PublishPackage(BaseModel):
    protocol_version: ProtocolVersion = "1"
    request_id: UUID4
    post_id: int
    revision: int
    content_type: Literal["image_text"] = "image_text"
    title: str
    intro_text: str
    outro_text: str
    items: list[PackageItem]


class PluginResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attempt_id: UUID4
    plugin_id: PluginId
    status: ResultStatus
    external_post_id: str | None = Field(default=None, max_length=500)
    external_url: AnyHttpUrl | None = Field(default=None, max_length=2000)
    error_code: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,79}$")
    error_message: str | None = Field(default=None, max_length=500)
    started_at: UtcDatetime | None = None
    finished_at: UtcDatetime | None = None


class AttemptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID4
    post_id: int
    revision: int
    plugin_id: PluginId | None
    plugin_version: str | None
    action: Action
    retry_of: UUID4 | None
    status: AttemptStatus
    external_post_id: str | None
    external_url: str | None
    error_code: str | None
    error_message: str | None
    created_at: UtcDatetime
    started_at: UtcDatetime | None
    finished_at: UtcDatetime | None
    download_url: str | None = None


PublisherLoginStatus = Literal["waiting", "succeeded", "expired", "failed"]


class PublisherLogin(BaseModel):
    id: UUID4
    status: PublisherLoginStatus
    qr_png: str | None = None
    message: str | None = None


class PublisherInfo(PublisherManifest):
    enabled: bool
    available: bool
    recent_attempt: AttemptResponse | None = None
    qr_session_saved: bool | None = None
