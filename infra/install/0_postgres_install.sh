#!/bin/bash

set -e
set -u
set -o pipefail

echo "Updating package list (apt update)..."
sudo apt update -y

echo "Installing PostgreSQL server, client, and contrib packages..."
sudo apt install -y postgresql postgresql-contrib postgresql-client

echo "Verifying PostgreSQL service status..."
if sudo systemctl is-active --quiet postgresql; then
  echo "PostgreSQL service is active."
else
  echo "Warning: PostgreSQL service does not appear to be active. Attempting to start..."
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
  if sudo systemctl is-active --quiet postgresql; then
    echo "PostgreSQL service started successfully."
  else
    echo "ERROR: Failed to start PostgreSQL service. Please check logs: sudo journalctl -u postgresql"
    exit 1
  fi
fi

echo "-------------------------------------------"
echo "PostgreSQL Installation completed successfully!"
echo "Next steps typically involve creating users and databases (e.g., running setup_postgres.sh)."
echo "-------------------------------------------"

exit 0