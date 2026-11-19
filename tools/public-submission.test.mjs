import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizedSubmitter, publicRepository } from './public-submission.mjs'

const url = 'https://github.com/Example-Publisher/agh-research'
const proof = { repository: url, submitters: [101, 222] }

test('public package scopes match the source owner, not a fork or a reserved scope', () => {
  assert.equal(publicRepository('@example-publisher/research', url), true)
  assert.equal(publicRepository('@example-publisher/research', 'https://github.com/Fork-Owner/agh-research'), false)
  assert.equal(publicRepository('@agnes/research', 'https://github.com/AGNES/agh-research'), false)
  assert.equal(publicRepository('@example-publisher/research', `${url}.git`), false)
})

test('authorization binds an immutable GitHub account ID to the exact source repository', () => {
  assert.equal(authorizedSubmitter(proof, url.toLowerCase(), 222), true)
  assert.equal(authorizedSubmitter(proof, url, 999), false)
  assert.equal(authorizedSubmitter(proof, url, '222'), false)
  assert.equal(authorizedSubmitter(proof, 'https://github.com/Example-Publisher/other', 222), false)
  assert.equal(authorizedSubmitter({ ...proof, submitters: [222, 222] }, url, 222), false)
  assert.equal(authorizedSubmitter({ ...proof, submitters: [] }, url, 222), false)
})
