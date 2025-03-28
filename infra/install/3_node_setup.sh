#!/bin/bash

set -e

APP_DIR="/srv/rdap-cache-service"
APP_NAME="rdap-cache-service"
NODE_ENV="production"
APP_USER="rdapapp"
APP_GROUP=$(id -gn "$APP_USER")

echo "--- Starting Next.js Application Setup (Simplified) ---"

echo "Using configuration:"
echo "  App Directory: $APP_DIR (Expected to exist)"
echo "  PM2 App Name: $APP_NAME"
echo "  Node Env: $NODE_ENV"
echo "  App User: $APP_USER"
echo "  App Group: $APP_GROUP"
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

echo "Installing/Updating PM2 globally..."
sudo npm install -g pm2
echo "PM2 installed."
echo ""

echo "Changing to application directory: $APP_DIR"
cd "$APP_DIR" || exit 1

echo "Installing Node.js dependencies (npm install)..."
sudo -u "$APP_USER" npm install
echo "Dependencies installed."
echo ""

echo "Running Next.js build (npm run build)..."
if ! command -v jq &> /dev/null; then
    echo "jq not found, installing..."
    sudo apt update && sudo apt install -y jq
fi

if sudo -u "$APP_USER" jq -e '.scripts.build' package.json > /dev/null; then
    sudo -u "$APP_USER" npm run build
    echo "Next.js build completed. Check for a '.next' directory."
else
    echo "WARNING: No 'build' script found in package.json. Next.js production start will likely fail."
    echo "Ensure your package.json has a 'build' script (e.g., 'next build')."
fi
echo ""

ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ] && [ ! -f "$APP_DIR/.env.production" ] && [ ! -f "$APP_DIR/.env.local" ]; then
    echo "Creating a sample .env file: $ENV_FILE (Consider using .env.production)"
    sudo -u "$APP_USER" bash -c "cat > $ENV_FILE" <<EOF


NODE_ENV=$NODE_ENV

EOF
    echo "IMPORTANT: Populate $ENV_FILE (or preferably .env.production/.env.local) with your actual configuration secrets/variables."
else
    echo "Environment file (.env, .env.production, or .env.local) likely exists. Skipping creation."
    echo "Ensure necessary $NODE_ENV variables are defined according to Next.js conventions."
fi
echo ""

echo "Starting/Restarting application '$APP_NAME' with PM2 using 'npm start'..."
cd "$APP_DIR" || exit 1

ECOSYSTEM_FILE="$APP_DIR/ecosystem.config.js"
sudo -u "$APP_USER" bash -c "cat > $ECOSYSTEM_FILE" <<EOF
module.exports = {
  apps : [{
    name   : "$APP_NAME",
    script : "npm",
    args   : "start",
    cwd    : "$APP_DIR",
    env_production: {
       NODE_ENV: "$NODE_ENV"
    }
  }]
}
EOF
echo "Created PM2 ecosystem file: $ECOSYSTEM_FILE"

sudo -u "$APP_USER" pm2 stop "$ECOSYSTEM_FILE" --env $NODE_ENV || true
sudo -u "$APP_USER" pm2 delete "$APP_NAME" || true

sudo -u "$APP_USER" pm2 start "$ECOSYSTEM_FILE" --env $NODE_ENV

echo "Application '$APP_NAME' started via PM2 (npm start)."
echo ""

echo "Configuring PM2 to start automatically on system boot..."
STARTUP_CMD=$(sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | grep 'sudo env PATH=')

if [ -n "$STARTUP_CMD" ]; then
    echo "Running the following command to enable PM2 startup:"
    echo "$STARTUP_CMD"
    eval "$STARTUP_CMD"
    echo "PM2 startup configured."
else
    echo "WARNING: Could not automatically determine the PM2 startup command."
    echo "You may need to run 'pm2 startup' manually and execute the command it provides."
fi

sudo -u "$APP_USER" pm2 save --force
echo "PM2 process list saved."
echo ""

echo "--- Next.js Application Setup Summary (Simplified) ---"
echo "Application '$APP_NAME' should be running under PM2 (using 'npm start')."
echo "Run 'sudo -u $APP_USER pm2 list' or 'sudo -u $APP_USER pm2 status' to check."
echo "Run 'sudo -u $APP_USER pm2 logs $APP_NAME' to view logs."
echo ""
echo "--- NEXT STEPS ---"
echo "1.  VERIFY APP STATUS: Check PM2 list/status and logs. Ensure it didn't crash."
echo "2.  CONFIGURE ENV VARS: Ensure '.env.production' or similar has required variables (check Next.js docs!)."
echo "3.  RUN CADDY SETUP: Execute '4_caddy_install.sh' (if not done already)."
echo "4.  CADDY CONFIG: Ensure Caddy ('/etc/caddy/Caddyfile') is configured to reverse proxy to your Next.js app's port (default is 3000, check your app/.env/package.json)."
echo "5.  FIREWALL: Ensure ports 80/443 are open in EC2 Security Group and UFW."
echo "6.  TEST: Access your application via the domain/IP configured in Caddy."
echo ""
echo "--- Script Finished ---"