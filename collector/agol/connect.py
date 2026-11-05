"""Sign in with AGOL_PROFILE, or with AGOL_USERNAME and AGOL_PASSWORD."""

import os
from pathlib import Path


# Read .env into the environment when those keys are not already set.
def _load_env():
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# Return one env value, or None when it is blank.
def _setting(name):
    return os.environ.get(name, "").strip() or None


# Sign in with the saved profile, or with a username and password.
def connect():
    _load_env()
    import warnings

    warnings.filterwarnings("ignore")
    from arcgis.gis import GIS

    profile = _setting("AGOL_PROFILE")
    if profile:
        gis = GIS(profile=profile)
    else:
        username = _setting("AGOL_USERNAME")
        password = _setting("AGOL_PASSWORD")
        if not username or not password:
            raise RuntimeError("Set AGOL_PROFILE, or AGOL_USERNAME and AGOL_PASSWORD, in .env")
        url = _setting("AGOL_URL") or "https://www.arcgis.com"
        gis = GIS(url, username, password)

    if gis.users.me is None:
        raise RuntimeError(
            "Sign-in failed. Set AGOL_PROFILE to a profile saved on this computer, "
            "or leave it empty and set AGOL_USERNAME and AGOL_PASSWORD."
        )
    return gis


# Sign in with credentials passed in by the console, not read from .env.
def connect_with(url, username, password):
    import warnings

    warnings.filterwarnings("ignore")
    from arcgis.gis import GIS

    gis = GIS(url, username, password)
    if gis.users.me is None:
        raise RuntimeError("Sign-in failed for this portal.")
    return gis


# Progress line for the run log (stderr goes to collector/logs/<run id>.log).
def log(message):
    import sys
    from datetime import datetime

    print(f"{datetime.now():%H:%M:%S} {message}", file=sys.stderr, flush=True)


# Run a call and return the error text instead of stopping the report.
def safely(fn):
    try:
        return fn()
    except Exception as exc:
        return str(exc)
