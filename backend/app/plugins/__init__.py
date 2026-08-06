"""Extensible components — the outer ring of the microkernel.

Importing this package is what puts plug-ins into the registries in `app.core.registry`. Every
plug-in module must be listed below explicitly: that is the discovery mechanism, chosen over
entry points and package walking for the reasons set out in `app.core.registry`.

To add a classification method, an import or export handler, or an image operation: write the
module, decorate it with the matching registry, and add one line here.

The dependency rule is `plugins -> core`, never the reverse and never `plugins -> api`.
"""

# ruff: noqa: F401  — imported for the registration side effect, not for the names.

__all__: list[str] = []
