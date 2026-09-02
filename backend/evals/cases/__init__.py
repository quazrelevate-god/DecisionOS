"""Golden-set case modules. Importing this package self-registers every case
(each module calls evals.base.register at import). Add a new domain module here."""
from evals.cases import (  # noqa: F401 -- import for side-effect (registration)
    extraction, generators, captures, coaching, documents, onboarding,
)
