#!/bin/bash

set -e

APP_DIR="/srv/rdap-cache-service"        # Directory WHERE the app code IS
APP_NAME="rdap-cache-service"            # Name for the PM2 process (Updated for clarity)
NODE_ENV="production"                 # Set Node environment to production (CRUCIAL for Next.js build/start)
APP_USER="rdapapp"          # User to own the app files (defaults to the user who invoked sudo)
APP_GROUP=$(id -gn "$APP_USER")       # Group for the app user
# --- End Configuration ---

echo "--- Starting Next.js Application Setup (Simplified) ---"

echo "Using configuration:"
echo "  App Directory: $APP_DIR (Expected to exist)"
echo "  PM2 App Name: $APP_NAME"
echo "  Node Env: $NODE_ENV"
echo "  App User: $APP_USER"
echo "  App Group: $APP_GROUP"
echo ""

# --- Verify Application Directory Exists ---
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

# --- Install PM2 ---
echo "Installing/Updating PM2 globally..."
sudo npm install -g pm2
echo "PM2 installed."
echo ""

# --- Navigate to App Directory ---
echo "Changing to application directory: $APP_DIR"
cd "$APP_DIR" || exit 1

# --- Install Dependencies ---
echo "Installing Node.js dependencies (npm install)..."
# Run npm install as the application user
sudo -u "$APP_USER" npm install # Consider --omit=dev if devDependencies aren't needed for build/runtime
echo "Dependencies installed."
echo ""

# --- Build Step (CRUCIAL for Next.js) ---
echo "Running Next.js build (npm run build)..."
# Ensure jq is installed for parsing package.json (optional check, build will likely fail anyway if no build script)
if ! command -v jq &> /dev/null; then
    echo "jq not found, installing..."
    sudo apt update && sudo apt install -y jq
fi

# Check if build script exists, though for Next.js it's standard
if sudo -u "$APP_USER" jq -e '.scripts.build' package.json > /dev/null; then
    # Run build as the application user. This runs `next build`.
    sudo -u "$APP_USER" npm run build
    echo "Next.js build completed. Check for a '.next' directory."
else
    echo "WARNING: No 'build' script found in package.json. Next.js production start will likely fail."
    echo "Ensure your package.json has a 'build' script (e.g., 'next build')."
fi
echo ""

# --- Environment File (.env) ---
# Next.js uses .env.production, .env.local etc. This creates a base .env
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ] && [ ! -f "$APP_DIR/.env.production" ] && [ ! -f "$APP_DIR/.env.local" ]; then
    echo "Creating a sample .env file: $ENV_FILE (Consider using .env.production)"
    # Create as the app user
    sudo -u "$APP_USER" bash -c "cat > $ENV_FILE" <<EOF
# Environment variables for $APP_NAME
# Next.js has specific rules for env vars (.env.production, NEXT_PUBLIC_ prefix, etc.)
# See: https://nextjs.org/docs/basic-features/environment-variables
# Ensure this file (or .env*.local) is in your .gitignore!

NODE_ENV=$NODE_ENV
# PORT=3000 # Next.js default. Can be overridden via 'next start -p <port>' or PORT env var.

# Example: NEXT_PUBLIC_API_URL=https://api.example.com
# Example: DATABASE_URL=postgres://...

EOF
    echo "IMPORTANT: Populate $ENV_FILE (or preferably .env.production/.env.local) with your actual configuration secrets/variables."
else
    echo "Environment file (.env, .env.production, or .env.local) likely exists. Skipping creation."
    echo "Ensure necessary $NODE_ENV variables are defined according to Next.js conventions."
fi
echo ""

# --- Start Application with PM2 ---
echo "Starting/Restarting application '$APP_NAME' with PM2 using 'npm start'..."
# Change directory for PM2 context
cd "$APP_DIR" || exit 1

# Define ecosystem file content to run 'npm start'
ECOSYSTEM_FILE="$APP_DIR/ecosystem.config.js"
sudo -u "$APP_USER" bash -c "cat > $ECOSYSTEM_FILE" <<EOF
module.exports = {
  apps : [{
    name   : "$APP_NAME",
    // Execute 'npm' with argument 'start'
    script : "npm",
    args   : "start",
    // Set the working directory for npm
    cwd    : "$APP_DIR",
    // Ensure NODE_ENV is set for the child process (npm start -> next start)
    env_production: {
       NODE_ENV: "$NODE_ENV"
       // You can add other env vars here if needed, though .env files are preferred
       // PORT: 3000 // Example if you want PM2 to control the port via env var
    }
    // Add other PM2 options here if needed
    // instances : "max", // Enable clustering (check Next.js docs for compatibility/need)
    // exec_mode : "cluster",
  }]
}
EOF
echo "Created PM2 ecosystem file: $ECOSYSTEM_FILE"

# Stop/Delete existing process before starting
sudo -u "$APP_USER" pm2 stop "$ECOSYSTEM_FILE" --env $NODE_ENV || true
sudo -u "$APP_USER" pm2 delete "$APP_NAME" || true

# Start using the ecosystem file
sudo -u "$APP_USER" pm2 start "$ECOSYSTEM_FILE" --env $NODE_ENV

echo "Application '$APP_NAME' started via PM2 (npm start)."
echo ""

# --- Configure PM2 Startup Hook ---
echo "Configuring PM2 to start automatically on system boot..."
# Generate startup script command for systemd, running as APP_USER
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

# Save the current process list managed by PM2 for the user
sudo -u "$APP_USER" pm2 save --force
echo "PM2 process list saved."
echo ""

# --- Final Status ---
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