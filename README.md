# wt-gc

A Claude Code mod that adds `/wt-gc`: a garbage collector for git worktrees.

- `/wt-gc` lists every worktree except the main one, with its path, branch and status. It only reports and never deletes anything.
- `/wt-gc prune` runs `git worktree remove <path>` (no `--force`) on each clean worktree whose status is MERGED or CLOSED, then runs `git worktree prune`. Branches are kept.

Statuses:

- `DIRTY`: `git status --porcelain` is not empty, or status failed. Never removed.
- `OPEN`: the branch has an open PR (`gh pr list --head <branch> --state all`).
- `MERGED`: the branch has a merged PR, or it is an ancestor of the default branch.
- `CLOSED`: the branch has a closed PR that was not merged.
- `NO-PR`: none of the above, or a detached HEAD.

Note: a new branch with no commits of its own counts as MERGED, because it is an ancestor of the default branch.

Needs `git`. Uses `gh` (logged in) for PR states; without it only the git merge check is used.

Option `defaultBranch`: the branch to check merges against. When it is empty, the mod uses `origin/HEAD`, or `main` if that is not set.

## Install

```
/plugin install wt-gc --marketplace AliakbarNateghi/cc-wt-gc
```
