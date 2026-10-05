import { expect, test } from 'claude-code/testing'

import { formatSize, formatTime, parseStatus } from './lib'

const SAMPLE = `codex:openai-codex · openai · codex · Codex · configured
agent-enhance:xai/imagine · xai · imagine · Agent Enhance · configured
pi:xai · xai · imagine · Pi · configured
gen_image/xai @ agent-enhance:xai/imagine: available
gen_image/xai @ pi:xai: available
gen_video/xai @ pi:xai: available
search_web/zai @ pi:zai: unavailable
`

test('parseStatus counts configured connections and dedupes available capabilities', () => {
  const { caps, connections } = parseStatus(SAMPLE)
  expect(connections).toEqual(3)
  expect(caps).toEqual(['image', 'video'])
})

test('parseStatus of empty output is empty', () => {
  const { caps, connections } = parseStatus('')
  expect(caps).toEqual([])
  expect(connections).toEqual(0)
})

test('formatSize picks a unit', () => {
  expect(formatSize(512)).toEqual('512 B')
  expect(formatSize(2048)).toEqual('2 KB')
  expect(formatSize(3.5 * 1024 * 1024)).toEqual('3.5 MB')
})

test('formatTime pads month, day, hour and minute', () => {
  const d = new Date(2026, 9, 5, 8, 7)
  expect(formatTime(d.getTime())).toEqual('10-05 08:07')
})
