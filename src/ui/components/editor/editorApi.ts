import type { Dispatch, SetStateAction } from 'react'
import type { Application } from '../../../domain/applications'
import type { CvAnalysis } from '../../../domain/cvAnalysis'
import type { CvGraph, CvOutline } from '../../../domain/cvEditing'
import type { Cv, ResumeDocument, Snapshot } from '../../../domain/model'

export type PanelId = 'content' | 'sections' | 'design' | 'analysis' | 'posting' | 'versions'

export type Review = { title: string; refs: string[]; index: number }

/** What every panel of the CV editor gets: the CV, its live draft and ways to change them. */
export type EditorApi = {
  doc: ResumeDocument
  cv: Cv
  outline: CvOutline
  /** The CV as it prints now, built live from its content. */
  draft: Snapshot
  analysis: CvAnalysis
  /** The part of the CV being edited ("bullet:<id>", "role:<id>", "summary"…), shown on the page too. */
  focusRef: string | null
  /** Points at a part of the CV: highlights it on the page and, with `reveal`, opens it in its panel. */
  focus: (ref: string | null, options?: { reveal?: boolean }) => void
  openPanel: (panel: PanelId) => void
  setDoc: Dispatch<SetStateAction<ResumeDocument>>
  /** Changes the open CV's graph (its content). */
  setGraph: (update: (graph: CvGraph) => CvGraph) => void
  /** Changes the open CV's own fields (title, target, style…). */
  patchCv: (patch: Partial<Cv>) => void
  saveVersion: () => void
  selectedVersionId: string | null
  selectVersion: (id: string | null) => void
  /** Going through the parts a check pointed at ("3 achievements without a number"), one by one. */
  review: Review | null
  startReview: (title: string, refs: string[]) => void
  stepReview: (delta: -1 | 1) => void
  endReview: () => void
  /** The application this CV was made for, if any. */
  application?: Application
  /** Records a version as the one sent to that application. */
  markSent?: (versionId: string) => void
  /** Assistants connected through the MCP: the panels suggest what to ask them. */
  assistant?: { connected: boolean; onConnect: () => void }
}

/** DOM id of the editor field for a part of the CV. */
export function fieldId(ref: string) {
  return `cv-field-${ref.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}
