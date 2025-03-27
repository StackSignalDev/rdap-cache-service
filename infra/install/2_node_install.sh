#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e
# Treat unset variables as an error
set -u
# Exit on error within pipes
set -o pipefail

# --- Configuration ---
NODE_MAJOR=22 # Specify the major Node.js version (LTS)

# --- Script Start ---
echo "-------------------------------------------"
echo "Starting Node.js v${NODE_MAJOR}.x Installation..."
echo "-------------------------------------------"

# --- 1. Prerequisite Check & Update ---
echo "Updating package list (apt update)..."
sudo apt update -y
echo "Ensuring necessary packages for adding repo are installed (curl, gpg)..."
# These should already be installed by UserData, but doesn't hurt to ensure
sudo apt install -y curl gpg apt-transport-https ca-certificates

# --- 2. Add NodeSource Repository ---
KEYRING_DIR="/etc/apt/keyrings"
KEYRING_PATH="${KEYRING_DIR}/nodesource.gpg"
SOURCE_LIST="/etc/apt/sources.list.d/nodesource.list"

echo "Creating keyring directory: ${KEYRING_DIR}..."
sudo mkdir -p "${KEYRING_DIR}"

echo "Downloading and adding NodeSource GPG key to ${KEYRING_PATH}..."
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o "${KEYRING_PATH}"

echo "Adding NodeSource repository definition to ${SOURCE_LIST}..."
# Ensure correct architecture is detected (usually amd64 on EC2)
ARCH=$(dpkg --print-architecture)
echo "deb [signed-by=${KEYRING_PATH} arch=${ARCH}] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | sudo tee "${SOURCE_LIST}" > /dev/null

# --- 3. Install Node.js ---
echo "Updating package list again after adding NodeSource repo..."
sudo apt update -y

echo "Installing Node.js..."
# This will install nodejs and npm from the NodeSource repository
sudo apt install nodejs -y

# --- 4. Verify Installation ---
echo "Verifying Node.js installation..."
NODE_VERSION=$(node -v || echo "Node not found")
NPM_VERSION=$(npm -v || echo "npm not found")

echo "Node.js version: ${NODE_VERSION}"
echo "npm version:     ${NPM_VERSION}"

if [[ "$NODE_VERSION" == "Node not found" ]] || [[ "$NPM_VERSION" == "npm not found" ]]; then
    echo "ERROR: Node.js or npm installation failed."
    exit 1
fi
# Optional: Check if the major version matches
if [[ ! "$NODE_VERSION" =~ ^v${NODE_MAJOR}\. ]]; then
    echo "WARNING: Installed Node.js version ($NODE_VERSION) does not match the expected major version ($NODE_MAJOR)."
fi


# --- Script End ---
echo "-------------------------------------------"
echo "Node.js v${NODE_MAJOR}.x Installation completed successfully!"
echo "-------------------------------------------"

exit 0