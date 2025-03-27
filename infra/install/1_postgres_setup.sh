#!/bin/bash

set -e
set -o pipefail

# --- Configuration Variables ---
DB_NAME="${PG_DB:-rdap_cache}"
DB_USER="${PG_USER:-rdap_user}"
DB_PASSWORD="${PG_PASSWORD:-$(openssl rand -base64 16)}"
# Assume script is run from the application root directory
APP_DIR=$(pwd)

# --- Script Start ---
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

# --- Prerequisite Check ---
if ! command -v psql &> /dev/null
then
    echo "ERROR: 'psql' command not found. Please ensure PostgreSQL client is installed."
    echo "Hint: Run 0_postgres_install.sh first."
    exit 1
fi
if [ ! -f "$APP_DIR/package.json" ]; then
    echo "WARNING: Cannot find package.json in the current directory ($APP_DIR)."
    echo "         Make sure you are running this script from the application root."
    # Optionally exit 1 here if this is critical
fi

# --- 2. Create Application User and Database ---
echo "Configuring application database '$DB_NAME' and user '$DB_USER'..."

# Create User (Idempotent using DO block)
sudo -u postgres psql -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD'; ELSE RAISE NOTICE 'User \"$DB_USER\" already exists, skipping creation.'; END IF; END \$\$;"

# Create Database (Idempotent using shell check)
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

# --- 3. Grant Privileges ---
echo "Granting privileges to user '$DB_USER' on database '$DB_NAME'..."
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -c "ALTER USER $DB_USER CREATEDB;"
sudo -u postgres psql -d $DB_NAME -c "GRANT USAGE, CREATE ON SCHEMA public TO $DB_USER;"

# --- 4. Create .env file ---
ENV_FILE="$APP_DIR/.env"
echo "-------------------------------------------"
echo "Creating/Updating .env file: $ENV_FILE"

# Construct DATABASE_URL carefully
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

# Create .env file if it doesn't exist, or update specific variables if it does
if [ -f "$ENV_FILE" ]; then
    echo "WARNING: $ENV_FILE already exists. Database URL not automatically added/updated."
    echo "         Please manually ensure the following line is correct in $ENV_FILE:"
    echo "         DATABASE_URL=\"${DATABASE_URL}\""
    # Removed PORT warning
else
    echo "Creating $ENV_FILE..."
    # Use printf for safer handling of the URL
    printf "DATABASE_URL=\"%s\"\n" "${DATABASE_URL}" > "$ENV_FILE"
    # Removed PORT printf
    # Add other default environment variables here if needed (but likely not in this script)

    # Set ownership to the application user
    APP_SETUP_USER="rdapapp" # Make sure this matches the user created by UserData
    echo "Setting ownership of $ENV_FILE to ${APP_SETUP_USER}..."
    sudo chown ${APP_SETUP_USER}:${APP_SETUP_USER} "$ENV_FILE"

    # Set permissions (read/write for owner only)
    echo "Setting permissions of $ENV_FILE to 600..."
    sudo chmod 600 "$ENV_FILE"
    echo "$ENV_FILE created successfully with DATABASE_URL."
fi


# --- 5. Output Summary ---
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