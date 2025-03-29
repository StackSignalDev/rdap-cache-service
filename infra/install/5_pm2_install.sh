#!/bin/bash

set -e
set -u
set -o pipefail

APP_DIR="/srv/rdap-cache-service"
APP_NAME="rdap-cache-service"
NODE_ENV="production"
APP_USER="rdapapp"
APP_GROUP=$(id -gn "$APP_USER")

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

echo "Installing/Updating PM2 globally..."
sudo npm install -g pm2
echo "PM2 installed."
echo ""

echo "Changing to application directory: $APP_DIR"
cd "$APP_DIR" || exit 1


ENV_FILE="$APP_DIR/.env"
echo "Checking for essential .env file expected from 1_postgres_setup.sh: $ENV_FILE"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: Main .env file ($ENV_FILE) not found!"
    echo "       This file should contain DATABASE_URL and be created by the 1_postgres_setup.sh script."
    echo "       The application build or start will likely fail without it."
    echo "       Check the logs for 1_postgres_setup.sh."
    exit 1
else
    echo ".env file found."
fi
echo ""


echo "Running Next.js build (npm run build)..."
if ! command -v jq &> /dev/null; then
    echo "jq command not found, attempting to install..."
    sudo apt-get update && sudo apt-get install -y jq
    if ! command -v jq &> /dev/null; then
         echo "ERROR: Failed to install jq. Cannot reliably check for build script."
         exit 1
    fi
    echo "jq installed successfully."
fi

if sudo -u "$APP_USER" jq -e '.scripts.build' package.json > /dev/null; then
    if sudo -u "$APP_USER" npm run build; then
        echo "Next.js build completed successfully. Check for a '.next' directory."
    else
        echo "ERROR: 'npm run build' failed. Check the build logs above."
        exit 1
    fi
else
    echo "ERROR: No 'build' script found in package.json. Cannot create production build."
    exit 1
fi
echo ""


echo "Starting/Restarting application '$APP_NAME' with PM2 using 'npm start'..."
# Ensure we are still in the correct directory
cd "$APP_DIR" || exit 1

ECOSYSTEM_FILE="$APP_DIR/ecosystem.config.js"
# Create ecosystem file as app user
sudo -u "$APP_USER" bash -c "cat > $ECOSYSTEM_FILE" <<EOF
module.exports = {
  apps : [{
    name   : "$APP_NAME",
    script : "npm",
    args   : "start", // Assumes 'npm start' runs 'next start'
    cwd    : "$APP_DIR",
    // PM2 can inject environment variables, but Next.js prefers .env files
    // Setting NODE_ENV here is still good practice for PM2 itself.
    env_production: {
       NODE_ENV: "$NODE_ENV"
    }
    // Consider adding 'instances', 'exec_mode', 'max_memory_restart' later
  }]
}
EOF
echo "Created PM2 ecosystem file: $ECOSYSTEM_FILE"

echo "Stopping/Deleting previous PM2 instance '$APP_NAME' (if any)..."
sudo -u "$APP_USER" pm2 stop "$ECOSYSTEM_FILE" --silent --env $NODE_ENV || true # --silent hides "not found" errors
sudo -u "$APP_USER" pm2 delete "$ECOSYSTEM_FILE" --silent || true

echo "Starting application '$APP_NAME' with PM2..."
if sudo -u "$APP_USER" pm2 start "$ECOSYSTEM_FILE" --env $NODE_ENV; then
    echo "Application '$APP_NAME' started via PM2 (using 'npm start')."
else
    echo "ERROR: Failed to start application '$APP_NAME' with PM2."
    echo "Check PM2 logs: sudo -u $APP_USER pm2 logs $APP_NAME"
    exit 1
fi
echo ""

echo "Configuring PM2 to start automatically on system boot..."
STARTUP_CMD_LINE=$(sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | grep 'sudo env PATH=')

if [ -n "$STARTUP_CMD_LINE" ]; then
    echo "Running the following command as root to enable PM2 systemd service:"
    echo "$STARTUP_CMD_LINE"
    if eval "$STARTUP_CMD_LINE"; then
      echo "PM2 systemd service configured successfully."
    else
      echo "ERROR: Failed to execute PM2 startup command. Systemd service may not be enabled."
    fi
else
    echo "WARNING: Could not automatically determine the PM2 startup command."
    echo "         You may need to run 'pm2 startup' manually and execute the command it provides."
fi

echo "Saving current PM2 process list..."
if sudo -u "$APP_USER" pm2 save --force; then
    echo "PM2 process list saved."
else
    echo "ERROR: Failed to save PM2 process list."
fi
echo ""