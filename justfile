# Selfer — task runner
# Run `just` to see all recipes.

set dotenv-load := true

# Default: list available recipes
default:
    @just --list

# Install npm deps (rebuilds native modules for Electron)
install:
    npm install

# Start the app in dev mode with HMR
dev:
    npm run dev

# Production build (out/)
build:
    npm run build

# Preview a production build
preview:
    npm run preview

# Build .dmg, quit running Selfer, open dmg so you can drag Selfer.app onto /Applications
dist:
    npm run dist
    @killall Selfer 2>/dev/null || true
    @dmg=$(ls -t release/*.dmg 2>/dev/null | head -n1); \
        if [ -z "$dmg" ]; then echo "No .dmg found in release/"; exit 1; fi; \
        echo "Opening $dmg — drag Selfer.app to Applications."; \
        open "$dmg"

# Typecheck main, preload, and renderer
check:
    npm run typecheck

# Typecheck + build — use before committing
verify: check build

# Rebuild native modules against Electron's ABI (fixes better-sqlite3 after a Node/Electron change)
rebuild-native:
    npx electron-builder install-app-deps

# Delete build artifacts (keeps node_modules and ~/.selfer data)
clean:
    rm -rf out release dist *.tsbuildinfo

# Delete everything regenerable, including node_modules
clean-all: clean
    rm -rf node_modules package-lock.json

# Reset the local index (keeps your source sessions and edits) — useful after schema changes
reset-index:
    rm -f ~/.selfer/selfer.db ~/.selfer/selfer.db-shm ~/.selfer/selfer.db-wal
    @echo "Index cleared. Reopen the app and click Reindex."

# Print where Selfer keeps its state
paths:
    @echo "DB:       ~/.selfer/selfer.db"
    @echo "Edits:    ~/.selfer/edits/"
    @echo "Digests:  ~/.selfer/digests/"
    @echo "Settings: ~/.selfer/settings.json"
    @echo "Source:   ~/.claude/projects/"

# Tail the dev-server logs (requires `just dev` to be running in another terminal)
# No-op if no dev server is running.
logs:
    @pgrep -fl "electron-vite dev" || echo "No dev server running."
