#!/bin/sh
set -e

NAME="deno-static-upload-server"

deno install -g -A -n "$NAME" jsr:@marianmeres/deno-static-upload-server

echo "Installed as '$NAME'. Run it with:"
echo "  $NAME"
