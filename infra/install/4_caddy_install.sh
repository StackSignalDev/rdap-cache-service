#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
NODE_APP_PORT="3000" # Default port your Node.js app listens on
CADDYFILE_PATH="/etc/caddy/Caddyfile"
METADATA_URL="http://169.254.169.254/latest/meta-data/public-ipv4"
# --- End Configuration ---

echo "--- Starting Caddy Installation for Ubuntu ---"

# --- Attempt to Fetch Public IP ---
echo "Attempting to fetch EC2 public IP address..."
# Use curl with a timeout. -s for silent.
PUBLIC_IP=$(curl -s --connect-timeout 5 "$METADATA_URL")

if [ -z "$PUBLIC_IP" ]; then
    echo "WARNING: Could not automatically fetch public IP address from metadata service."
    echo "Using placeholder 'YOUR_DOMAIN_OR_IP'. You MUST edit the Caddyfile manually."
    ADDRESS_PLACEHOLDER="YOUR_DOMAIN_OR_IP"
else
    echo "Successfully fetched public IP: $PUBLIC_IP"
    ADDRESS_PLACEHOLDER="$PUBLIC_IP"
fi
echo "" # Newline for readability

# --- Install Dependencies and Add Caddy Repository ---
echo "Updating package list and installing dependencies..."
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl

echo "Adding Caddy GPG key..."
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

echo "Adding Caddy repository..."
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null

# --- Install Caddy ---
echo "Updating package list again and installing Caddy..."
sudo apt update
sudo apt install -y caddy

echo "Caddy installation completed."

# --- Create/Overwrite Basic Caddyfile ---
echo "Creating basic Caddyfile at $CADDYFILE_PATH using fetched IP (or placeholder)..."
# Use the fetched IP or the placeholder if fetching failed.
sudo bash -c "cat > $CADDYFILE_PATH" <<EOF
# --- Caddyfile ---
# Automatically populated with Public IP: $ADDRESS_PLACEHOLDER
# IMPORTANT:
# 1. If this IP is incorrect or you want to use a domain name, EDIT this line.
# 2. Caddy will serve over HTTP for IP addresses. For automatic HTTPS, use a domain name.

http://$ADDRESS_PLACEHOLDER {
    # Reverse proxy requests to the Node.js app running on localhost
    reverse_proxy localhost:${NODE_APP_PORT}

    # Optional: Enable compression
    encode gzip zstd

    # Optional: Basic logging
    log {
        output file /var/log/caddy/access.log
        format json
    }

    # Optional: Recommended security headers (uncomment if needed)
    # header {
    #    # Enable HTTP Strict Transport Security (HSTS) - Only use with HTTPS/Domains!
    #    # Strict-Transport-Security "max-age=31536000;"
    #    # Enable cross-site scripting (XSS) protection
    #    # X-Xss-Protection "1; mode=block"
    #    # Prevent MIME-sniffing
    #    # X-Content-Type-Options "nosniff"
    #    # Prevent clickjacking
    #    # X-Frame-Options "DENY"
    #    # Control information shared in the Referer header
    #    # Referrer-Policy "strict-origin-when-cross-origin"
    # }
}

# --- End Caddyfile ---
EOF

echo "Basic Caddyfile created."
echo "VERIFY the address '$ADDRESS_PLACEHOLDER' in $CADDYFILE_PATH is correct."
echo "If you need HTTPS, you MUST replace the IP with your domain name."
echo "Edit with: sudo nano $CADDYFILE_PATH"
echo "(If your Node app uses a different port, change ${NODE_APP_PORT} too)."


# --- Enable and Start Caddy Service ---
echo "Enabling and starting Caddy service via systemd..."
sudo systemctl enable caddy
# Use restart instead of start to ensure it picks up the new config if Caddy was already running somehow
sudo systemctl restart caddy

# Give Caddy a moment to potentially apply config
sleep 3

# --- Display Status and Final Instructions ---
echo ""
echo "--- Caddy Installation Summary ---"
sudo systemctl status caddy --no-pager || echo "Warning: Could not get Caddy status."
echo ""
echo "--- NEXT STEPS ---"
echo "1.  VERIFY/EDIT THE CADDYFILE:"
echo "    sudo nano $CADDYFILE_PATH"
echo "    => Ensure the IP address '$ADDRESS_PLACEHOLDER' is correct."
echo "    => *** If you want HTTPS, replace the IP address with your domain name. ***"
echo "    => Adjust port '${NODE_APP_PORT}' if your Node app runs elsewhere."
echo ""
echo "2.  RELOAD CADDY CONFIGURATION (if you edited the file):"
echo "    sudo systemctl reload caddy"
echo ""
echo "3.  ENSURE FIREWALL / SECURITY GROUP IS OPEN:"
echo "    => Allow inbound traffic on TCP ports 80 and 443 in your EC2 Security Group."
echo "    => If using UFW (Ubuntu Firewall):"
echo "       sudo ufw allow http"
echo "       sudo ufw allow https"
echo "       sudo ufw reload  (or sudo ufw enable if not already enabled)"
echo ""
echo "4.  NODE.JS APP:"
echo "    => Make sure your Node.js application (from 2_node_install.sh context) is running and listening on localhost:${NODE_APP_PORT}."
echo "       (Use PM2 or similar to keep it running: pm2 start your_app.js)"
echo ""
echo "5.  TEST:"
echo "    => Access http://$ADDRESS_PLACEHOLDER in your browser."
echo "       (If you changed to a domain, access https://your.domain.com)."
echo ""
echo "6.  LOGS (if needed):"
echo "    => Check Caddy system logs: journalctl -u caddy --no-pager | less +G"
echo "    => Check Caddy access logs (if enabled in Caddyfile): /var/log/caddy/access.log"
echo ""
echo "--- Script Finished ---"