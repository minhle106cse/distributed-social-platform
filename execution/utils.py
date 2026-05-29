import os
import sys
import json
import time
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone

# ==============================================================================
# AGENT LAYER 3 EXECUTION UTILITIES
# ==============================================================================
# This module provides core, zero-dependency utilities for Layer 3 scripts,
# focusing on robust environment loading, structured logging, and resilient
# execution paradigms as defined in AGENTS.md.

# ------------------------------------------------------------------------------
# 1. ENVIRONMENT LOADER (Zero-dependency .env parser)
# ------------------------------------------------------------------------------
def load_env(env_path: str = ".env") -> Dict[str, str]:
    """
    Loads environment variables from a .env file into os.environ.
    Ensures scripts run seamlessly on local and containerized environments.
    """
    env_vars = {}
    if not os.path.exists(env_path):
        # Resolve path relative to the workspace root if needed
        workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        env_path = os.path.join(workspace_root, ".env")
        
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                # Skip comments and empty lines
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip()
                # Remove quotes if present
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                os.environ[key] = val
                env_vars[key] = val
    return env_vars


# ------------------------------------------------------------------------------
# 2. STRUCTURED LOGGER (AGENTS.md Structured Log Standard)
# ------------------------------------------------------------------------------
class StructuredFormatter(logging.Formatter):
    """
    Formatter to output JSON structured logs conformant with production
    observability standards.
    """
    def __init__(self, service_name: str = "agent-execution-service"):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        correlation_id = getattr(record, "correlation_id", "N/A")
        request_id = getattr(record, "request_id", "N/A")
        
        log_data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": self.service_name,
            "correlationId": correlation_id,
            "requestId": request_id,
            "message": record.getMessage(),
        }
        
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
            
        return json.dumps(log_data)


def get_logger(service_name: str = "agent-execution-service") -> logging.Logger:
    """
    Returns a configured logger that outputs structured JSON logs.
    """
    logger = logging.getLogger(service_name)
    logger.setLevel(logging.INFO)
    
    # Avoid duplicate handlers if logger is fetched multiple times
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StructuredFormatter(service_name))
        logger.addHandler(handler)
        
    return logger


# ------------------------------------------------------------------------------
# 3. DIRECTORY & SCRATCH MANAGEMENT
# ------------------------------------------------------------------------------
def get_tmp_dir() -> str:
    """
    Returns the path to the .tmp directory, ensuring it exists.
    All intermediates and temp processing files must go here.
    """
    workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tmp_path = os.path.join(workspace_root, ".tmp")
    os.makedirs(tmp_path, exist_ok=True)
    return tmp_path


def write_intermediate(filename: str, data: Any) -> str:
    """
    Writes data (dict, list, or string) to a file in the .tmp/ directory.
    """
    tmp_dir = get_tmp_dir()
    file_path = os.path.join(tmp_dir, filename)
    
    with open(file_path, "w", encoding="utf-8") as f:
        if isinstance(data, (dict, list)):
            json.dump(data, f, indent=2, ensure_ascii=False)
        else:
            f.write(str(data))
            
    return file_path


# ------------------------------------------------------------------------------
# 4. INITIALIZE ON MODULE LOAD
# ------------------------------------------------------------------------------
# Auto-load env on import
load_env()
