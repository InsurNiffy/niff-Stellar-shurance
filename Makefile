# NiffyInsure — developer tasks

.PHONY: install-hooks

# Install the repository Git hooks (gitleaks secret scanning pre-commit).
install-hooks:
	git config core.hooksPath .githooks
	chmod +x .githooks/pre-commit
	@echo "Git hooks installed (core.hooksPath=.githooks). gitleaks will scan staged changes on commit."
