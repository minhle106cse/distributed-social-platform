#!/usr/bin/env python3
import sys
import os

# Ensure the parent directory is on path to allow importing execution modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from utils import get_logger, write_intermediate, load_env

def main():
    # 1. Initialize environment & structured logging
    load_env()
    logger = get_logger("example-execution-script")
    
    logger.info("Initializing Layer 3 deterministic execution script.")
    
    # 2. Retrieve variables from environment
    db_host = os.environ.get("DB_HOST", "localhost")
    db_port = os.environ.get("DB_PORT", "5432")
    auth_port = os.environ.get("AUTH_SERVICE_PORT", "4001")
    
    logger.info(f"Loaded database configuration: Host={db_host}, Port={db_port}")
    logger.info(f"Loaded Auth service configuration: Port={auth_port}")
    
    # 3. Simulate processing work (e.g. preparing an intermediate state file)
    report_data = {
        "status": "success",
        "message": "Workspace initialized successfully according to AGENTS.md specs.",
        "details": {
            "monorepo_root": os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "configs_verified": {
                "db_host": db_host,
                "db_port": db_port,
                "auth_port": auth_port
            }
        }
    }
    
    # 4. Save results to the .tmp/ directory (Layer 3 intermediate output)
    tmp_file = write_intermediate("initialization_report.json", report_data)
    logger.info(f"Wrote intermediate processing results to {tmp_file}")
    
    print("\n[+] SUCCESS: Deterministic script executed successfully.")
    print(f"[+] Output stored in: {tmp_file}\n")

if __name__ == "__main__":
    main()
