# SOP: Migrate to Turborepo & Rename Core Service

> [!NOTE]
> This directive outlines the automated process for restructuring the Monorepo to use Turborepo as the primary build pipeline, and correctly renaming the core monolith module to align with architectural standards.

## 🎯 Goal
- Rename `apps/core-service` to `apps/core-api`.
- Update all associated internal references (`package.json`, `tsconfig.json`).
- Install and configure Turborepo (`turbo`) to manage `build`, `lint`, `test`, and `dev` scripts.

## 📥 Inputs & Requirements
- Target directory: `apps/core-service` must exist.
- Root configuration files: `package.json`, `tsconfig.json`.

## 🛠️ Execution Plan & Scripts

1. **Step 1: Execute Migration Script**
   - Script: `execution/setup_turborepo.py`
   - Purpose: Performs deterministic folder renaming, JSON patching, and invokes `npm install` safely.

## 📤 Expected Outputs
- `apps/core-api` replaces `apps/core-service`.
- `turbo.json` is generated at the workspace root.
- Root `package.json` has `turbo` added to `devDependencies` and its `scripts` block updated.

## ⚠️ Edge Cases & Failure Handling
- **Folder Not Found**: If `apps/core-service` does not exist, check if the renaming has already occurred (`apps/core-api`). If so, log a warning and proceed with config patching.
- **NPM Install Failure**: If `subprocess` returns a non-zero exit code during `npm install`, halt the script and throw an exception to be caught by the orchestrator.
