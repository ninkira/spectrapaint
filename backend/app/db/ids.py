"""Deterministic UUIDs for idempotent DB sync.

Using uuid5 with a fixed namespace means the same logical entity (e.g. the cube for dataset
"hsi__raw__001") always maps to the same UUID. So re-running the dataset sync never creates
duplicate rows, and a dataset id can be resolved to its cube id without a lookup table.
"""
import uuid

# Fixed project namespace — do NOT change; it anchors every deterministic id in the DB.
NAMESPACE = uuid.UUID("6f9b1e2a-4c3d-5e6f-8a9b-0c1d2e3f4a5b")


def stable_id(kind: str, key: str) -> uuid.UUID:
    """Return a deterministic UUID for (kind, key), e.g. stable_id('cube', dataset_id)."""
    return uuid.uuid5(NAMESPACE, f"{kind}:{key}")
