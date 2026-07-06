"""SQLAlchemy ORM models.

Mapping notes (why each column type):
  * UUID primary keys use `Uuid` (cross-dialect: CHAR(32) on SQLite, native uuid on Postgres).
  * Flexible/nested metadata and float arrays (`wavelengths`) use `JSON` — portable and enough.
  * Large binaries (the actual HSI cube) are NEVER stored in the DB; we store the file path in
    `data_ref` and keep the bytes on disk (see app.paths.APP_DATA_DIR).

Project → Artefact → DataAcquisition → HsiCube form the (currently empty) backbone that will
model datasets in the DB later. RoiAnnotation is the first table the app actually writes to:
it stores the annotation objects exactly as the frontend sends them (keyed by the string
dataset id), replacing the previous per-dataset JSON files.
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
    external_inputs: Mapped[list["ExternalInput"]] = relationship(
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
    illumination_type: Mapped[str | None] = mapped_column(String, nullable=True)
    illumination_source: Mapped[str | None] = mapped_column(String, nullable=True)
    illumination_notes: Mapped[str | None] = mapped_column(String, nullable=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_to_object: Mapped[float | None] = mapped_column(Float, nullable=True)
    instrument_position: Mapped[str | None] = mapped_column(String, nullable=True)
    scan_duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    dark_reference: Mapped[bool] = mapped_column(default=False)
    white_reference: Mapped[bool] = mapped_column(default=False)
    calibration_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    preprocessing_notes: Mapped[str | None] = mapped_column(String, nullable=True)
    software_version: Mapped[str | None] = mapped_column(String, nullable=True)
    operator: Mapped[str | None] = mapped_column(String, nullable=True)
    exif_available: Mapped[bool] = mapped_column(default=False)
    envi_available: Mapped[bool] = mapped_column(default=False)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    artefact: Mapped["Artefact"] = relationship(back_populates="acquisitions")
    cubes: Mapped[list["HsiCube"]] = relationship(
        back_populates="acquisition", cascade="all, delete-orphan"
    )
    external_inputs: Mapped[list["ExternalInput"]] = relationship(back_populates="acquisition")


class HsiCube(Base):
    """ENVI hyperspectral cube — metadata + a path to the file on disk."""

    __tablename__ = "hsi_cubes"

    cube_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    acquisition_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("data_acquisitions.acquisition_id"))
    data_ref: Mapped[str] = mapped_column(String)  # path to the cube, relative to APP_DATA_DIR
    title: Mapped[str | None] = mapped_column(String, nullable=True)  # user-facing display label
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
    default_bands: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    pixel_size: Mapped[float | None] = mapped_column(Float, nullable=True)
    sensor_type: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    file_type: Mapped[str | None] = mapped_column(String, nullable=True)
    header_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spectral_range_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    spectral_range_max: Mapped[float | None] = mapped_column(Float, nullable=True)

    acquisition: Mapped["DataAcquisition"] = relationship(back_populates="cubes")


class RoiAnnotation(Base):
    """WADM / IIIF region-of-interest (or probe) annotation.

    Implements the Web Annotation Data Model fields from the project data model. The IRI form
    of the id is urn:uuid:{roi_id}. The app's native annotation object (structured geometry,
    colour, group id, kind/type) is ALSO kept in `data` so the UI round-trips losslessly —
    WADM has no columns for those.
    """

    __tablename__ = "roi_annotations"

    roi_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # --- WADM fields ---
    selector_type: Mapped[str] = mapped_column(String, default="SvgSelector")
    selector_value: Mapped[str] = mapped_column(String)
    target: Mapped[str] = mapped_column(String, index=True)   # what is annotated (dataset id / URI)
    body: Mapped[str | None] = mapped_column(String, nullable=True)
    body_format: Mapped[str | None] = mapped_column(String, nullable=True)
    motivation: Mapped[str] = mapped_column(String, default="highlighting")
    creator: Mapped[str | None] = mapped_column(String, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    modified: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    generator: Mapped[str | None] = mapped_column(String, nullable=True)
    generated: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # --- app linkage ---
    dataset_id: Mapped[str | None] = mapped_column(String, index=True, nullable=True)  # stable query key
    cube_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("hsi_cubes.cube_id"), nullable=True
    )
    cube: Mapped["HsiCube | None"] = relationship()

    # --- app-native payload (kept for lossless UI round-trip) ---
    data: Mapped[dict] = mapped_column(JSON)

    # ROI --triggers--> SpectralExtraction (0..1)
    extraction: Mapped["SpectralExtraction | None"] = relationship(
        back_populates="roi", uselist=False, cascade="all, delete-orphan"
    )


class SpectralLibrary(Base):
    """ENVI spectral library — reference spectra (metadata + a path to the file on disk)."""

    __tablename__ = "spectral_libraries"

    library_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    library_name: Mapped[str] = mapped_column(String)
    version: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    file_format: Mapped[str] = mapped_column(String)
    data_ref: Mapped[str] = mapped_column(String)  # path on disk
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    num_spectra: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Dublin Core
    dc_rights: Mapped[str | None] = mapped_column(String, nullable=True)
    dc_creator: Mapped[str] = mapped_column(String)
    dc_subject: Mapped[str | None] = mapped_column(String, nullable=True)
    dc_description: Mapped[str | None] = mapped_column(String, nullable=True)
    dc_publisher: Mapped[str | None] = mapped_column(String, nullable=True)
    dc_contributor: Mapped[str | None] = mapped_column(String, nullable=True)
    dc_source: Mapped[str | None] = mapped_column(String, nullable=True)
    dc_identifier: Mapped[str | None] = mapped_column(String, nullable=True)  # URI

    # ENVI header
    sensor_type: Mapped[str | None] = mapped_column(String, nullable=True)
    instrument: Mapped[str | None] = mapped_column(String, nullable=True)
    wavelengths: Mapped[list[float]] = mapped_column(JSON)
    wavelength_units: Mapped[str] = mapped_column(String, default="nm")
    fwhm: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    number_of_bands: Mapped[int] = mapped_column(Integer)
    interleave: Mapped[str] = mapped_column(String)  # BSQ|BIL|BIP
    data_type: Mapped[int] = mapped_column(Integer)
    file_type: Mapped[str] = mapped_column(String)
    spectra_names: Mapped[list[str]] = mapped_column(JSON)


class ExternalInput(Base):
    """Non-HSI input (e.g. XRF map, RGB photo) imported from another tool."""

    __tablename__ = "external_inputs"

    input_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.project_id"))
    acquisition_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("data_acquisitions.acquisition_id"), nullable=True
    )
    title: Mapped[str | None] = mapped_column(String, nullable=True)  # user-facing display label
    source_tool: Mapped[str] = mapped_column(String)
    capture_modality: Mapped[str] = mapped_column(String)  # XRF | RGB | other
    file_format: Mapped[str] = mapped_column(String)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data_ref: Mapped[str] = mapped_column(String)  # EXIF/XMP source path on disk
    capture_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # EXIF
    camera_model: Mapped[str | None] = mapped_column(String, nullable=True)          # EXIF
    instrument_id: Mapped[str | None] = mapped_column(String, nullable=True)
    operator: Mapped[str | None] = mapped_column(String, nullable=True)
    processing_steps: Mapped[str | None] = mapped_column(String, nullable=True)
    dc_rights: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    project: Mapped["Project"] = relationship(back_populates="external_inputs")
    acquisition: Mapped["DataAcquisition | None"] = relationship(back_populates="external_inputs")


class Visualisation(Base):
    """A saved view (plot / overlay / map) of a dataset or derived result."""

    __tablename__ = "visualisations"

    view_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    view_type: Mapped[str] = mapped_column(String)  # plot | overlay | map
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    display_settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    dataset_ref: Mapped[uuid.UUID] = mapped_column(Uuid)  # generic reference to what's shown
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class ProcessingOperation(Base):
    """W3C PROV-DM activity — a processing step (e.g. a classification run)."""

    __tablename__ = "processing_operations"

    operation_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    operation_type: Mapped[str] = mapped_column(String)  # PROV-DM
    method_name: Mapped[str] = mapped_column(String)
    parameters: Mapped[dict] = mapped_column(JSON)
    executed_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)  # PROV-DM
    software_version: Mapped[str] = mapped_column(String)
    was_associated_with: Mapped[str | None] = mapped_column(String, nullable=True)  # PROV-DM, URI
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    # SpectralExtraction --input to--> ProcessingOperation (0..*)
    input_extraction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("spectral_extractions.extraction_id"), nullable=True
    )


class DerivedDataset(Base):
    """A result produced by a processing operation (classification map, export, …)."""

    __tablename__ = "derived_datasets"

    derived_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String)  # classification | export | other
    file_format: Mapped[str] = mapped_column(String)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data_ref: Mapped[str | None] = mapped_column(String, nullable=True)  # path on disk, or NULL for in-DB results
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    classes: Mapped[int | None] = mapped_column(Integer, nullable=True)          # ENVI
    class_names: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)   # ENVI
    lookup: Mapped[dict | None] = mapped_column(JSON, nullable=True)             # ENVI
    dc_rights: Mapped[str | None] = mapped_column(String, nullable=True)
    was_derived_from: Mapped[uuid.UUID] = mapped_column(Uuid)  # PROV-DM (generic reference)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    # ProcessingOperation --produces--> DerivedDataset (1)
    operation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("processing_operations.operation_id"), nullable=True
    )
    operation: Mapped["ProcessingOperation | None"] = relationship()


class SpectralExtraction(Base):
    """Spectra extracted from the pixels inside an ROI (triggered by an annotation)."""

    __tablename__ = "spectral_extractions"

    extraction_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    mean_spectrum: Mapped[list[float]] = mapped_column(JSON)
    std_spectrum: Mapped[list[float]] = mapped_column(JSON)
    min_spectrum: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    max_spectrum: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    pixel_count: Mapped[int] = mapped_column(Integer)
    extracted_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    wavelength_range: Mapped[str | None] = mapped_column(String, nullable=True)

    # ROI --triggers--> SpectralExtraction (0..1)
    roi_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("roi_annotations.roi_id"), nullable=True, unique=True
    )
    roi: Mapped["RoiAnnotation | None"] = relationship(back_populates="extraction")

    # SpectralExtraction --references--> SpectralLibrary (0..1)
    library_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("spectral_libraries.library_id"), nullable=True
    )
    library: Mapped["SpectralLibrary | None"] = relationship()
