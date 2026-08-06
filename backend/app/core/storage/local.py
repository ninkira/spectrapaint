"""Filesystem-backed storage — the only backend the local-first prototype needs.

Takes its root as a constructor argument rather than importing `app.paths`, so the dependency
runs paths -> core.storage and never loops back.
"""
from __future__ import annotations

from pathlib import Path
from typing import IO, Iterator


class LocalFilesystemStorage:
    """`data_ref`s are POSIX-style paths relative to `root`."""

    def __init__(self, root: Path | str) -> None:
        self._root = Path(root)

    @property
    def root(self) -> Path:
        return self._root

    def resolve(self, data_ref: str) -> Path:
        # `Path / <absolute>` yields the absolute path, so refs stored before the app managed
        # its own data folder keep resolving to where they actually are.
        return self._root / data_ref

    def relativise(self, path: Path | str) -> str:
        """`data_ref` for a real path, or the path itself when it lies outside the root.

        Falling back to the absolute path rather than raising keeps a dataset that lives
        somewhere else usable; it simply is not portable between machines.
        """
        resolved = Path(path).resolve()
        try:
            return resolved.relative_to(self._root.resolve()).as_posix()
        except ValueError:
            return resolved.as_posix()

    def exists(self, data_ref: str) -> bool:
        return self.resolve(data_ref).exists()

    def open(self, data_ref: str, mode: str = "rb") -> IO:
        path = self.resolve(data_ref)
        if "w" in mode or "a" in mode or "x" in mode:
            path.parent.mkdir(parents=True, exist_ok=True)
        return open(path, mode)

    def write(self, data_ref: str, data: bytes) -> Path:
        path = self.resolve(data_ref)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def delete(self, data_ref: str) -> None:
        self.resolve(data_ref).unlink(missing_ok=True)

    def list(self, prefix: str = "") -> Iterator[str]:
        base = self.resolve(prefix) if prefix else self._root
        if not base.is_dir():
            return
        for path in sorted(base.rglob("*")):
            if path.is_file():
                yield self.relativise(path)
