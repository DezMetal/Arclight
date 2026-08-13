"""Build a distributable Arclight release.

The version number lives in three files that must agree — package.json,
src-tauri/tauri.conf.json and src-tauri/Cargo.toml. If they drift, Windows
treats two builds as the same product and the installer silently upgrades in
place, so this script is the only thing that should ever set a version.

Usage:
    python3 tools/release.py                  build at the current version
    python3 tools/release.py --bump patch     0.1.0 -> 0.1.1, then build
    python3 tools/release.py --bump minor     0.1.0 -> 0.2.0, then build
    python3 tools/release.py --bump major     0.1.0 -> 1.0.0, then build
    python3 tools/release.py --set 1.4.2      set explicitly, then build
    python3 tools/release.py --bump patch --no-build    sync versions only

Artifacts land in:
    src-tauri/target/release/arclight.exe                      portable
    src-tauri/target/release/bundle/nsis/*-setup.exe           installer
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"
DIST = ROOT / "dist-release"

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def read_version() -> str:
    return json.loads(TAURI_CONF.read_text(encoding="utf-8"))["version"]


def bump(version: str, part: str) -> str:
    major, minor, patch = (int(x) for x in version.split("."))
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def write_version(version: str) -> None:
    """Set the version in all three files, preserving formatting."""
    for path in (PACKAGE_JSON, TAURI_CONF):
        text = path.read_text(encoding="utf-8")
        updated, count = re.subn(
            r'("version"\s*:\s*)"[^"]*"',
            rf'\g<1>"{version}"',
            text,
            count=1,
        )
        if count != 1:
            raise SystemExit(f"could not find a version field in {path}")
        path.write_text(updated, encoding="utf-8")

    # Only the [package] version, not any dependency's.
    text = CARGO_TOML.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'(?m)^(version\s*=\s*)"[^"]*"',
        rf'\g<1>"{version}"',
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit(f"could not find a version field in {CARGO_TOML}")
    CARGO_TOML.write_text(updated, encoding="utf-8")

    print(f"version set to {version} in 3 files")


def verify_sync() -> str:
    """Fail loudly if the three files disagree."""
    pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["version"]
    conf = json.loads(TAURI_CONF.read_text(encoding="utf-8"))["version"]
    cargo = re.search(
        r'(?m)^version\s*=\s*"([^"]+)"', CARGO_TOML.read_text(encoding="utf-8")
    )
    cargo_version = cargo.group(1) if cargo else "?"

    if not (pkg == conf == cargo_version):
        raise SystemExit(
            "version mismatch — run with --set to resync:\n"
            f"  package.json     {pkg}\n"
            f"  tauri.conf.json  {conf}\n"
            f"  Cargo.toml       {cargo_version}"
        )
    return conf


def build() -> None:
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        raise SystemExit("npm not found on PATH")

    print("building — this takes a few minutes with LTO enabled\n")
    result = subprocess.run([npm, "run", "build"], cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(f"build failed (exit {result.returncode})")


def collect(version: str) -> None:
    """Copy the shippable artifacts somewhere obvious and versioned.

    The bundle directory accumulates installers from every previous build, so
    the one for *this* version is selected by name. Globbing `*-setup.exe` and
    copying whatever matched meant an older installer could be written out
    under the new version's filename — an installer that lies about what it
    contains, which is the exact failure the version check exists to prevent.
    """
    release_dir = ROOT / "src-tauri" / "target" / "release"
    portable = release_dir / "arclight.exe"

    nsis_dir = release_dir / "bundle" / "nsis"
    wanted = f"_{version}_"
    installers = [p for p in nsis_dir.glob("*-setup.exe") if wanted in p.name]

    if not installers and nsis_dir.exists():
        others = sorted(p.name for p in nsis_dir.glob("*-setup.exe"))
        raise SystemExit(
            f"no installer for {version} in {nsis_dir}\n"
            + ("found instead: " + ", ".join(others) if others else "the directory is empty")
        )
    if len(installers) > 1:
        raise SystemExit(
            f"{len(installers)} installers match {version}: "
            + ", ".join(p.name for p in installers)
        )

    DIST.mkdir(exist_ok=True)
    collected = []

    if portable.exists():
        target = DIST / f"Arclight-{version}-portable.exe"
        shutil.copy2(portable, target)
        collected.append(target)

    for installer in installers:
        target = DIST / f"Arclight-{version}-setup.exe"
        shutil.copy2(installer, target)
        collected.append(target)

    if not collected:
        raise SystemExit("build produced no artifacts — check the build output")

    print(f"\nartifacts in {DIST}:")
    for path in collected:
        size = path.stat().st_size / 1_048_576
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        print(f"  {path.name:<38} {size:6.1f} MB")
        print(f"  {'':<38} sha256 {digest[:32]}...")
        # A checksum file is the normal expectation for an unsigned download.
        (path.with_suffix(path.suffix + ".sha256")).write_text(
            f"{digest}  {path.name}\n", encoding="utf-8"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build an Arclight release")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--bump", choices=["major", "minor", "patch"])
    group.add_argument("--set", dest="explicit", metavar="X.Y.Z")
    parser.add_argument(
        "--no-build", action="store_true", help="sync versions without building"
    )
    parser.add_argument(
        "--collect-only",
        action="store_true",
        help="gather artifacts from an existing build without rebuilding",
    )
    args = parser.parse_args()

    if args.explicit:
        if not SEMVER.match(args.explicit):
            raise SystemExit(f"not a semver version: {args.explicit}")
        write_version(args.explicit)
    elif args.bump:
        write_version(bump(read_version(), args.bump))

    version = verify_sync()
    print(f"Arclight {version}")

    if args.no_build:
        return

    if args.collect_only:
        collect(version)
        return

    build()
    collect(version)


if __name__ == "__main__":
    main()
