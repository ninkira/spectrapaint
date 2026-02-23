from pydantic import BaseModel
from typing import Literal
# backend/app/models/dataset_meta.py

# backend/app/models/dataset_meta.py
class DatasetMeta(BaseModel):
    id: str
    name: str
    type: Literal["hsi", "tiff", "png", "jpg"]
    path: str
    width: int
    height: int
    wavelengths_nm: list[float] | None = None
