from __future__ import annotations

import sys
from pathlib import Path

# Ensure `app.*` imports resolve when pytest is run from repo root or from backend/.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
