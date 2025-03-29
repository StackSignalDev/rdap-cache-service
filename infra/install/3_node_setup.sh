#!/bin/bash

set -e
set -u
set -o pipefail

APP_DIR="/srv/rdap-cache-service"
APP_USER="rdapapp"

echo "Using configuration:"
echo "  App Directory: $APP_DIR (Expected to exist)"
echo "  App User: $APP_USER"
echo ""

if [ ! -d "$APP_DIR" ]; then
    echo "ERROR: Application directory '$APP_DIR' not found!"
    echo "Ensure your UserData script successfully cloned the repository to this location."
    exit 1
fi
if [ ! -f "$APP_DIR/package.json" ]; then
    echo "ERROR: 'package.json' not found in '$APP_DIR'!"
    echo "Ensure your UserData script cloned the correct repository branch/content."
    exit 1
fi
echo "Application directory and package.json found."
echo ""

echo "Changing to application directory: $APP_DIR"
cd "$APP_DIR" || exit 1

echo "Installing Node.js dependencies (npm install)..."
sudo -u "$APP_USER" npm install
echo "Dependencies installed."
echo ""

echo "Running database migrations (prisma migrate deploy)..."
if sudo -u "$APP_USER" npx prisma migrate deploy; then
    echo "Database migrations applied successfully."
else
    echo "ERROR: Database migration failed. Check logs above."
    exit 1
fi
echo ""