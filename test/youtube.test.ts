import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize, kindOf, pickResult, cleanError } from '../src/main/youtube.ts'

test('normalize', () => {
  assert.equal(normalize('  <https://youtu.be/abc>  '), 'https://youtu.be/abc')
  assert.equal(normalize('youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc')
  assert.equal(normalize('just some song'), null)
})

test('kindOf queues real playlists but not RD mixes', () => {
  assert.equal(kindOf('https://www.youtube.com/watch?v=abc&list=PL123'), 'playlist')
  assert.equal(kindOf('https://www.youtube.com/watch?v=abc&list=RD123'), 'video')
  assert.equal(kindOf('https://youtu.be/abc'), 'video')
  assert.equal(kindOf('https://www.youtube.com/shorts/abc'), 'video')
  assert.equal(kindOf('https://vimeo.com/123'), 'search')
  assert.equal(kindOf('not a url'), 'search')
  // A hostname that merely ends in the string must not pass as YouTube.
  assert.equal(kindOf('https://evilyoutube.com/watch?v=abc'), 'search')
})

test('pickResult skips livestreams and zero-duration placeholders', () => {
  assert.deepEqual(
    pickResult([{ is_live: true, duration: 0 }, { duration: 0 }, { duration: 200 }]),
    { duration: 200 }
  )
  // Nothing playable: fall back to the top hit rather than nothing.
  assert.deepEqual(pickResult([{ is_live: true, duration: 0 }]), { is_live: true, duration: 0 })
  assert.equal(pickResult([]), null)
})

test('cleanError classifies the failures worth auto-skipping', () => {
  assert.equal(cleanError('ERROR: [youtube] abc: Sign in to confirm your age'), 'age-restricted')
  assert.equal(cleanError('ERROR: [youtube] abc: This video is private'), 'private')
  assert.equal(cleanError('ERROR: Video unavailable'), 'unavailable')
  assert.equal(cleanError('ERROR: Requested format is not available'), 'no playable audio track')
  assert.equal(cleanError('no error line here'), 'could not be fetched')
})
