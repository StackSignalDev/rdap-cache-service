#!/bin/bash

set -e
set -u
set -o pipefail

NODE_MAJOR=22

echo "Updating package list (apt update)..."
sudo apt update -y
echo "Ensuring necessary packages for adding repo are installed (curl, gpg)..."
sudo apt install -y curl gpg apt-transport-https ca-certificates

KEYRING_DIR="/etc/apt/keyrings"
KEYRING_PATH="${KEYRING_DIR}/nodesource.gpg"
SOURCE_LIST="/etc/apt/sources.list.d/nodesource.list"

echo "Creating keyring directory: ${KEYRING_DIR}..."
sudo mkdir -p "${KEYRING_DIR}"

echo "Downloading and adding NodeSource GPG key to ${KEYRING_PATH}..."
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o "${KEYRING_PATH}"

echo "Adding NodeSource repository definition to ${SOURCE_LIST}..."
ARCH=$(dpkg --print-architecture)
echo "deb [signed-by=${KEYRING_PATH} arch=${ARCH}] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | sudo tee "${SOURCE_LIST}" > /dev/null

echo "Updating package list again after adding NodeSource repo..."
sudo apt update -y

echo "Installing Node.js..."
sudo apt install nodejs -y
sudo npm install -g npm@latest

echo "Verifying Node.js installation..."
NODE_VERSION=$(node -v || echo "Node not found")
NPM_VERSION=$(npm -v || echo "npm not found")

echo "Node.js version: ${NODE_VERSION}"
echo "npm version:     ${NPM_VERSION}"

if [[ "$NODE_VERSION" == "Node not found" ]] || [[ "$NPM_VERSION" == "npm not found" ]]; then
    echo "ERROR: Node.js or npm installation failed."
    exit 1
fi

if [[ ! "$NODE_VERSION" =~ ^v${NODE_MAJOR}\. ]]; then
    echo "WARNING: Installed Node.js version ($NODE_VERSION) does not match the expected major version ($NODE_MAJOR)."
fi

echo "-------------------------------------------"
echo "Node.js v${NODE_MAJOR}.x Installation completed successfully!"
echo "-------------------------------------------"

exit 0