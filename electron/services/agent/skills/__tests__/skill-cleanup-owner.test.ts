import { describe, expect, it, vi } from 'vitest'
import { registerSkill } from '../registry'
import { createSkillSession } from '../skill-loader'
import type { Skill } from '../types'

describe('SkillSession cleanup owner', () => {
  it('passes this conversation\'s identity into skill cleanup so it can close only its own resources', async () => {
    const cleanup = vi.fn(async (_ownerId?: string) => {})
    const skill: Skill = {
      id: 'test-owner-cleanup',
      name: 'test',
      description: 'test',
      tools: [],
      cleanup,
    }
    registerSkill(skill)

    const session = createSkillSession([], 'conv-a')
    await session.loadSkill('test-owner-cleanup')
    await session.unloadSkill('test-owner-cleanup')

    expect(cleanup).toHaveBeenCalledWith('conv-a')
  })

  it('unloads without an identity rather than inventing a shared empty owner', async () => {
    const cleanup = vi.fn(async (_ownerId?: string) => {})
    const skill: Skill = {
      id: 'test-owner-cleanup-none',
      name: 'test',
      description: 'test',
      tools: [],
      cleanup,
    }
    registerSkill(skill)

    const session = createSkillSession([])
    await session.loadSkill('test-owner-cleanup-none')
    await session.unloadSkill('test-owner-cleanup-none')

    expect(cleanup).toHaveBeenCalledWith(undefined)
  })
})
