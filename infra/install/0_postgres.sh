#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e
# Treat unset variables as an error
set -u
# Exit on error within pipes
set -o pipefail

# --- Script Start ---
echo "-------------------------------------------"
echo "Starting PostgreSQL Installation..."
echo "-------------------------------------------"

# --- 1. Update Package List ---
# Although UserData might have done this recently, it's good practice
# in standalone scripts to ensure the list is current.
echo "Updating package list (apt update)..."
sudo apt update -y

# --- 2. Install PostgreSQL Server & Client ---
echo "Installing PostgreSQL server, client, and contrib packages..."
# Installs the default version available in Ubuntu 22.04 repositories
sudo apt install -y postgresql postgresql-contrib postgresql-client

# --- 3. Verify Service Status ---
echo "Verifying PostgreSQL service status..."
# Check if the service is active
if sudo systemctl is-active --quiet postgresql; then
  echo "PostgreSQL service is active."
else
  echo "Warning: PostgreSQL service does not appear to be active. Attempting to start..."
  # Attempt to enable (start on boot) and start the service
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
  # Check status again
  if sudo systemctl is-active --quiet postgresql; then
    echo "PostgreSQL service started successfully."
  else
    echo "ERROR: Failed to start PostgreSQL service. Please check logs: sudo journalctl -u postgresql"
    exit 1
  fi
fi

# --- Script End ---
echo "-------------------------------------------"
echo "PostgreSQL Installation completed successfully!"
echo "Next steps typically involve creating users and databases (e.g., running setup_postgres.sh)."
echo "-------------------------------------------"

exit 0