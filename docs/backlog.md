# Feature backlog

Statuses: queued → in-progress → done (or dropped).
`Spec NNN` is allocated when an item goes in-progress — this table is the
spec-number registry, which is what prevents NNN collisions when features
run concurrently (e.g. in parallel worktrees).

| ID | Ask | Priority | Status | Spec NNN |
|---|---|---|---|---|
| B1 | Project association fails for Lando apps (phase 5, scenario S1): containers labeled com.docker.compose.project="streetbites" don't match cwd basename "street_bites"; fix via path-label matching (io.lando.root / com.docker.compose.project.working_dir). See docs/phases/phase-5-project-association.md. | normal | queued | |
| B2 | Phase 3 — Auto-Discovery: technology fingerprinting, macOS environment detection (Herd/Valet/Homebrew), dynamic file tailing with rotation/truncation handling, explicit watch config fallback. See docs/phases/phase-3-auto-discovery.md. | high | done | 003 |
| B3 | Tailer misses file creation when the watch target's PARENT directory is absent at startup (chokidar/fsevents on macOS doesn't fire "add" for a not-yet-existing dir tree, for both literal and glob patterns). Fix by watching the nearest existing ancestor dir and attaching once the target dir/file appears. Known limitation documented in phase 3 (spec 003); realistic fresh-Laravel case is unaffected since storage/logs/ already exists. | normal | queued | |
