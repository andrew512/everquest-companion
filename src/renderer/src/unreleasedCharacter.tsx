// ============================================================================
// unreleasedCharacter — the ONE place the UNRELEASED flag reaches a component tree (JOS-45).
// ============================================================================
//
// Exactly the shape `devTriage.tsx` uses, for exactly the same reason. `UNRELEASED` folds to a
// literal `false` in every `electron-vite build` (it is `import.meta.env.DEV`), so this file
// compiles to `const Lazy = null` and the `import()` below is DEAD CODE — rollup removes the
// call, the chunk it would have produced is never emitted, and `features/character/**` leaves
// no trace in `out/renderer`. That is a STRIP, not a hide: there is no bundled component to
// un-hide, no string to grep, and no route into it.
//
// The DYNAMIC import is what makes the strip possible. A static `import CharacterView from …`
// would pull the tree into the module graph before any branch could remove it.

import { type JSX, Suspense, lazy } from 'react'
import { CircularProgress } from '@mui/material'
import { UNRELEASED } from './devFlags'

const LazyCharacterView = UNRELEASED ? lazy(() => import('./features/character/CharacterView')) : null

/** Renders the character sheet, or nothing at all in a build compiled without the flag. */
export default function UnreleasedCharacterView(): JSX.Element | null {
  if (!LazyCharacterView) return null
  return (
    <Suspense fallback={<CircularProgress size={20} />}>
      <LazyCharacterView />
    </Suspense>
  )
}
