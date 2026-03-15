#!/usr/bin/env bash
set -euo pipefail

# Deploy the latest (or specified) vX.Y.Z tag
# Usage:
#   ./scripts/deploy.sh          # deploys latest tag
#   ./scripts/deploy.sh v0.1.18  # deploys specific tag

cd "$(git rev-parse --show-toplevel)"

TAG="${1:-}"

if [ -z "$TAG" ]; then
	git fetch --tags
	TAG=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
	if [ -z "$TAG" ]; then
		echo "Error: no vX.Y.Z tag found"
		exit 1
	fi
	echo "Latest tag: $TAG"
else
	git fetch --tags
	if ! git rev-parse "$TAG" >/dev/null 2>&1; then
		echo "Error: tag $TAG not found"
		exit 1
	fi
fi

CURRENT=$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)
if [ "$CURRENT" = "$TAG" ]; then
	echo "Already on $TAG"
	read -r -p "Rebuild anyway? [y/N] " answer
	if [[ ! "$answer" =~ ^[Yy]$ ]]; then
		exit 0
	fi
fi

echo "Deploying $TAG ..."

git checkout "$TAG"
git submodule update --init --recursive

echo "Building Docker image ..."
docker compose build

echo "Restarting containers ..."
docker compose up -d --force-recreate

echo "Done. Deployed $TAG"
docker compose ps
