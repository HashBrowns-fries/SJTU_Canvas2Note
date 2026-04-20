#!/usr/bin/env python3
"""Build the frontend and copy dist/ into the project root."""
import subprocess, shutil, os
from pathlib import Path

ROOT = Path(__file__).parent
FE   = ROOT / "frontend"
DIST = FE / "dist"

def run(*cmd, **kw):
    print(" ".join(str(c) for c in cmd))
    subprocess.run(cmd, cwd=FE, check=True, **kw)

def main():
    run("npm", "install")
    run("npm", "run", "build")
    print(f"\nFrontend built → {DIST}")

if __name__ == "__main__":
    main()
