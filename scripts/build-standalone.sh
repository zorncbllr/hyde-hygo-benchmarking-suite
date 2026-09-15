#!/usr/bin/env bash
# Build a standalone (bundled) desktop app for distribution.
#
# Follows the pytauri "Build Standalone Binary" tutorial:
#   1. Fetch a portable python-build-standalone distribution into
#      src-tauri/pyembed (cached across runs).
#   2. Install the Python project (suite + hyde_bench) and its dependencies
#      into the embedded interpreter (re-run after Python code changes).
#   3. Compile the Rust binary against the embedded interpreter and bundle it
#      with the embedded Python via tauri-cli's `--config src-tauri/tauri.bundle.json`.
#
# Usage: ./scripts/build-standalone.sh [--clean]
#   --clean  discard the cached pyembed environment and start fresh.
set -euo pipefail

PBS_TAG="20260901"
PBS_ASSET="cpython-3.13.15+${PBS_TAG}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${PBS_ASSET}"
PBS_SHA256SUMS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/SHA256SUMS"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYEMBED_DIR="${REPO_ROOT}/src-tauri/pyembed"
PYEMBED_BIN="${PYEMBED_DIR}/python/bin/python3"
PY_PROJECT_NAME="hyde-hygo-benchmark-suite"
APP_NAME="benchsuite" # productName in tauri.conf.json

if [[ "${1:-}" == "--clean" ]]; then
  echo "Removing cached pyembed environment: ${PYEMBED_DIR}"
  rm -rf "${PYEMBED_DIR}"
fi

mkdir -p "${PYEMBED_DIR}"

# --- 1. Portable Python distribution ---------------------------------------
if [[ ! -x "${PYEMBED_BIN}" ]]; then
  echo "Downloading ${PBS_ASSET} ..."
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR}"' EXIT
  curl -fL "${PBS_URL}" -o "${TMP_DIR}/${PBS_ASSET}"
  curl -fL "${PBS_SHA256SUMS_URL}" -o "${TMP_DIR}/SHA256SUMS"
  expected="$(grep -F "${PBS_ASSET}" "${TMP_DIR}/SHA256SUMS" | awk '{print $1}')"
  echo "${expected}  ${TMP_DIR}/${PBS_ASSET}" | sha256sum -c --quiet -
  tar -xzf "${TMP_DIR}/${PBS_ASSET}" -C "${PYEMBED_DIR}"
else
  echo "Reusing cached pyembed interpreter: ${PYEMBED_BIN}"
fi

# --- 2. Install the project into the embedded interpreter ------------------
export PYTAURI_STANDALONE=1
# setuptools' incremental build dir and uv's wheel cache have both served
# stale copies of the project after source-only changes (same version,
# different code); clear them so the bundle always matches the repo.
rm -rf "${REPO_ROOT}/build"
echo "Installing ${PY_PROJECT_NAME} into the embedded Python ..."
uv pip install \
  --python "${PYEMBED_BIN}" \
  --no-cache \
  --reinstall-package="${PY_PROJECT_NAME}" \
  "${REPO_ROOT}"

# --- 3. Strip Tcl/Tk from the embedded interpreter ---------------------------
# Nothing in the app uses Tk: the GUI is Tauri and matplotlib is pinned to the
# Agg backend in suite/chart_worker.py. python-build-standalone still ships
# tcl/tk plus a `_tkinter` extension whose RPATH points at its build-time
# /tools/deps/lib, so linuxdeploy fails AppImage bundling with
# "Could not find dependency: libtcl9tk9.0.so" while scanning lib-dynload.
# Removing the dead weight keeps the bundle smaller and the bundler happy.
if [[ -d "${PYEMBED_DIR}/python/lib" ]]; then
  echo "Stripping unused Tcl/Tk from the embedded interpreter ..."
  rm -f "${PYEMBED_DIR}"/python/lib/libtcl*.so "${PYEMBED_DIR}"/python/lib/libtk*.so
  rm -rf "${PYEMBED_DIR}"/python/lib/tcl9* "${PYEMBED_DIR}"/python/lib/tk9* \
    "${PYEMBED_DIR}"/python/lib/itcl* "${PYEMBED_DIR}"/python/lib/thread*/
  rm -f "${PYEMBED_DIR}"/python/lib/python3.13/lib-dynload/_tkinter*.so \
    "${PYEMBED_DIR}"/python/lib/python3.13/lib-dynload/turtle* 2>/dev/null || true
  rm -rf "${PYEMBED_DIR}"/python/lib/python3.13/tkinter \
    "${PYEMBED_DIR}"/python/lib/python3.13/turtledemo
  rm -f "${PYEMBED_DIR}"/python/bin/idle*
  # The tauri CLI copies the bundled resources next to the cargo binary
  # (target/<profile>/{bin,lib,include,share}) and never prunes removed
  # files, so stale tcl/tk copies would keep leaking into every bundle.
  rm -rf "${REPO_ROOT}/src-tauri/target/bundle-release/bin" \
    "${REPO_ROOT}/src-tauri/target/bundle-release/lib" \
    "${REPO_ROOT}/src-tauri/target/bundle-release/include" \
    "${REPO_ROOT}/src-tauri/target/bundle-release/share"
  # AppImage staging dirs are also reused across runs without pruning.
  rm -rf "${REPO_ROOT}/src-tauri/target/bundle-release/bundle/appimage_deb" \
    "${REPO_ROOT}/src-tauri/target/bundle-release/bundle/appimage"
fi

# --- 4. Build and bundle ----------------------------------------------------
# The linuxdeploy pinned by tauri bundles an older binutils that cannot strip
# Fedora 41 system libraries using DT_RELR (.relr.dyn) sections, and its
# "Strip call failed" aborts AppImage bundling. NO_STRIP is linuxdeploy's
# supported opt-out; the AppImage just ships unstripped libraries.
export NO_STRIP=1
# Point pyo3 at the embedded interpreter so it links the bundled libpython,
# and set an rpath so the installed binary can find it in the resource dir.
export PYO3_PYTHON="${PYEMBED_BIN}"
export RUSTFLAGS="-C link-arg=-Wl,-rpath,\$ORIGIN/../lib/${APP_NAME}/lib -L ${PYEMBED_DIR}/python/lib"

echo "Building the bundle (this compiles the Rust app in profile bundle-release) ..."
"${REPO_ROOT}/ui/node_modules/.bin/tauri" build \
  --config src-tauri/tauri.bundle.json \
  -- --profile bundle-release

echo
echo "Done. Bundles in src-tauri/target/bundle-release/bundle:"
find "${REPO_ROOT}/src-tauri/target/bundle-release/bundle" -maxdepth 2 -type f | sed "s|${REPO_ROOT}/||"
