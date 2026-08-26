import { describe, expect, it } from 'vitest'
import {
  SDD_DRAFT_FILE_NAME,
  buildSddDraftRelativePath,
  isSddDraftRelativePath,
  isSddImageRelativePath,
  isSddPrototypeRelativePath,
  normalizeSddRelativePath,
  sddDraftRelativePathForPlanPath,
  sddDraftTraceRelativePath,
  sddRequirementUnitDir,
  sddUnitChatDir,
  sddUnitImageDir,
  sddUnitProtoDir
} from './sdd'

const UUID = '123e4567-e89b-12d3-a456-426614174000'
const DRAFT = `.Jokersdd/requirements/${UUID}/${SDD_DRAFT_FILE_NAME}`

describe('sdd shared paths', () => {
  it('builds a canonical requirement-unit draft path', () => {
    expect(buildSddDraftRelativePath(UUID)).toBe(DRAFT)
  })

  it('validates only uuid-backed requirement drafts under requirements/', () => {
    expect(isSddDraftRelativePath(DRAFT)).toBe(true)
    expect(isSddDraftRelativePath(`.Jokersdd/requirements/not-a-uuid/requirement.md`)).toBe(false)
    expect(isSddDraftRelativePath(`.Jokersdd/requirements/${UUID}/other.md`)).toBe(false)
    expect(isSddDraftRelativePath(`.Jokersdd/requirements/${UUID}/nested/requirement.md`)).toBe(false)
    // The pre-unit layout is explicitly retired (clean switch, no migration).
    expect(isSddDraftRelativePath(`.Jokersdd/draft/${UUID}/requirement.md`)).toBe(false)
  })

  it('derives the unit directories from the draft path', () => {
    expect(sddRequirementUnitDir(DRAFT)).toBe(`.Jokersdd/requirements/${UUID}`)
    expect(sddUnitImageDir(DRAFT)).toBe(`.Jokersdd/requirements/${UUID}/img`)
    expect(sddUnitProtoDir(DRAFT)).toBe(`.Jokersdd/requirements/${UUID}/proto`)
    expect(sddUnitChatDir(DRAFT)).toBe(`.Jokersdd/requirements/${UUID}/chat`)
    expect(sddDraftTraceRelativePath(DRAFT)).toBe(`.Jokersdd/requirements/${UUID}/trace.json`)
    expect(sddRequirementUnitDir(`.Jokersdd/draft/${UUID}/requirement.md`)).toBeNull()
    expect(sddUnitImageDir('not-a-draft.md')).toBeNull()
  })

  it('maps SDD plan paths back to the requirement unit', () => {
    expect(sddDraftRelativePathForPlanPath(`.Jokersdd/plan/sdd-${UUID}.md`)).toBe(DRAFT)
    expect(sddDraftRelativePathForPlanPath(`.Jokersdd/plan/sdd-${UUID}-2.md`)).toBe(DRAFT)
    expect(sddDraftRelativePathForPlanPath('.Jokersdd/plan/other.md')).toBeNull()
  })

  it('validates per-unit image and prototype paths', () => {
    expect(normalizeSddRelativePath(`./.Jokersdd\\requirements\\${UUID}\\img\\a.png`)).toBe(
      `.Jokersdd/requirements/${UUID}/img/a.png`
    )
    expect(isSddImageRelativePath(`.Jokersdd/requirements/${UUID}/img/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.Jokersdd/requirements/${UUID}/img/nested/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.Jokersdd/requirements/${UUID}/img/../escape.png`)).toBe(false)
    expect(isSddImageRelativePath(`.Jokersdd/requirements/not-a-uuid/img/a.png`)).toBe(false)
    expect(isSddImageRelativePath('.Jokersdd/img/wireframe.png')).toBe(false)
    expect(isSddImageRelativePath('img/wireframe.png')).toBe(false)

    expect(isSddPrototypeRelativePath(`.Jokersdd/requirements/${UUID}/proto/p.html`)).toBe(true)
    expect(isSddPrototypeRelativePath('.Jokersdd/proto/p.html')).toBe(false)
    expect(isSddPrototypeRelativePath(`.Jokersdd/requirements/${UUID}/img/p.html`)).toBe(false)
  })
})
