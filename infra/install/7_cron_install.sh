#!/bin/bash

set -e
set -u
set -o pipefail

S3_BACKUP_BUCKET_NAME="rdap-cache-db-backups"

DB_NAME="rdap_cache"
APP_DIR="/srv/rdap-cache-service" # Used for context, not directly in backup script
BACKUP_SCRIPT_PATH="/usr/local/bin/rdap_backup.sh"
CRON_JOB_FILE="/etc/cron.d/rdap-backup"
CRON_LOG_FILE="/var/log/rdap_backup_cron.log"
CRON_SCHEDULE="15 3 * * *" # Default: 3:15 AM every day


echo "Verifying required tools (aws, pg_dump, gzip)..."
if ! command -v aws &> /dev/null; then
    echo "WARNING: 'aws' command not found. Attempting installation (should have been done by restore script)."
    sudo apt-get update -y && sudo apt-get install -y awscli || { echo "ERROR: Failed to install awscli."; exit 1; }
else
    echo "'aws' found."
fi
if ! command -v pg_dump &> /dev/null; then
    echo "ERROR: 'pg_dump' not found. Ensure postgresql-client is installed."
    exit 1
else
    echo "'pg_dump' found."
fi
if ! command -v gzip &> /dev/null; then
    echo "WARNING: 'gzip' not found. Attempting installation."
     sudo apt-get update -y && sudo apt-get install -y gzip || { echo "ERROR: Failed to install gzip."; exit 1; }
else
    echo "'gzip' found."
fi
echo ""

# --- Create Backup Script ---
echo "Creating backup script at ${BACKUP_SCRIPT_PATH}..."

# Use sudo to write the script file owned by root, executable by all
sudo bash -c "cat > ${BACKUP_SCRIPT_PATH}" << EOF
#!/bin/bash
# This script performs the RDAP cache database backup and uploads it to S3.
# It is intended to be run by cron, likely as the 'postgres' user.

set -e
set -u
set -o pipefail

# --- Backup Configuration (inside script) ---
DB_NAME="${DB_NAME}" # Inherited from install script environment
S3_BUCKET="s3://${S3_BACKUP_BUCKET_NAME}" # Inherited from install script environment
TIMESTAMP=\$(date +%Y%m%d_%H%M%S)
BACKUP_BASENAME="rdap_cache_backup.dump"
LOCAL_BACKUP_FILE="/tmp/\${BACKUP_BASENAME}.gz" # Store compressed backup temporarily
# --- End Backup Configuration ---

echo "[\$(date)] Starting RDAP backup for database '\${DB_NAME}'..."

# Perform the database dump using custom format and compress with gzip
# Running as 'postgres' user should allow access without explicit credentials for local DB
echo "[\$(date)] Dumping database '\${DB_NAME}' to compressed file '\${LOCAL_BACKUP_FILE}'..."
pg_dump -Fc --dbname="\${DB_NAME}" | gzip > "\${LOCAL_BACKUP_FILE}"

# Check if dump was successful (gzip doesn't change exit code on success)
# A simple check is if the file exists and has size > 0
if [ -s "\${LOCAL_BACKUP_FILE}" ]; then
    echo "[\$(date)] Database dump successful."
else
    echo "[\$(date)] ERROR: Database dump failed or produced empty file."
    rm -f "\${LOCAL_BACKUP_FILE}" # Clean up empty file
    exit 1
fi

# Upload the compressed backup file to S3
S3_TARGET_PATH="\${S3_BUCKET}/\${BACKUP_BASENAME}.gz"
echo "[\$(date)] Uploading backup to \${S3_TARGET_PATH}..."

# Use AWS CLI. Assumes IAM Role provides credentials.
if aws s3 cp "\${LOCAL_BACKUP_FILE}" "\${S3_TARGET_PATH}"; then
    echo "[\$(date)] Backup successfully uploaded to S3."
else
    echo "[\$(date)] ERROR: Failed to upload backup to S3."
    # Keep the local file in /tmp for inspection in case of upload failure
    exit 1
fi

# Clean up the local backup file
echo "[\$(date)] Cleaning up local backup file '\${LOCAL_BACKUP_FILE}'..."
rm -f "\${LOCAL_BACKUP_FILE}"

echo "[\$(date)] RDAP backup finished successfully."
exit 0
EOF

# Make the backup script executable
echo "Setting execute permissions on ${BACKUP_SCRIPT_PATH}..."
sudo chmod +x "${BACKUP_SCRIPT_PATH}"
echo ""

# --- Create Cron Job File ---
echo "Creating cron job file at ${CRON_JOB_FILE}..."

# Write the cron job definition
# Runs the script as the 'postgres' user
# Redirects stdout and stderr to the log file
sudo bash -c "cat > ${CRON_JOB_FILE}" << EOF
# Cron job for RDAP Cache database backup
# Generated by 7_cron_install.sh

SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Run daily at ${CRON_SCHEDULE} (e.g., 3:15 AM)
${CRON_SCHEDULE} postgres ${BACKUP_SCRIPT_PATH} >> ${CRON_LOG_FILE} 2>&1

# Add a blank line at the end for cron best practice
EOF

# Set appropriate permissions for the cron file
echo "Setting permissions on ${CRON_JOB_FILE}..."
sudo chmod 644 "${CRON_JOB_FILE}"
echo ""

# --- Log File Setup ---
echo "Ensuring log file ${CRON_LOG_FILE} exists and has appropriate permissions..."
sudo touch "${CRON_LOG_FILE}"
# Allow postgres user (who runs the cron job) to write to the log
sudo chown postgres:postgres "${CRON_LOG_FILE}"
sudo chmod 644 "${CRON_LOG_FILE}" # Or 664 if the group needs write access
echo ""

exit 0