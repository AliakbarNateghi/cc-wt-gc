import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const LIST = [
  'worktree /r', 'HEAD a', 'branch refs/heads/main', '',
  'worktree /r-merged', 'HEAD b', 'branch refs/heads/merged', '',
  'worktree /r-closed', 'HEAD c', 'branch refs/heads/closed', '',
  'worktree /r-open', 'HEAD d', 'branch refs/heads/open', '',
  'worktree /r-dirty', 'HEAD e', 'branch refs/heads/dirtyb', '',
  'worktree /r-new', 'HEAD f', 'branch refs/heads/nopr', '',
].join('\n')

const PRS: Record<string, string> = {
  merged: '[{"state":"MERGED"}]', closed: '[{"state":"CLOSED"}]', open: '[{"state":"OPEN"}]', dirtyb: '[{"state":"MERGED"}]', nopr: '[]',
}

// Fake git/gh beneath the plugin; records every argv.
const fake = (on: On, calls: string[][]) =>
  on('process.run', async ($, e) => {
    const a = [...e.argv]
    calls.push(a)
    const res = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const ok = (stdout = '') => res(0, stdout)
    const j = a.join(' ')
    if (j === 'git rev-parse --show-toplevel') return ok('/r\n')
    if (j === 'git worktree list --porcelain') return ok(LIST)
    if (j.startsWith('git symbolic-ref')) return ok('origin/main\n')
    if (j === 'git status --porcelain') return ok(e.init?.cwd === '/r-dirty' ? ' M x\n' : '')
    if (a[0] === 'gh') return ok(PRS[a[4]!] ?? '[]')
    if (j.startsWith('git merge-base')) return res(1)
    return ok()
  })

const cmd = (args: string) =>
  ({ command: 'wt-gc', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

const removed = (calls: string[][]) => calls.filter(c => c[1] === 'worktree' && c[2] === 'remove').map(c => c[3])

test('report lists statuses and never removes', async ($: Engine, on: On) => {
  const calls: string[][] = []
  fake(on, calls)
  const { text } = await $.command.run(cmd(''))
  expect(text).toMatch(/\/r-merged\s+merged\s+MERGED/)
  expect(text).toMatch(/\/r-closed\s+closed\s+CLOSED/)
  expect(text).toMatch(/\/r-open\s+open\s+OPEN/)
  expect(text).toMatch(/\/r-dirty\s+dirtyb\s+DIRTY/)
  expect(text).toMatch(/\/r-new\s+nopr\s+NO-PR/)
  expect(text?.includes('/r ')).toBe(false)
  expect(removed(calls)).toEqual([])
  expect(calls.some(c => c.includes('prune'))).toBe(false)
})

test('prune removes only clean MERGED/CLOSED, without --force', async ($: Engine, on: On) => {
  const calls: string[][] = []
  fake(on, calls)
  await $.command.run(cmd('prune'))
  expect(removed(calls)).toEqual(['/r-merged', '/r-closed'])
  expect(calls.some(c => c.includes('--force') || c.includes('-f'))).toBe(false)
  expect(calls.some(c => c.join(' ') === 'git worktree prune')).toBe(true)
})
