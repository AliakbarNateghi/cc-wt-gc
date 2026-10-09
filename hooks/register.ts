import type { Register } from 'claude-code'

type Status = 'MERGED' | 'CLOSED' | 'OPEN' | 'NO-PR' | 'DIRTY'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'wt-gc',
      description: 'List git worktrees with PR/merge status. "prune" removes clean MERGED/CLOSED ones.',
      argumentHint: '[prune]',
    })
    return next(e)
  })

  on('command.run', { command: 'wt-gc' }, async ($, e) => {
    const run = (argv: string[], cwd?: string) =>
      $.process.run(argv, { cwd, timeoutMs: 60_000 }).catch(() => ({ exitCode: 1, stdout: '', stderr: 'could not start' }))
    const out = async (argv: string[], cwd?: string) => {
      const r = await run(argv, cwd)
      return r.exitCode === 0 ? r.stdout.trim() : undefined
    }

    const arg = e.args.trim()
    if (arg !== '' && arg !== 'prune') return { text: 'Usage: /wt-gc [prune]' }

    const root = await out(['git', 'rev-parse', '--show-toplevel'])
    if (!root) return { text: 'wt-gc: not inside a git repo.' }

    const list = await out(['git', 'worktree', 'list', '--porcelain'], root)
    if (list === undefined) return { text: 'wt-gc: git worktree list failed.' }
    // First block is the main worktree; skip it.
    const worktrees = list.split(/\n\s*\n/).slice(1).map(block => {
      const lines = block.split('\n')
      const path = lines.find(l => l.startsWith('worktree '))?.slice(9) ?? ''
      const ref = lines.find(l => l.startsWith('branch '))?.slice(7)
      return { path, branch: ref?.replace(/^refs\/heads\//, '') }
    }).filter(w => w.path)

    if (worktrees.length === 0) return { text: 'wt-gc: no worktrees besides the main one.' }

    const configured = String(options.defaultBranch ?? '').trim()
    const base = configured
      || (await out(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root))
      || 'main'

    const statusOf = async (w: { path: string; branch?: string }): Promise<Status> => {
      const dirty = await run(['git', 'status', '--porcelain'], w.path)
      // A failed status (missing path, broken worktree) counts as DIRTY so prune never touches it.
      if (dirty.exitCode !== 0 || dirty.stdout.trim() !== '') return 'DIRTY'
      if (!w.branch) return 'NO-PR' // detached HEAD: no branch to look up
      const gh = await out(['gh', 'pr', 'list', '--head', w.branch, '--state', 'all', '--json', 'state'], root)
      let states: string[] = []
      try { states = (JSON.parse(gh ?? '[]') as { state: string }[]).map(p => p.state) } catch {}
      if (states.includes('OPEN')) return 'OPEN'
      const merged = (await run(['git', 'merge-base', '--is-ancestor', w.branch, base], root)).exitCode === 0
      if (states.includes('MERGED') || merged) return 'MERGED'
      if (states.includes('CLOSED')) return 'CLOSED'
      return 'NO-PR'
    }

    const rows = await Promise.all(worktrees.map(async w => ({ ...w, status: await statusOf(w) })))
    const pw = Math.max(...rows.map(r => r.path.length))
    const bw = Math.max(...rows.map(r => (r.branch ?? '(detached)').length))
    const lines = rows.map(r => `${r.path.padEnd(pw)}  ${(r.branch ?? '(detached)').padEnd(bw)}  ${r.status}`)
    let text = `Worktrees (merge base: ${base}):\n${lines.join('\n')}`

    if (arg === 'prune') {
      const results: string[] = []
      for (const r of rows.filter(r => r.status === 'MERGED' || r.status === 'CLOSED')) {
        // No --force: git itself refuses dirty or locked worktrees.
        const rm = await run(['git', 'worktree', 'remove', r.path], root)
        results.push(rm.exitCode === 0 ? `removed  ${r.path}` : `kept     ${r.path}: ${rm.stderr.trim()}`)
      }
      await run(['git', 'worktree', 'prune'], root)
      text += `\n\nPrune:\n${results.length ? results.join('\n') : 'nothing to remove'}`
    }

    return { text }
  })
}
