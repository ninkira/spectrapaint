from pydantic import BaseModel
from typing import List

class DatasetMeta(BaseModel):
    id: str
    name: str
    width: int
    height: int
    wavelengths_nm: List[float]
