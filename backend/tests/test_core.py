"""The stable core: the plug-in registry, the storage abstraction, and the dependency rule."""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.core.registry import Registry, UnknownPlugin
from app.core.storage.local import LocalFilesystemStorage

APP_DIR = Path(__file__).resolve().parents[1] / "app"


# --- registry -------------------------------------------------------------------------------


def test_register_and_get():
    registry: Registry = Registry("widget")

    @registry.register("a", "Widget A")
    def widget_a():
        return "a"

    assert registry.get("a") is widget_a
    assert "a" in registry
    assert len(registry) == 1


def test_register_returns_the_implementation_unchanged():
    registry: Registry = Registry("widget")

    def original():
        return 1

    decorated = registry.register("a", "A")(original)
    assert decorated is original


def test_list_preserves_registration_order_and_carries_meta():
    registry: Registry = Registry("widget")
    registry.register("z", "Zed", higher_is_better=True)(lambda: None)
    registry.register("a", "Ay")(lambda: None)

    assert registry.list() == [
        {"id": "z", "label": "Zed", "higher_is_better": True},
        {"id": "a", "label": "Ay"},
    ]


def test_list_matches_the_shape_the_api_already_returns():
    """GET /classification/methods must not change shape when METHODS becomes a registry."""
    registry: Registry = Registry("classification method")
    registry.register("sam_matrix", "SAM (matrix)")(lambda: None)
    assert registry.list() == [{"id": "sam_matrix", "label": "SAM (matrix)"}]


def test_unknown_id_raises_with_the_known_ids_listed():
    registry: Registry = Registry("classification method")
    registry.register("klpd", "KL pseudo-divergence")(lambda: None)

    with pytest.raises(UnknownPlugin, match="klpd"):
        registry.get("nope")


def test_duplicate_ids_are_rejected():
    """Two plug-ins claiming one id would otherwise resolve by import order."""
    registry: Registry = Registry("widget")
    registry.register("a", "First")(lambda: None)

    with pytest.raises(ValueError, match="Duplicate"):
        registry.register("a", "Second")(lambda: None)


# --- storage --------------------------------------------------------------------------------


def test_resolve_and_relativise_round_trip(tmp_path):
    storage = LocalFilesystemStorage(tmp_path)
    assert storage.relativise(storage.resolve("old_man/hsi/001.hdr")) == "old_man/hsi/001.hdr"


def test_resolve_passes_absolute_refs_through(tmp_path):
    """Refs stored before the app managed its own data folder still resolve to where they are."""
    outside = tmp_path.parent / "elsewhere" / "cube.hdr"
    assert LocalFilesystemStorage(tmp_path).resolve(str(outside)) == outside


def test_relativise_falls_back_to_the_absolute_path_when_outside_the_root(tmp_path):
    outside = tmp_path.parent / "elsewhere.png"
    outside.parent.mkdir(parents=True, exist_ok=True)
    outside.touch()
    assert LocalFilesystemStorage(tmp_path / "root").relativise(outside) == outside.resolve().as_posix()


def test_write_creates_parents_and_read_returns_the_bytes(tmp_path):
    storage = LocalFilesystemStorage(tmp_path)
    path = storage.write("a/b/c.bin", b"payload")

    assert path.read_bytes() == b"payload"
    assert storage.exists("a/b/c.bin")
    with storage.open("a/b/c.bin") as handle:
        assert handle.read() == b"payload"


def test_delete_is_idempotent(tmp_path):
    storage = LocalFilesystemStorage(tmp_path)
    storage.write("gone.bin", b"x")
    storage.delete("gone.bin")
    storage.delete("gone.bin")  # missing is not an error
    assert not storage.exists("gone.bin")


def test_list_walks_recursively_under_a_prefix(tmp_path):
    storage = LocalFilesystemStorage(tmp_path)
    storage.write("old_man/hsi/a.hdr", b"")
    storage.write("old_man/xrf/b.png", b"")
    storage.write("other/c.png", b"")

    assert list(storage.list("old_man")) == ["old_man/hsi/a.hdr", "old_man/xrf/b.png"]
    assert len(list(storage.list())) == 3
    assert list(storage.list("nonexistent")) == []


def test_the_app_wires_one_storage_singleton_at_the_data_root():
    from app.paths import APP_DATA_DIR, storage

    assert storage.root == APP_DATA_DIR


# --- the dependency rule ----------------------------------------------------------------------


def imported_modules(path: Path) -> set[str]:
    """Every module `path` imports, with relative imports resolved to absolute `app.*` names."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    package = ("app", *path.relative_to(APP_DIR).parent.parts)
    names: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
            continue
        if not isinstance(node, ast.ImportFrom):
            continue

        if node.level == 0:
            base = node.module or ""
        else:
            prefix = package[: len(package) - node.level + 1]
            base = ".".join((*prefix, node.module)) if node.module else ".".join(prefix)
        names.add(base)
        # `from . import plugins` names a submodule in the alias, not in `module` — without
        # this, that form would slip past the dependency rule entirely.
        names.update(f"{base}.{alias.name}" for alias in node.names)

    return names


def test_the_import_scanner_resolves_relative_imports():
    """Keeps the two dependency-rule tests below from passing vacuously."""
    assert "app.paths" in imported_modules(APP_DIR / "services" / "dataset_store.py")
    assert "app.api.routes_datasets" in imported_modules(APP_DIR / "api" / "routes_upload.py")
    # main.py uses `from . import plugins`, the form the scanner previously missed.
    assert "app.plugins" in imported_modules(APP_DIR / "main.py")


@pytest.mark.parametrize("source", sorted((APP_DIR / "core").rglob("*.py")), ids=lambda p: p.name)
def test_core_never_imports_plugins_or_api(source):
    """Fig. 2's whole point: the core must not know its extensible components exist."""
    offenders = {m for m in imported_modules(source) if m.startswith(("app.plugins", "app.api"))}
    assert not offenders, f"{source.name} imports {offenders}"


@pytest.mark.parametrize("source", sorted((APP_DIR / "plugins").rglob("*.py")), ids=lambda p: p.name)
def test_plugins_never_import_api(source):
    offenders = {m for m in imported_modules(source) if m.startswith("app.api")}
    assert not offenders, f"{source.name} imports {offenders}"
