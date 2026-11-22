import './cvs.css'
import { useLayoutEffect, useRef, useState } from 'react'
import { pageSpec } from '../../../domain/fonts'
import type { CatalogSection, Cv, Snapshot } from '../../../domain/model'
import { ResumePreview } from '../ResumePreview'

/** The first page of a CV, scaled to the width of its box: a thumbnail that is the real CV. */
export function CvPaper({ cv, snapshot, sections }: { cv: Cv; snapshot: Snapshot; sections: CatalogSection[] }) {
  const box = useRef<HTMLSpanElement>(null)
  const [scale, setScale] = useState(0.26)
  const paperWidth = pageSpec(cv.pageSize).width

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const fit = () => {
      const next = Math.round((element.clientWidth / paperWidth) * 1000) / 1000
      if (next > 0) setScale((current) => (current === next ? current : next))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [paperWidth])

  return (
    <span className="cv-paper" ref={box} aria-hidden="true">
      <ResumePreview
        snapshot={snapshot}
        templateId={cv.templateId}
        fontId={cv.fontId}
        fontSize={cv.fontSize}
        lineHeight={cv.lineHeight}
        marginId={cv.marginId}
        pageSize={cv.pageSize}
        skillsFormat={cv.skillsFormat ?? 'list'}
        accentColor={cv.accentColor}
        sectionOrder={cv.sectionOrder}
        enabledSections={cv.enabledSections}
        sections={sections}
        blocks={snapshot.blocks ?? []}
        scale={scale}
      />
    </span>
  )
}
