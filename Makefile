.PHONY: generate-client

# Regenerate the frontend TypeScript client from backend/openapi.json
generate-client:
	cd frontend && npm run generate-client
