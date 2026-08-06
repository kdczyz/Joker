import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decidePresentationChange,
  latestPresentationPath,
  presentationPathsFromWorkspaceEntries
} from './presentation-sync.js'

test('main Agent changes are followed when the sidebar has no deck or another deck', () => {
  assert.equal(decidePresentationChange({
    hasProject: false,
    activePath: '',
    currentRevision: 0,
    changePath: 'agent-deck.Rcode-ppt.html',
    changeRevision: 1,
    source: 'tool'
  }), 'follow-tool')
  assert.equal(decidePresentationChange({
    hasProject: true,
    activePath: 'old-deck.Rcode-ppt.html',
    currentRevision: 3,
    changePath: 'agent-deck.Rcode-ppt.html',
    changeRevision: 2,
    source: 'tool'
  }), 'follow-tool')
})

test('the current deck refreshes only for a newer revision', () => {
  assert.equal(decidePresentationChange({
    hasProject: true,
    activePath: 'agent-deck.Rcode-ppt.html',
    currentRevision: 2,
    changePath: 'agent-deck.Rcode-ppt.html',
    changeRevision: 3,
    source: 'tool'
  }), 'refresh-current')
  assert.equal(decidePresentationChange({
    hasProject: true,
    activePath: 'agent-deck.Rcode-ppt.html',
    currentRevision: 3,
    changePath: 'agent-deck.Rcode-ppt.html',
    changeRevision: 3,
    source: 'tool'
  }), 'ignore')
  assert.equal(decidePresentationChange({
    hasProject: false,
    activePath: '',
    currentRevision: 0,
    changePath: 'command-deck.Rcode-ppt.html',
    changeRevision: 1,
    source: 'command'
  }), 'ignore')
})

test('workspace discovery accepts root presentation files and selects the newest', () => {
  const paths = presentationPathsFromWorkspaceEntries([
    { name: 'first.Rcode-ppt.html', type: 'file' },
    { name: 'notes.md', type: 'file' },
    { name: '../outside.Rcode-ppt.html', type: 'file' },
    { name: 'nested', type: 'directory' }
  ])
  assert.deepEqual(paths, ['first.Rcode-ppt.html'])
  assert.equal(latestPresentationPath([
    { path: 'first.Rcode-ppt.html', modifiedAt: '2026-07-14T01:00:00.000Z' },
    { path: 'agent-deck.Rcode-ppt.html', modifiedAt: '2026-07-14T02:00:00.000Z' }
  ]), 'agent-deck.Rcode-ppt.html')
})
