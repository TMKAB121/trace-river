# Feature backlog

Statuses: queued → in-progress → done (or dropped).
`Spec NNN` is allocated when an item goes in-progress — this table is the
spec-number registry, which is what prevents NNN collisions when features
run concurrently (e.g. in parallel worktrees).

| ID | Ask | Priority | Status | Spec NNN |
|---|---|---|---|---|
| B1 | Project association fails for Lando apps (phase 5, scenario S1): containers labeled com.docker.compose.project="streetbites" don't match cwd basename "street_bites"; fix via path-label matching (io.lando.root / com.docker.compose.project.working_dir). See docs/phases/phase-5-project-association.md. | normal | queued | |
