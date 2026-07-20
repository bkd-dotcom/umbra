test:
	@grep -q "\"next\": \"14.2.5\"" package.json && echo "baseline ok" || (echo "version changed — simulated regression" && exit 1)
