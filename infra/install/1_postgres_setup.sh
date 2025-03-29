#!/bin/bash

set -e
# set -u # Cannot use set -u because of PG_PASSWORD default expansion
set -o pipefail

DB_NAME="${PG_DB:-rdap_cache}"
DB_USER="${PG_USER:-rdap_user}"
# Generate raw password first
RAW_DB_PASSWORD="${PG_PASSWORD:-$(openssl rand -base64 16)}"
APP_DIR=$(pwd) # Assumes script is run from app root

echo "-------------------------------------------"
echo "Starting PostgreSQL User/Database Setup..."
echo "Target Database: $DB_NAME"
echo "Target User:     $DB_USER"
echo "App Directory:   $APP_DIR"
if [ -z "$PG_PASSWORD" ]; then
  echo "App User PW:   *** A random password will be generated ***"
else
  echo "App User PW:   *** Using provided \$PG_PASSWORD ***"
fi
echo "-------------------------------------------"
sleep 2

# --- Check prerequisites ---
if ! command -v psql &> /dev/null; then
    echo "ERROR: 'psql' command not found..."
    exit 1
fi
if ! command -v jq &> /dev/null; then
    echo "jq command not found, installing..."
    sudo apt-get update -y && sudo apt-get install -y jq || { echo "ERROR: Failed to install jq."; exit 1; }
    echo "jq installed."
fi
echo ""


echo "Configuring application database '$DB_NAME' and user '$DB_USER'..."

# Create user with the RAW password
sudo -u postgres psql -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN CREATE USER $DB_USER WITH PASSWORD '$RAW_DB_PASSWORD'; ELSE RAISE NOTICE 'User \"$DB_USER\" already exists, skipping creation.'; END IF; END \$\$;"

# Create DB if not exists
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")
if [ "$DB_EXISTS" = "1" ]; then
    echo "Database \"$DB_NAME\" already exists, skipping creation."
else
    echo "Creating database \"$DB_NAME\"..."
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME" || { echo "ERROR: Failed to create database \"$DB_NAME\"."; exit 1; }
fi

echo "Granting privileges to user '$DB_USER' on database '$DB_NAME'..."
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -c "ALTER USER $DB_USER CREATEDB;"
sudo -u postgres psql -d $DB_NAME -c "GRANT USAGE, CREATE ON SCHEMA public TO $DB_USER;"

ENV_FILE="$APP_DIR/.env"
echo "-------------------------------------------"
echo "Creating/Updating .env file: $ENV_FILE"

# --- URL-Encode the password for the connection string ---
ENCODED_DB_PASSWORD=$(jq -nr --arg pw "$RAW_DB_PASSWORD" '$pw|@uri')
echo "URL Encoded Password generated."
# --- Construct the DATABASE_URL with the encoded password ---
DATABASE_URL="postgresql://${DB_USER}:${ENCODED_DB_PASSWORD}@localhost:5432/${DB_NAME}"

if [ -f "$ENV_FILE" ]; then
    echo "WARNING: $ENV_FILE already exists. Database URL not automatically added/updated."
    echo "         Please manually ensure the following line is correct in $ENV_FILE:"
    echo "         DATABASE_URL=\"${DATABASE_URL}\"" # Log the correctly encoded URL
else
    echo "Creating $ENV_FILE..."
    # Use printf to avoid issues with special characters in the URL itself
    printf "DATABASE_URL=\"%s\"\n" "${DATABASE_URL}" > "$ENV_FILE"

    APP_SETUP_USER="rdapapp" # Ensure this matches the user defined in EC2 UserData
    echo "Setting ownership of $ENV_FILE to ${APP_SETUP_USER}..."
    sudo chown "${APP_SETUP_USER}:${APP_SETUP_USER}" "$ENV_FILE" # Quote variables

    echo "Setting permissions of $ENV_FILE to 600..."
    sudo chmod 600 "$ENV_FILE"
    echo "$ENV_FILE created successfully with DATABASE_URL."
fi


echo "-------------------------------------------"
echo "PostgreSQL User/Database setup completed!"
echo ""
echo "Database Name: $DB_NAME"
echo "Username:      $DB_USER"
if [ -z "$PG_PASSWORD" ]; then
    echo "Generated App User Password (Raw): $RAW_DB_PASSWORD" # Log raw for reference if needed
    echo "*** DATABASE_URL (with URL-encoded password) written to $ENV_FILE ***"
    echo "*** (Unless the file already existed) ***"
else
    echo "App User Password: (Used password from \$PG_PASSWORD environment variable - Ensure it's URL-encoded in .env if it has special chars!)"
    echo "*** Ensure DATABASE_URL with the correctly encoded password is set in $ENV_FILE ***"
fi
echo ""
echo "Review the contents of $ENV_FILE to ensure DATABASE_URL is correct."
echo "-------------------------------------------"

exit 0