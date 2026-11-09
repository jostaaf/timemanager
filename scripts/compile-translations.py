#!/usr/bin/env python3
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
msgfmt = shutil.which("msgfmt")
if msgfmt is None:
    raise SystemExit(
        "GNU gettext's msgfmt is required to compile translations. "
        "Install it with: sudo apt install gettext"
    )

languages = (root / "po" / "LINGUAS").read_text(encoding="utf-8").splitlines()
for language in languages:
    language = language.strip()
    if not language or language.startswith("#"):
        continue

    source = root / "po" / f"{language}.po"
    output = root / "locale" / language / "LC_MESSAGES" / "timemanager.mo"
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [msgfmt, "--check", "-o", str(output), str(source)],
        check=True,
    )
