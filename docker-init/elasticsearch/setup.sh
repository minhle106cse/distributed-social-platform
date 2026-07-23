#!/bin/sh
# Idempotent ES bootstrap: ingest pipeline (audit reroute) + component/index
# templates (data streams) + 2 RBAC roles + 2 REAL persistent users you can
# actually log into Kibana with (not throwaway test accounts — this must be
# usable on the local docker-compose stack today, not just "works once real
# prod infra exists later").
# Run against a healthy ES node. Safe to re-run (every call is a PUT/upsert).
set -eu

ES_URL="${ELASTICSEARCH_URL:-http://localhost:9200}"
AUTH="elastic:${ELASTIC_PASSWORD:-changeme}"
DIR="$(dirname "$0")"

put() {
  path="$1"
  file="$2"
  echo "PUT $path"
  curl -sf -u "$AUTH" -X PUT "$ES_URL$path" \
    -H 'Content-Type: application/json' \
    --data-binary "@$DIR/$file" \
    -o /dev/null -w '  -> %{http_code}\n'
}

put_user() {
  username="$1"
  password="$2"
  role="$3"
  echo "PUT /_security/user/$username"
  curl -sf -u "$AUTH" -X POST "$ES_URL/_security/user/$username" \
    -H 'Content-Type: application/json' \
    -d "{\"password\":\"$password\",\"roles\":[\"$role\"]}" \
    -o /dev/null -w '  -> %{http_code}\n'
}

# kibana_system is a built-in disabled-by-default service account — Kibana's
# OWN backend connection MUST use this, never the `elastic` superuser (ES 8.x
# refuses to boot Kibana otherwise — real crash-loop bug found 2026-07-25).
echo "PUT /_security/user/kibana_system/_password"
curl -sf -u "$AUTH" -X POST "$ES_URL/_security/user/kibana_system/_password" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"${KIBANA_SYSTEM_PASSWORD:-kibana-system-changeme}\"}" \
  -o /dev/null -w '  -> %{http_code}\n'

put "/_ingest/pipeline/dsp-log-router" "ingest-pipeline-log-router.json"
put "/_ilm/policy/dsp-logs-ilm" "ilm-policy-dsp-logs.json"
put "/_ilm/policy/dsp-audit-logs-ilm" "ilm-policy-dsp-audit-logs.json"
put "/_component_template/dsp-log-mappings" "component-template-log-mappings.json"
put "/_index_template/dsp-audit-logs-template" "index-template-dsp-audit-logs.json"
put "/_index_template/dsp-logs-template" "index-template-dsp-logs.json"
put "/_security/role/dsp_ops_reader" "role-dsp-ops-reader.json"
put "/_security/role/dsp_audit_reader" "role-dsp-audit-reader.json"
put_user "dsp_ops_viewer" "${DSP_OPS_READER_PASSWORD:-ops-reader-changeme}" "dsp_ops_reader"
put_user "dsp_audit_viewer" "${DSP_AUDIT_READER_PASSWORD:-audit-reader-changeme}" "dsp_audit_reader"

echo "ES log-routing + RBAC setup complete."
echo "Login to Kibana (http://localhost:5601) as dsp_ops_viewer (sees dsp-logs*)"
echo "or dsp_audit_viewer (sees dsp-audit-logs*) to verify the split yourself."
