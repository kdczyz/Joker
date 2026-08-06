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
const DRAFT = `.Rcodesdd/requirements/${UUID}/${SDD_DRAFT_FILE_NAME}`

describe('sdd shared paths', () => {
  it('builds a canonical requirement-unit draft path', () => {
    expect(buildSddDraftRelativePath(UUID)).toBe(DRAFT)
  })

  it('validates only uuid-backed requirement drafts under requirements/', () => {
    expect(isSddDraftRelativePath(DRAFT)).toBe(true)
    expect(isSddDraftRelativePath(`.Rcodesdd/requirements/not-a-uuid/requirement.md`)).toBe(false)
    expect(isSddDraftRelativePath(`.Rcodesdd/requirements/${UUID}/other.md`)).toBe(false)
    expect(isSddDraftRelativePath(`.Rcodesdd/requirements/${UUID}/nested/requirement.md`)).toBe(false)
    // The pre-unit layout is explicitly retired (clean switch, no migration).
    expect(isSddDraftRelativePath(`.Rcodesdd/draft/${UUID}/requirement.md`)).toBe(false)
  })

  it('derives the unit directories from the draft path', () => {
    expect(sddRequirementUnitDir(DRAFT)).toBe(`.Rcodesdd/requirements/${UUID}`)
    expect(sddUnitImageDir(DRAFT)).toBe(`.Rcodesdd/requirements/${UUID}/img`)
    expect(sddUnitProtoDir(DRAFT)).toBe(`.Rcodesdd/requirements/${UUID}/proto`)
    expect(sddUnitChatDir(DRAFT)).toBe(`.Rcodesdd/requirements/${UUID}/chat`)
    expect(sddDraftTraceRelativePath(DRAFT)).toBe(`.Rcodesdd/requirements/${UUID}/trace.json`)
    expect(sddRequirementUnitDir(`.Rcodesdd/draft/${UUID}/requirement.md`)).toBeNull()
    expect(sddUnitImageDir('not-a-draft.md')).toBeNull()
  })

  it('maps SDD plan paths back to the requirement unit', () => {
    expect(sddDraftRelativePathForPlanPath(`.Rcodesdd/plan/sdd-${UUID}.md`)).toBe(DRAFT)
    expect(sddDraftRelativePathForPlanPath(`.Rcodesdd/plan/sdd-${UUID}-2.md`)).toBe(DRAFT)
    expect(sddDraftRelativePathForPlanPath('.Rcodesdd/plan/other.md')).toBeNull()
  })

  it('validates per-unit image and prototype paths', () => {
    expect(normalizeSddRelativePath(`./.Rcodesdd\\requirements\\${UUID}\\img\\a.png`)).toBe(
      `.Rcodesdd/requirements/${UUID}/img/a.png`
    )
    expect(isSddImageRelativePath(`.Rcodesdd/requirements/${UUID}/img/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.Rcodesdd/requirements/${UUID}/img/nested/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.Rcodesdd/requirements/${UUID}/img/../escape.png`)).toBe(false)
    expect(isSddImageRelativePath(`.Rcodesdd/requirements/not-a-uuid/img/a.png`)).toBe(false)
    expect(isSddImageRelativePath('.Rcodesdd/img/wireframe.png')).toBe(false)
    expect(isSddImageRelativePath('img/wireframe.png')).toBe(false)

    expect(isSddPrototypeRelativePath(`.Rcodesdd/requirements/${UUID}/proto/p.html`)).toBe(true)
    expect(isSddPrototypeRelativePath('.Rcodesdd/proto/p.html')).toBe(false)
    expect(isSddPrototypeRelativePath(`.Rcodesdd/requirements/${UUID}/img/p.html`)).toBe(false)
  })
})
