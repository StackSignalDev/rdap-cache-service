#!/bin/bash

set -e
set -o pipefail

DB_NAME="${PG_DB:-rdap_cache}"
DB_USER="${PG_USER:-rdap_user}"
DB_PASSWORD="${PG_PASSWORD:-$(openssl rand -base64 16)}"
APP_DIR=$(pwd)

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

if ! command -v psql &> /dev/null
then
    echo "ERROR: 'psql' command not found. Please ensure PostgreSQL client is installed."
    echo "Hint: Run 0_postgres_install.sh first."
    exit 1
fi
if [ ! -f "$APP_DIR/package.json" ]; then
    echo "WARNING: Cannot find package.json in the current directory ($APP_DIR)."
    echo "         Make sure you are running this script from the application root."
fi

echo "Configuring application database '$DB_NAME' and user '$DB_USER'..."

sudo -u postgres psql -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD'; ELSE RAISE NOTICE 'User \"$DB_USER\" already exists, skipping creation.'; END IF; END \$\$;"

DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")
if [ "$DB_EXISTS" = "1" ]; then
    echo "Database \"$DB_NAME\" already exists, skipping creation."
else
    echo "Creating database \"$DB_NAME\"..."
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME"
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to create database \"$DB_NAME\"."
        exit 1
    fi
fi

echo "Granting privileges to user '$DB_USER' on database '$DB_NAME'..."
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -c "ALTER USER $DB_USER CREATEDB;"
sudo -u postgres psql -d $DB_NAME -c "GRANT USAGE, CREATE ON SCHEMA public TO $DB_USER;"

if ! command -v jq &> /dev/null; then
    echo "jq command not found, installing..."
    sudo apt-get update -y && sudo apt-get install -y jq || { echo "ERROR: Failed to install jq."; exit 1; }
    echo "jq installed."
fi
echo ""

ENV_FILE="$APP_DIR/.env"
echo "-------------------------------------------"
echo "Creating/Updating .env file: $ENV_FILE"

ENCODED_DB_PASSWORD=$(jq -nr --arg pw "$RAW_DB_PASSWORD" '$pw|@uri')
echo "URL Encoded Password generated."
DATABASE_URL="postgresql://${DB_USER}:${ENCODED_DB_PASSWORD}@localhost:5432/${DB_NAME}"

if [ -f "$ENV_FILE" ]; then
    echo "WARNING: $ENV_FILE already exists. Database URL not automatically added/updated."
    echo "         Please manually ensure the following line is correct in $ENV_FILE:"
    echo "         DATABASE_URL=\"${DATABASE_URL}\""
else
    echo "Creating $ENV_FILE..."
    printf "DATABASE_URL=\"%s\"\n" "${DATABASE_URL}" > "$ENV_FILE"

    APP_SETUP_USER="rdapapp"
    echo "Setting ownership of $ENV_FILE to ${APP_SETUP_USER}..."
    sudo chown ${APP_SETUP_USER}:${APP_SETUP_USER} "$ENV_FILE"

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
    echo "Generated App User Password: $DB_PASSWORD"
    echo "*** DATABASE_URL written to $ENV_FILE ***"
    echo "*** (Unless the file already existed) ***"
else
    echo "App User Password: (Used password from \$PG_PASSWORD environment variable)"
    echo "*** Ensure DATABASE_URL with this password is correctly set in $ENV_FILE ***"
fi
echo ""
echo "Review the contents of $ENV_FILE to ensure DATABASE_URL is correct."
echo "-------------------------------------------"

exit 0