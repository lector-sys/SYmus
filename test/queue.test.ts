import test from 'node:test'
import assert from 'node:assert/strict'
import { usePlayer } from '../src/renderer/src/store.ts'

// Track, without reaching through the preload module into electron's types.
type T = ReturnType<typeof usePlayer.getState>['queue'][number]

const track = (n: number): T => ({
  videoId: `id${n}`.padEnd(11, '0'),
  title: `t${n}`,
  artist: null,
  thumbnailUrl: '',
  duration: 100
})
const [a, b, c, d] = [track(1), track(2), track(3), track(4)]

const reset = (): void => {
  usePlayer.setState({
    queue: [],
    history: [],
    current: null,
    playing: false,
    shuffle: false,
    repeat: 'off'
  })
}
const titles = (list: (T | null)[]): string[] => list.map((t) => t!.title)

test('playNow takes a track and queues the rest', () => {
  reset()
  usePlayer.getState().playNow([a, b, c], 0)
  const s = usePlayer.getState()
  assert.equal(s.current, a)
  assert.deepEqual(titles(s.queue), ['t2', 't3'])
  assert.equal(s.playing, true)
})

test('next advances and records history; repeat-all requeues', () => {
  reset()
  usePlayer.getState().playNow([a, b])
  usePlayer.getState().next()
  let s = usePlayer.getState()
  assert.equal(s.current, b)
  assert.deepEqual(titles(s.history), ['t1'])

  usePlayer.setState({ repeat: 'all' })
  usePlayer.getState().next()
  s = usePlayer.getState()
  // b came back around because the queue was otherwise empty
  assert.equal(s.current, b)
  assert.deepEqual(titles(s.history), ['t1', 't2'])
})

test('a failed track is never requeued, even on repeat-all', () => {
  reset()
  usePlayer.getState().playNow([a, b])
  usePlayer.setState({ repeat: 'all' })
  usePlayer.getState().next(true)
  const s = usePlayer.getState()
  assert.equal(s.current, b)
  assert.deepEqual(titles(s.queue), [], 'dead track must not loop forever')
})

test('next drains to nothing and stops', () => {
  reset()
  usePlayer.getState().playNow([a])
  usePlayer.getState().next()
  const s = usePlayer.getState()
  assert.equal(s.current, null)
  assert.equal(s.playing, false)
})

test('previous walks back and requeues what was playing', () => {
  reset()
  usePlayer.getState().playNow([a, b, c])
  usePlayer.getState().next() // now b, history [a]
  assert.equal(usePlayer.getState().previous(), true)
  const s = usePlayer.getState()
  assert.equal(s.current, a)
  assert.deepEqual(titles(s.queue), ['t2', 't3'])
  assert.deepEqual(titles(s.history), [])
  // Nothing left behind: the caller restarts the track instead.
  assert.equal(usePlayer.getState().previous(), false)
})

test('jumpTo sends everything it skipped to history', () => {
  reset()
  usePlayer.getState().playNow([a, b, c, d]) // current a, queue [b,c,d]
  usePlayer.getState().jumpTo(2) // -> d
  const s = usePlayer.getState()
  assert.equal(s.current, d)
  assert.deepEqual(titles(s.queue), [])
  assert.deepEqual(titles(s.history), ['t1', 't2', 't3'])
  assert.deepEqual(usePlayer.getState().jumpTo(9), undefined)
})

test('move reorders the queue', () => {
  reset()
  usePlayer.getState().playNow([a, b, c, d]) // queue [b,c,d]
  usePlayer.getState().move(2, 0)
  assert.deepEqual(titles(usePlayer.getState().queue), ['t4', 't2', 't3'])
})

test('playNext jumps the line, addToQueue joins the back', () => {
  reset()
  usePlayer.getState().playNow([a, b])
  usePlayer.getState().addToQueue([d])
  usePlayer.getState().playNext([c])
  assert.deepEqual(titles(usePlayer.getState().queue), ['t3', 't2', 't4'])
  usePlayer.getState().removeAt(1)
  assert.deepEqual(titles(usePlayer.getState().queue), ['t3', 't4'])
})

test('shuffle still consumes every track exactly once', () => {
  reset()
  usePlayer.getState().playNow([a, b, c, d])
  usePlayer.setState({ shuffle: true })
  const played = [usePlayer.getState().current]
  for (let i = 0; i < 3; i++) {
    usePlayer.getState().next()
    played.push(usePlayer.getState().current)
  }
  assert.deepEqual(titles(played).sort(), ['t1', 't2', 't3', 't4'])
  usePlayer.getState().next()
  assert.equal(usePlayer.getState().current, null)
})

test('history is capped', () => {
  reset()
  usePlayer.getState().playNow(Array.from({ length: 60 }, (_, i) => track(i)))
  for (let i = 0; i < 55; i++) usePlayer.getState().next()
  assert.equal(usePlayer.getState().history.length, 50)
})
