.PHONY: generate-client export-spec check-spec

# Regenerate the frontend TypeScript client from backend/openapi.json
generate-client:
	cd frontend && npm run generate-client

# Export the OpenAPI spec from live NestJS decorators into backend/openapi.json
export-spec:
	cd backend && npx ts-node scripts/export-spec.ts

# Fail if the committed spec diverges from the generated one
check-spec: export-spec
	git diff --exit-code backend/openapi.json
