#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e
# Treat unset variables as an error (optional but good practice)
# set -u
# Exit on error within pipes (optional but good practice)
# set -o pipefail

# --- Configuration Variables ---
DB_NAME="${PG_DB:-rdap_cache}"
DB_USER="${PG_USER:-rdap_user}"
DB_PASSWORD="${PG_PASSWORD:-$(openssl rand -base64 16)}"

# --- Script Start ---
echo "-------------------------------------------"
echo "Starting PostgreSQL User/Database Setup..."
echo "Target Database: $DB_NAME"
echo "Target User:     $DB_USER"
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

# --- 1. Set postgres superuser password ---
echo "Setting password for the 'postgres' superuser..."
read -s -p "Enter new password for the 'postgres' user (leave blank to skip): " POSTGRES_PASSWORD
echo
if [ -z "$POSTGRES_PASSWORD" ]; then
  echo "No password entered. Skipping password change for 'postgres' user."
else
  sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" > /dev/null
  if [ $? -eq 0 ]; then
    echo "'postgres' user password successfully updated."
  else
    echo "ERROR: Failed to update 'postgres' user password."
  fi
fi
echo "-------------------------------------------"
sleep 1

# --- 2. Create Application User and Database ---
echo "Configuring application database '$DB_NAME' and user '$DB_USER'..."

# --- Create User (Idempotent using DO block - this is allowed) ---
sudo -u postgres psql -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD'; ELSE RAISE NOTICE 'User \"$DB_USER\" already exists, skipping creation.'; END IF; END \$\$;"

# --- Create Database (Idempotent using shell check - CREATE DATABASE cannot be in DO block) ---
# Check if database exists using psql command
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")

if [ "$DB_EXISTS" = "1" ]; then
    echo "Database \"$DB_NAME\" already exists, skipping creation."
else
    echo "Creating database \"$DB_NAME\"..."
    # Use psql -c or createdb utility
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME"
    # Optional: Add error check specifically for database creation
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to create database \"$DB_NAME\"."
        exit 1
    fi
fi

# --- 3. Grant Privileges ---
echo "Granting privileges to user '$DB_USER' on database '$DB_NAME'..."
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -c "ALTER USER $DB_USER CREATEDB;"
# Connect to the specific database to grant schema permissions
sudo -u postgres psql -d $DB_NAME -c "GRANT USAGE, CREATE ON SCHEMA public TO $DB_USER;"

# --- 4. Output Summary ---
echo "-------------------------------------------"
echo "PostgreSQL User/Database setup completed!"
echo ""
echo "Database Name: $DB_NAME"
echo "Username:      $DB_USER"
if [ -z "$PG_PASSWORD" ]; then
    echo "Generated App User Password: $DB_PASSWORD"
    echo "*** Store this password securely! It won't be shown again. ***"
    echo "*** Use this in your .env file's DATABASE_URL. ***"
fi
echo ""
echo "Example DATABASE_URL for .env file:"
echo "DATABASE_URL=\"postgresql://$DB_USER:<PASSWORD>@localhost:5432/$DB_NAME\""
echo "(Replace <PASSWORD> with the actual password)"
echo "-------------------------------------------"

exit 0