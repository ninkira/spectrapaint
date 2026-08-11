"""Projects and the objects they investigate.

The data model exists to let one investigation cover several physical objects — a few paintings
by the same artist, say. The code contradicted that with a single hardcoded project id, so this
module owns project and object resolution instead.

Backward compatibility is the constraint. Every existing row belongs to one project created
under the old scheme, and its primary key was derived from the slug `old_man` via `stable_id`.
That derivation cannot change without orphaning the data, so the default project keeps both the
slug and the derivation, and simply stops being the only one allowed.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...db.ids import stable_id
from ...db.models import DataAcquisition, ExternalInput, HsiCube, Object, Project

# The project every pre-existing row belongs to. `stable_id("project", …)` and
# `stable_id("artefact", …)` hash these strings into keys already in the database, so neither
# the slug nor the kind strings may change.
DEFAULT_PROJECT_SLUG = "old_man"
DEFAULT_PROJECT_TITLE = "Old Man"
DEFAULT_OBJECT_TYPE = "painting"


def default_project_id() -> uuid.UUID:
    return stable_id("project", DEFAULT_PROJECT_SLUG)


def default_object_id() -> uuid.UUID:
    # Kind string is "artefact", not "object" — see the module docstring.
    return stable_id("artefact", DEFAULT_PROJECT_SLUG)


def ensure_default_project(db: Session, now: datetime | None = None) -> tuple[Project, Object]:
    """The project and object that existing data belongs to, created if this is a fresh install."""
    now = now or datetime.now(timezone.utc)
    project = db.get(Project, default_project_id())
    if project is None:
        project = Project(
            project_id=default_project_id(),
            storage_root=DEFAULT_PROJECT_SLUG,
            dc_title=DEFAULT_PROJECT_TITLE,
            created_at=now,
        )
        db.add(project)
    obj = db.get(Object, default_object_id())
    if obj is None:
        obj = Object(
            object_id=default_object_id(),
            project_id=project.project_id,
            object_type=DEFAULT_OBJECT_TYPE,
            dc_title=DEFAULT_PROJECT_TITLE,
            created_at=now,
        )
        db.add(obj)
    db.flush()
    return project, obj


def resolve_project_and_object(
    db: Session,
    project_id: uuid.UUID | None = None,
    object_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> tuple[Project, Object]:
    """Where an upload belongs.

    Both arguments are optional so the API stays backward compatible: a client that says nothing
    lands in the default project, exactly as before this module existed.
    """
    now = now or datetime.now(timezone.utc)
    if project_id is None and object_id is None:
        return ensure_default_project(db, now)

    if object_id is not None:
        obj = db.get(Object, object_id)
        if obj is None:
            raise LookupError(f"Unknown object: {object_id}")
        if project_id is not None and obj.project_id != project_id:
            raise LookupError(f"Object {object_id} does not belong to project {project_id}")
        return db.get(Project, obj.project_id), obj

    project = db.get(Project, project_id)
    if project is None:
        raise LookupError(f"Unknown project: {project_id}")
    obj = (
        db.query(Object)
        .filter(Object.project_id == project.project_id)
        .order_by(Object.created_at)
        .first()
    )
    if obj is None:
        # A project with no object yet: give it one rather than refusing the upload.
        obj = Object(
            object_id=uuid.uuid4(),
            project_id=project.project_id,
            object_type=DEFAULT_OBJECT_TYPE,
            dc_title=project.dc_title,
            created_at=now,
        )
        db.add(obj)
        db.flush()
    return project, obj


def dataset_owners(db: Session) -> dict[str, tuple[uuid.UUID, str, str]]:
    """`dataset_id` -> (project_id, project title, storage root), for every dataset.

    A cube reaches its project through its acquisition and object; an external input holds the
    project directly. Resolved in two queries rather than per dataset, because the registry
    builds this for everything at once.
    """
    owners: dict[str, tuple[uuid.UUID, str, str]] = {}

    cubes = (
        db.query(HsiCube.dataset_id, Project.project_id, Project.dc_title, Project.storage_root)
        .join(DataAcquisition, DataAcquisition.acquisition_id == HsiCube.acquisition_id)
        .join(Object, Object.object_id == DataAcquisition.object_id)
        .join(Project, Project.project_id == Object.project_id)
    )
    inputs = (
        db.query(ExternalInput.dataset_id, Project.project_id, Project.dc_title, Project.storage_root)
        .join(Project, Project.project_id == ExternalInput.project_id)
    )
    for dataset_id, project_id, title, root in list(cubes) + list(inputs):
        if dataset_id:
            owners[dataset_id] = (project_id, title, root)
    return owners
