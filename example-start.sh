#!/bin/sh

docker compose \
  -f /path/to/deno-static-upload-server/docker-compose.yml \
  --env-file /path/to/env.static-file-server \
  up -d