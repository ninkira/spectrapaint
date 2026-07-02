"""SQLAlchemy ORM models — the core of the data model.

Mapping notes (why each column type):
  * Primary keys are UUIDs (`Uuid` is cross-dialect: CHAR(32) on SQLite, native uuid on Postgres).
  * Flexible/nested metadata (`instrument_settings`) and float arrays (`wavelengths`,
    `mean_spectrum`) use `JSON` — portable and enough for our needs.
  * Large binaries (the actual HSI cube) are NEVER stored in the DB; we store the file path
    in `data_ref` and keep the bytes on disk (see app.paths.APP_DATA_DIR).

The remaining entities from the diagram (Spectral Library, External Input, Visualisation,
Derived Dataset, Processing Operation) follow the same patterns and are added next.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    storage_root: Mapped[str] = mapped_column(String)
    dc_title: Mapped[str] = mapped_column(String)
    dc_creator: Mapped[str | None] = mapped_column(String, nullable=True)
    dc_description: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    artefacts: Mapped[list["Artefact"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Artefact(Base):
    """EDM: ProvidedCHO — the physical/cultural object being investigated."""

    __tablename__ = "artefacts"

    artefact_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.project_id"))
    object_type: Mapped[str] = mapped_column(String)
    dc_title: Mapped[str] = mapped_column(String)
    dc_description: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    project: Mapped["Project"] = relationship(back_populates="artefacts")
    acquisitions: Mapped[list["DataAcquisition"]] = relationship(
        back_populates="artefact", cascade="all, delete-orphan"
    )


class DataAcquisition(Base):
    """Paradata — a capture session that produced imaging data."""

    __tablename__ = "data_acquisitions"

    acquisition_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    artefact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("artefacts.artefact_id"))
    capture_modality: Mapped[str] = mapped_column(String)  # HSI | XRF | RGB
    captured_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    instrument_id: Mapped[str | None] = mapped_column(String, nullable=True)
    instrument_settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    dark_reference: Mapped[bool] = mapped_column(default=False)
    white_reference: Mapped[bool] = mapped_column(default=False)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    artefact: Mapped["Artefact"] = relationship(back_populates="acquisitions")
    cubes: Mapped[list["HsiCube"]] = relationship(
        back_populates="acquisition", cascade="all, delete-orphan"
    )


class HsiCube(Base):
    """ENVI hyperspectral cube — metadata + a path to the file on disk."""

    __tablename__ = "hsi_cubes"

    cube_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    acquisition_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("data_acquisitions.acquisition_id"))
    data_ref: Mapped[str] = mapped_column(String)  # path to the cube, relative to APP_DATA_DIR
    checksum: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    # ENVI header fields
    samples: Mapped[int] = mapped_column(Integer)          # width
    lines: Mapped[int] = mapped_column(Integer)            # height
    number_of_bands: Mapped[int] = mapped_column(Integer)
    wavelengths: Mapped[list[float]] = mapped_column(JSON)
    wavelength_units: Mapped[str] = mapped_column(String, default="nm")
    fwhm: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    interleave: Mapped[str | None] = mapped_column(String, nullable=True)  # BSQ|BIL|BIP
    data_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spectral_range_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    spectral_range_max: Mapped[float | None] = mapped_column(Float, nullable=True)

    acquisition: Mapped["DataAcquisition"] = relationship(back_populates="cubes")
    annotations: Mapped[list["RoiAnnotation"]] = relationship(
        back_populates="cube", cascade="all, delete-orphan"
    )


class RoiAnnotation(Base):
    """WADM / IIIF region-of-interest annotation on a cube."""

    __tablename__ = "roi_annotations"

    roi_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    cube_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("hsi_cubes.cube_id"), nullable=True
    )
    selector_type: Mapped[str] = mapped_column(String)   # e.g. SvgSelector
    selector_value: Mapped[str] = mapped_column(String)  # the SVG / coordinates
    body: Mapped[str | None] = mapped_column(String, nullable=True)       # label text
    motivation: Mapped[str | None] = mapped_column(String, nullable=True)
    creator: Mapped[str | None] = mapped_column(String, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    cube: Mapped["HsiCube | None"] = relationship(back_populates="annotations")
    extraction: Mapped["SpectralExtraction | None"] = relationship(
        back_populates="roi", uselist=False, cascade="all, delete-orphan"
    )


class SpectralExtraction(Base):
    """Mean/other spectra extracted from the pixels inside an ROI."""

    __tablename__ = "spectral_extractions"

    extraction_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    roi_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roi_annotations.roi_id"))
    mean_spectrum: Mapped[list[float]] = mapped_column(JSON)
    std_spectrum: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    pixel_count: Mapped[int] = mapped_column(Integer)
    extracted_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    roi: Mapped["RoiAnnotation"] = relationship(back_populates="extraction")
