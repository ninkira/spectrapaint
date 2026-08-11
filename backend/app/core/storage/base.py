"""Storage abstraction — one of the stable-core responsibilities.

Bulk data (HSI cubes, raster images) lives on the filesystem while the database holds only
structured metadata and a `data_ref` pointing at it. Every translation between a stored
`data_ref` and a real location goes through this interface, so the layout policy lives in one
place instead of being re-derived in each route.

One deliberate leak: `resolve()` hands back a real `Path`. `spectral.io.envi.open()` memory-maps
its data file and PIL wants a filename; neither accepts a stream, and reading a multi-gigabyte
cube through a file-like object would defeat the point of keeping it on disk. So this is an
abstraction over *layout*, not a promise that the backend could be swapped for object storage
without touching the readers.
"""
from __future__ import annotations

from pathlib import Path
from typing import IO, Iterator, Protocol


class StorageBackend(Protocol):
    """Where the bulk data lives, and how a stored `data_ref` maps onto it."""

    def resolve(self, data_ref: str) -> Path:
        """Absolute path for a stored `data_ref`. See the note above about returning a Path."""
        ...

    def relativise(self, path: Path | str) -> str:
        """The `data_ref` to store for a real path — the inverse of `resolve`."""
        ...

    def exists(self, data_ref: str) -> bool:
        ...

    def open(self, data_ref: str, mode: str = "rb") -> IO:
        ...

    def write(self, data_ref: str, data: bytes) -> Path:
        """Write bytes, creating parent directories. Returns the resolved path."""
        ...

    def delete(self, data_ref: str) -> None:
        """Remove the file. Missing is not an error."""
        ...

    def list(self, prefix: str = "") -> Iterator[str]:
        """Every `data_ref` under `prefix`, recursively."""
        ...
