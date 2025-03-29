#!/bin/bash

set -e
set -o pipefail

S3_BUCKET_NAME="rdap-cache-db-backups"
BACKUP_FILENAME="rdap_cache_backup.dump.gz"
APP_DIR="/srv/rdap-cache-service"
ENV_FILE="${APP_DIR}/.env"
TMP_DIR="/tmp"

echo "--- Starting Database Restore Script ---"
echo "Target S3 Bucket: s3://${S3_BUCKET_NAME}"
echo "Target Backup File: ${BACKUP_FILENAME}"
echo "Application Directory: ${APP_DIR}"
echo "Env File: ${ENV_FILE}"
echo "Temp Directory: ${TMP_DIR}"
echo ""

# --- Ensure necessary tools are installed ---
echo "Checking for required tools (aws, psql, pg_restore, gunzip)..."
if ! command -v aws &> /dev/null; then
    echo "'aws' command not found. Attempting to install awscli..."
    sudo apt-get update -y
    sudo apt-get install -y awscli
    if ! command -v aws &> /dev/null; then
        echo "ERROR: Failed to install awscli."
        exit 1
    fi
    echo "awscli installed successfully."
else
    echo "'aws' command found."
fi

if ! command -v psql &> /dev/null || ! command -v pg_restore &> /dev/null; then
    echo "ERROR: 'psql' or 'pg_restore' not found. Ensure postgresql-client is installed."
    echo "Hint: Check logs for 0_postgres_install.sh"
    exit 1
else
    echo "'psql' and 'pg_restore' commands found."
fi

if ! command -v gunzip &> /dev/null && [[ "$BACKUP_FILENAME" == *.gz ]]; then
     echo "'gunzip' command not found, but backup seems compressed. Attempting to install..."
     sudo apt-get update -y
     sudo apt-get install -y gzip # Installs gunzip
     if ! command -v gunzip &> /dev/null; then
        echo "ERROR: Failed to install gzip (for gunzip)."
        exit 1
     fi
     echo "gzip installed successfully."
elif [[ "$BACKUP_FILENAME" == *.gz ]]; then
    echo "'gunzip' command found."
fi
echo ""

# --- Read Database Credentials from .env ---
echo "Reading DATABASE_URL from ${ENV_FILE}..."
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: Environment file ${ENV_FILE} not found!"
    echo "       Cannot proceed without database connection details."
    exit 1
fi

DATABASE_URL_LINE=$(grep '^DATABASE_URL=' "$ENV_FILE" || true) # Get the line, allow grep to fail gracefully if not found
if [ -z "$DATABASE_URL_LINE" ]; then
    echo "ERROR: DATABASE_URL not found in ${ENV_FILE}."
    exit 1
fi
# Extract the value part (remove DATABASE_URL=" and trailing quote)
DATABASE_URL=$(echo "$DATABASE_URL_LINE" | sed -e 's/^DATABASE_URL=//' -e 's/^"//' -e 's/"$//')
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: Failed to parse DATABASE_URL value from ${ENV_FILE}."
    exit 1
fi
echo "Successfully read DATABASE_URL."
echo ""

# --- Define paths and cleanup ---
LOCAL_BACKUP_GZ_PATH="${TMP_DIR}/${BACKUP_FILENAME}" # Path if downloaded as .gz
LOCAL_BACKUP_PATH="${LOCAL_BACKUP_GZ_PATH%.gz}"     # Path after potential decompression
RESTORE_FILE_PATH=""                                # Will point to the file pg_restore uses

cleanup() {
    echo "Cleaning up temporary files..."
    rm -f "${LOCAL_BACKUP_GZ_PATH}"
    rm -f "${LOCAL_BACKUP_PATH}"
    echo "Cleanup finished."
}
trap cleanup EXIT

echo "Downloading backup file from S3..."
if ! aws s3 cp "s3://${S3_BUCKET_NAME}/${BACKUP_FILENAME}" "${LOCAL_BACKUP_GZ_PATH}"; then
    echo "Failed to download backup file from s3://${S3_BUCKET_NAME}/${BACKUP_FILENAME}"
    exit 0
fi
echo "Backup file downloaded successfully to ${LOCAL_BACKUP_GZ_PATH}"
echo ""

# --- Decompress if necessary ---
if [[ "$BACKUP_FILENAME" == *.gz ]]; then
    echo "Decompressing backup file..."
    if ! gunzip -f "${LOCAL_BACKUP_GZ_PATH}"; then
        echo "ERROR: Failed to decompress ${LOCAL_BACKUP_GZ_PATH}"
        exit 1
    fi
    RESTORE_FILE_PATH="${LOCAL_BACKUP_PATH}"
    echo "File decompressed successfully to ${RESTORE_FILE_PATH}"
else
    RESTORE_FILE_PATH="${LOCAL_BACKUP_GZ_PATH}"
    echo "Backup file does not appear to be gzipped."
fi
echo ""

echo "Starting database restore using pg_restore..."
echo "Target Database URL (password omitted): ${DATABASE_URL//:[^@]*@/:********@}"

if pg_restore --verbose --clean --if-exists -d "${DATABASE_URL}" "${RESTORE_FILE_PATH}"; then
    echo "Database restore completed successfully."
else
    echo "ERROR: Database restore failed. Check pg_restore output above."
    exit 1
fi
echo ""

exit 0