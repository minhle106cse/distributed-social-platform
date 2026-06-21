#!/usr/bin/env python3
import os
import sys
import json
import subprocess

# Ensure the parent directory is on path to allow importing execution modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import get_logger, load_env

def main():
    load_env()
    logger = get_logger("setup-turborepo")
    workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    logger.info("Starting Turborepo Setup & Core API Migration...")

    # 1. Rename core-service to core-api
    apps_dir = os.path.join(workspace_root, "apps")
    core_service_path = os.path.join(apps_dir, "core-service")
    core_api_path = os.path.join(apps_dir, "core-api")
    
    if os.path.exists(core_service_path):
        os.rename(core_service_path, core_api_path)
        logger.info(f"Renamed {core_service_path} -> {core_api_path}")
    elif os.path.exists(core_api_path):
        logger.info(f"{core_api_path} already exists, skipping rename.")
    else:
        logger.warning("Could not find apps/core-service or apps/core-api.")

    # 2. Update apps/core-api/package.json
    core_api_pkg_path = os.path.join(core_api_path, "package.json")
    if os.path.exists(core_api_pkg_path):
        with open(core_api_pkg_path, "r", encoding="utf-8") as f:
            core_api_pkg = json.load(f)
            
        old_name = core_api_pkg.get("name")
        core_api_pkg["name"] = "@distributed-social-platform/core-api"
        
        with open(core_api_pkg_path, "w", encoding="utf-8") as f:
            json.dump(core_api_pkg, f, indent=2)
        logger.info(f"Updated core-api package.json name from {old_name} -> @distributed-social-platform/core-api")

    # 3. Update root tsconfig.json
    tsconfig_path = os.path.join(workspace_root, "tsconfig.json")
    if os.path.exists(tsconfig_path):
        with open(tsconfig_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        if "core-service" in content:
            content = content.replace("core-service", "core-api")
            with open(tsconfig_path, "w", encoding="utf-8") as f:
                f.write(content)
            logger.info("Updated root tsconfig.json references to core-api.")
            
    # 4. Generate turbo.json
    turbo_path = os.path.join(workspace_root, "turbo.json")
    turbo_config = {
        "$schema": "https://turbo.build/schema.json",
        "pipeline": {
            "build": {
                "dependsOn": ["^build"],
                "outputs": ["dist/**"]
            },
            "lint": {},
            "test": {
                "dependsOn": ["build"]
            },
            "dev": {
                "cache": False,
                "persistent": True
            }
        }
    }
    with open(turbo_path, "w", encoding="utf-8") as f:
        json.dump(turbo_config, f, indent=2)
    logger.info("Generated turbo.json configuration.")

    # 5. Update Root package.json
    root_pkg_path = os.path.join(workspace_root, "package.json")
    with open(root_pkg_path, "r", encoding="utf-8") as f:
        root_pkg = json.load(f)

    # Simplify scripts to use Turbo
    root_pkg["scripts"] = {
        "build": "turbo run build",
        "dev": "turbo run dev",
        "lint": "turbo run lint",
        "test": "turbo run test",
        "format": "prettier --write \"**/*.{ts,tsx,md}\""
    }
    
    with open(root_pkg_path, "w", encoding="utf-8") as f:
        json.dump(root_pkg, f, indent=2)
    logger.info("Updated root package.json scripts to use Turbo.")

    # 6. Install turbo dev dependency safely
    logger.info("Running npm install turbo --save-dev...")
    try:
        # Use shell=True for windows npm resolution
        result = subprocess.run("npm install turbo --save-dev", cwd=workspace_root, check=True, shell=True, capture_output=True, text=True)
        logger.info("npm install completed successfully.")
    except subprocess.CalledProcessError as e:
        logger.error(f"npm install failed! Error: {e.stderr}")
        sys.exit(1)

    logger.info("Turborepo Migration Complete!")

if __name__ == "__main__":
    main()
