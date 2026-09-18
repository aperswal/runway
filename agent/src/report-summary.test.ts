import { describe, expect, it } from 'vitest'
import { publishedSummary } from './report.ts'

describe('publishedSummary', () => {
  it('publishes only the text after the last SUMMARY: marker', () => {
    expect(
      publishedSummary(
        'Turn count: 3 of 120.\n**Fund review**\n- x\n\nSUMMARY:\nAll funds hold cash.',
      ),
    ).toBe('All funds hold cash.')
    expect(publishedSummary('notes\nSUMMARY: first\nmore\nSUMMARY:   second one  ')).toBe(
      'second one',
    )
  })
  it('falls back to the whole text without a marker or with an empty one', () => {
    expect(publishedSummary('Plain summary.')).toBe('Plain summary.')
    expect(publishedSummary('Working notes\nSUMMARY:\n')).toBe('Working notes\nSUMMARY:\n')
  })
})
