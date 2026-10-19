#!/usr/bin/env python3
"""Emit the exact version/hash requirements for a reviewed downloaded wheel set."""

import argparse
from email.parser import BytesParser
import hashlib
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("wheel_directory", type=Path)
args = parser.parse_args()
rows = {}
for wheel in sorted(args.wheel_directory.glob("*.whl")):
    with zipfile.ZipFile(wheel) as archive:
        metadata_files = [name for name in archive.namelist()
                          if name.endswith(".dist-info/METADATA")]
        if len(metadata_files) != 1:
            raise ValueError(f"Wheel has an ambiguous package identity: {wheel}")
        metadata = BytesParser().parsebytes(archive.read(metadata_files[0]))
    name = metadata["Name"].lower().replace("_", "-")
    if name in rows:
        raise ValueError(f"More than one wheel for {name}; use a fresh wheel directory")
    rows[name] = (metadata["Version"], hashlib.sha256(wheel.read_bytes()).hexdigest())
if "semgrep" not in rows:
    raise ValueError("Wheel set does not contain Semgrep")
print("# Semgrep CE, fully pinned for Linux x86_64 / CPython 3.12.")
print("# Regenerate and review with the procedure in README.md; pip verifies every wheel.")
print("# Only binary wheels are installed; no package build hooks.")
for name, (version, digest) in sorted(rows.items()):
    print(f"{name}=={version} --hash=sha256:{digest}")
