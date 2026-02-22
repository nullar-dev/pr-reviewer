import {expect, test} from '@jest/globals'
import * as cp from 'child_process'
import * as path from 'path'
import * as process from 'process'

test('test runs', () => {
  // Set required GitHub Actions environment variables
  const testEnv = {
    ...process.env,
    GITHUB_ACTION: '__test',
    GITHUB_WORKFLOW: 'test-workflow',
    GITHUB_RUN_ID: '1234567890',
    GITHUB_RUN_NUMBER: '1',
    GITHUB_REPOSITORY: 'test/test-repo',
    GITHUB_REPOSITORY_OWNER: 'test',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_SHA: 'test-sha',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_TOKEN: 'test-token'
  }
  const np = process.execPath
  // Use dist/index.js which is packaged as CommonJS by ncc
  const ip = path.join(__dirname, '..', 'dist', 'index.js')
  const options: cp.ExecFileSyncOptions = {
    env: testEnv
  }
  console.log(cp.execFileSync(np, [ip], options).toString())
})
