"""Projects and the objects they investigate.

One investigation can cover several physical objects. These endpoints are additive: nothing
existing sends a project id, and omitting one still resolves to the project all current data
belongs to, so the frontend can adopt them at its own pace.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from ..core.data.projects import DEFAULT_OBJECT_TYPE, ensure_default_project
from ..db.database import get_db
from ..db.models import Object, Project
from ..services.dataset_store import invalidate_registry_cache

router = APIRouter()


class ProjectMeta(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: uuid.UUID
    storage_root: str
    created_at: datetime
    # Dublin Core: the subset that applies at project level.
    dc_title: str
    dc_creator: str | None = None
    dc_contributor: str | None = None
    dc_date: str | None = None
    dc_rights: str | None = None
    dc_description: str | None = None


class ObjectMeta(BaseModel):
    """A physical artefact. Carries all 15 Dublin Core elements plus an external PID."""

    model_config = ConfigDict(from_attributes=True)

    object_id: uuid.UUID
    project_id: uuid.UUID
    object_type: str
    object_pid: str | None = None
    created_at: datetime
    dc_title: str
    dc_creator: str | None = None
    dc_subject: str | None = None
    dc_description: str | None = None
    dc_publisher: str | None = None
    dc_contributor: str | None = None
    dc_date: str | None = None
    dc_type: str | None = None
    dc_format: str | None = None
    dc_identifier: str | None = None
    dc_source: str | None = None
    dc_language: str | None = None
    dc_relation: str | None = None
    dc_coverage: str | None = None
    dc_rights: str | None = None


class ProjectCreate(BaseModel):
    dc_title: str
    storage_root: str | None = None  # defaults to a slug of the title
    dc_creator: str | None = None
    dc_contributor: str | None = None
    dc_date: str | None = None
    dc_rights: str | None = None
    dc_description: str | None = None


class ProjectPatch(BaseModel):
    dc_title: str | None = None
    dc_creator: str | None = None
    dc_contributor: str | None = None
    dc_date: str | None = None
    dc_rights: str | None = None
    dc_description: str | None = None


class ObjectCreate(BaseModel):
    dc_title: str
    object_type: str = DEFAULT_OBJECT_TYPE
    object_pid: str | None = None
    dc_creator: str | None = None
    dc_date: str | None = None
    dc_rights: str | None = None
    dc_description: str | None = None


def _slug(title: str) -> str:
    cleaned = "".join(c.lower() if c.isalnum() else "_" for c in title).strip("_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned or "project"


@router.get("/projects", response_model=list[ProjectMeta])
def list_projects(db: Session = Depends(get_db)):
    """Every project. Creates the default one on a fresh install so the list is never empty."""
    ensure_default_project(db)
    db.commit()
    return db.query(Project).order_by(Project.created_at).all()


@router.post("/projects", response_model=ProjectMeta, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    root = payload.storage_root or _slug(payload.dc_title)
    if db.query(Project).filter(Project.storage_root == root).first() is not None:
        raise HTTPException(409, f"A project already stores its data under {root!r}")

    project = Project(
        project_id=uuid.uuid4(),
        storage_root=root,
        created_at=datetime.now(timezone.utc),
        **payload.model_dump(exclude={"storage_root"}),
    )
    db.add(project)
    db.commit()
    invalidate_registry_cache()
    return project


@router.patch("/projects/{project_id}", response_model=ProjectMeta)
def update_project(project_id: uuid.UUID, payload: ProjectPatch, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Unknown project")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    db.commit()
    invalidate_registry_cache()
    return project


@router.get("/projects/{project_id}/objects", response_model=list[ObjectMeta])
def list_objects(project_id: uuid.UUID, db: Session = Depends(get_db)):
    if db.get(Project, project_id) is None:
        raise HTTPException(404, "Unknown project")
    return (
        db.query(Object)
        .filter(Object.project_id == project_id)
        .order_by(Object.created_at)
        .all()
    )


@router.post("/projects/{project_id}/objects", response_model=ObjectMeta, status_code=201)
def create_object(project_id: uuid.UUID, payload: ObjectCreate, db: Session = Depends(get_db)):
    if db.get(Project, project_id) is None:
        raise HTTPException(404, "Unknown project")
    obj = Object(
        object_id=uuid.uuid4(),
        project_id=project_id,
        created_at=datetime.now(timezone.utc),
        **payload.model_dump(),
    )
    db.add(obj)
    db.commit()
    return obj
