"""Pydantic request/response models grouped by domain.

Currently empty scaffolding — Phase B will extract the model classes
from `server.py` (TaskCreateInput, DecisionInput, etc.) into per-domain
files (tasks.py, decisions.py, auth.py, ...).

Until then, models still live inline in `server.py` and the individual
routers so no imports break.
"""
