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
echo "Installing ${PY_PROJECT_NAME} into the embedded Python ..."
uv pip install \
  --python "${PYEMBED_BIN}" \
  --reinstall-package="${PY_PROJECT_NAME}" \
  "${REPO_ROOT}"

# --- 3. Build and bundle ----------------------------------------------------
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
