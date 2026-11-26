import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function findRoot(start) {
  let dir = start
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'server.mjs'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function npmBin() {
  const besideNode = join(dirname(process.execPath), 'npm')
  return existsSync(besideNode) ? besideNode : 'npm'
}

const root = findRoot(here)
if (!root) {
  console.error('找不到即梦填图词的程序目录。')
  process.exit(1)
}

if (!existsSync(join(root, 'node_modules', '@modelcontextprotocol', 'sdk'))) {
  const args = existsSync(join(root, 'package-lock.json'))
    ? ['ci', '--omit=dev']
    : ['install', '--omit=dev', '--no-audit', '--no-fund']
  const install = spawn(npmBin(), args, {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit']
  })
  const code = await new Promise(resolve => install.on('exit', resolve))
  if (code !== 0) process.exit(code ?? 1)
}

const child = spawn(process.execPath, [join(root, 'src', 'server.mjs')], {
  cwd: root,
  stdio: 'inherit'
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
