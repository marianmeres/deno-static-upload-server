#!/bin/sh
set -e

NAME="deno-static-upload-server"

deno uninstall -g "$NAME"

echo "Uninstalled '$NAME'."
