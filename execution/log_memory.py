import json
import os
import sys
from datetime import datetime
import uuid

def log_memory(file_path, category_id, error, solution, context):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            if lines:
                last_line = json.loads(lines[-1])
                next_id = last_line.get('id', category_id) + 1
            else:
                next_id = category_id + 1
    except FileNotFoundError:
        next_id = category_id + 1

    entry = {
        "id": next_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "error": error,
        "solution": solution,
        "context": context
    }

    with open(file_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(entry) + '\n')

log_memory(
    '.ai/memory/conventions.jsonl',
    1000,
    "Entity creation used undefined instead of null, causing inconsistent mapping",
    "Entity Properties Nullability Convention: Entity properties mapping to DB columns MUST use `null` (not `undefined`) for optional/empty fields. This enforces explicit declaration of missing data. The `update()` method (Partial Update pattern) should use `?: type | null` where `undefined` means 'do not update' and `null` means 'clear the field'.",
    "Domain Entity Definitions"
)

log_memory(
    '.ai/memory/architecture.jsonl',
    2000,
    "Anemic Domain Model: Handler created empty entity then called update() to fill data",
    "Intention-Revealing Interfaces (Factory Pattern): Entity creation must be atomic. Use Factory methods on the Entity (e.g. `createPremiumUser`, `createForLogin`, or pass initial data directly to `create`) instead of creating a hollow entity and letting the Application layer (Handler) manipulate it. This prevents the Transaction Script anti-pattern.",
    "DDD Entity Creation Lifecycle"
)

print("Memory logged successfully")
