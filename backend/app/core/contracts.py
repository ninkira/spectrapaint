"""Interfaces the extensible components satisfy.

One Protocol per extensible component type. They are structural: a plug-in satisfies a contract
by having the right shape, with no base class to inherit and no import from here at runtime, so
the dependency really does point plugins -> core and never the reverse.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import numpy as np


@runtime_checkable
class ClassificationMethod(Protocol):
    """Scores one query spectrum against every spectrum in a reference library."""

    def __call__(self, query: np.ndarray, library: np.ndarray) -> np.ndarray:
        """`query` is (B,), `library` is (N, B); returns (N,) scores, one per library spectrum.

        Both are expected to be on the same wavelength grid — aligning them is the caller's job,
        not the metric's.
        """
        ...


@runtime_checkable
class ImportHandler(Protocol):
    """Turns an uploaded file into a registered dataset."""

    def sniff(self, path: Path) -> bool:
        """Whether this handler can read the file."""
        ...

    def load(self, path: Path, context: dict[str, Any]) -> dict[str, Any]:
        """Read the file and return the technical metadata needed to build its DB row."""
        ...


@runtime_checkable
class ExportHandler(Protocol):
    """Serialises something the system holds into bytes a user can take away."""

    def render(self, subject: Any, context: dict[str, Any]) -> bytes:
        ...


@runtime_checkable
class ImageOperation(Protocol):
    """A pixel-domain transform applied to an array before display."""

    def __call__(self, image: np.ndarray, **params: Any) -> np.ndarray:
        ...
