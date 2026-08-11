"""Extensible components — the outer ring of the microkernel.

Importing this package is what puts plug-ins into the registries in `app.core.registry`. Every
plug-in module must be listed below explicitly: that is the discovery mechanism, chosen over
entry points and package walking for the reasons set out in `app.core.registry`.

To add a classification method, an import or export handler, or an image operation: write the
module, decorate it with the matching registry, and add one line here.

The dependency rule is `plugins -> core`, never the reverse and never `plugins -> api`.
"""

# ruff: noqa: F401  — imported for the registration side effect, not for the names.

# Classification methods. Import order is the order the UI dropdown shows, and matches the
# hand-written METHODS list this replaced.
from .classification import sam         # sam_matrix
from .classification import cosine      # cosine_matrix
from .classification import klpd        # klpd
from .classification import sam_pixel   # sam_pixel

__all__: list[str] = []
