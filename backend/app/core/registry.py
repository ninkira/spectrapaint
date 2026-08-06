"""The plug-in registry — the microkernel's extension point.

The system is split into a stable core (data management, ROI handling, metadata and provenance,
storage abstraction) and extensible components: import and export handlers, signal processing,
classification algorithms, and image operations. This is the mechanism by which a component
attaches to the core without the core knowing it exists.

Discovery is by explicit `import` in `app/plugins/__init__.py`, deliberately, over two
alternatives:

  * setuptools entry points need dist-info metadata that PyInstaller drops unless taught to
    keep it, and nothing here is distributed as a third-party package on an index.
  * `pkgutil.walk_packages` is invisible to PyInstaller's static analyser, so the frozen build
    needs hiddenimports upkeep, and an ImportError degrades into "the method just isn't in the
    dropdown" rather than a failure.

A real import statement is greppable, gets bundled, and fails loudly at startup.
"""
from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Generic, Iterator, Mapping, TypeVar

T = TypeVar("T")


class UnknownPlugin(LookupError):
    """Asked for a plug-in id that nothing registered."""


@dataclass(frozen=True)
class Registration(Generic[T]):
    id: str
    label: str
    impl: T
    meta: Mapping[str, Any]


class Registry(Generic[T]):
    """A named collection of plug-ins of one kind, ordered by registration."""

    def __init__(self, kind: str) -> None:
        self._kind = kind
        self._items: dict[str, Registration[T]] = {}

    def register(self, id: str, label: str, **meta: Any) -> Callable[[T], T]:
        """Decorator that adds `impl` to this registry and returns it unchanged.

        Registering the same id twice is a programming error, not a silent override — two
        plug-ins fighting over one id would otherwise resolve by import order.
        """
        def decorator(impl: T) -> T:
            if id in self._items:
                raise ValueError(f"Duplicate {self._kind} plug-in id: {id!r}")
            self._items[id] = Registration(
                id=id, label=label, impl=impl, meta=MappingProxyType(dict(meta))
            )
            return impl

        return decorator

    def get(self, id: str) -> T:
        try:
            return self._items[id].impl
        except KeyError:
            known = ", ".join(self._items) or "none registered"
            raise UnknownPlugin(f"Unknown {self._kind}: {id!r} (known: {known})") from None

    def list(self) -> list[dict[str, Any]]:
        """The registry as plain dicts, for serving over the API. Registration order."""
        return [{"id": r.id, "label": r.label, **r.meta} for r in self._items.values()]

    def ids(self) -> list[str]:
        return list(self._items)

    def __contains__(self, id: object) -> bool:
        return id in self._items

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self) -> Iterator[Registration[T]]:
        return iter(self._items.values())


# The four extensible component types. Populated by app.plugins at import time.
CLASSIFIERS: Registry[Any] = Registry("classification method")
IMPORTERS: Registry[Any] = Registry("import handler")
EXPORTERS: Registry[Any] = Registry("export handler")
IMAGE_OPS: Registry[Any] = Registry("image operation")
