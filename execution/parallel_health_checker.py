import os
import json
import re
import concurrent.futures
import time
from utils import write_intermediate, get_logger

logger = get_logger("multi-agent-orchestrator")

# Agent 1: Database Schema Scanner
def agent_prisma_scanner(workspace_root):
    logger.info("Agent 1 (DB) started scanning Prisma schema...")
    time.sleep(1) # Simulate deep thinking
    schema_path = os.path.join(workspace_root, "apps", "auth-service", "prisma", "schema.prisma")
    issues = []
    if os.path.exists(schema_path):
        with open(schema_path, "r", encoding="utf-8") as f:
            content = f.read()
            if "@@index" not in content:
                issues.append("No database indexes (@@index) found. Might cause slow queries on large tables.")
    return {"agent": "Database Expert", "status": "Done", "issues": issues}

# Agent 2: Security Scanner
def agent_security_scanner(workspace_root):
    logger.info("Agent 2 (Security) started scanning environment files...")
    time.sleep(1.5) # Simulate deep thinking
    env_path = os.path.join(workspace_root, ".env")
    issues = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            content = f.read()
            if "password" in content.lower() and "123" in content:
                issues.append("Weak password detected in .env file.")
    return {"agent": "Security Expert", "status": "Done", "issues": issues}

# Agent 3: Code Quality Scanner (Parallel file reading)
def agent_code_quality_scanner(workspace_root):
    logger.info("Agent 3 (QA) started scanning TypeScript files for console.log...")
    src_path = os.path.join(workspace_root, "apps", "auth-service", "src")
    issues = []
    
    if not os.path.exists(src_path):
        return {"agent": "QA Expert", "status": "Skipped", "issues": ["src path not found"]}

    for root, _, files in os.walk(src_path):
        for file in files:
            if file.endswith(".ts"):
                file_path = os.path.join(root, file)
                with open(file_path, "r", encoding="utf-8") as f:
                    for line_num, line in enumerate(f, 1):
                        if "console.log" in line and "//" not in line:
                            rel_path = os.path.relpath(file_path, workspace_root)
                            issues.append(f"Found console.log in {rel_path} at line {line_num}")
    time.sleep(1)
    return {"agent": "QA Expert", "status": "Done", "issues": issues}

def main():
    logger.info("Orchestrator Agent initializing...")
    workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # Define our squad of agents
    agents = [
        agent_prisma_scanner,
        agent_security_scanner,
        agent_code_quality_scanner
    ]
    
    results = {}
    start_time = time.time()
    
    # Run agents in parallel to simulate Multi-Agent Collaboration
    logger.info("Dispatching 3 sub-agents concurrently...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        future_to_agent = {executor.submit(agent, workspace_root): agent.__name__ for agent in agents}
        for future in concurrent.futures.as_completed(future_to_agent):
            agent_name = future_to_agent[future]
            try:
                data = future.result()
                results[data["agent"]] = data["issues"]
                logger.info(f"{data['agent']} finished report.")
            except Exception as exc:
                logger.error(f"{agent_name} generated an exception: {exc}")
                
    end_time = time.time()
    logger.info(f"All agents completed in {end_time - start_time:.2f} seconds.")
    
    # Orchestrator compiles the final report
    final_report = {
        "title": "Multi-Agent Codebase Health Report",
        "execution_time_seconds": round(end_time - start_time, 2),
        "findings": results
    }
    
    # Write to tmp directory
    output_path = write_intermediate("multi_agent_health_report.json", final_report)
    logger.info(f"Orchestrator saved compiled report to {output_path}")

if __name__ == "__main__":
    main()
