'use client'

import { ApiError } from '@/lib/api'

// The API's error envelope rendered close to literally, not translated into
// bespoke copy per code -- see docs/spec/frontend-ui.md §4.
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null

  const apiError = error instanceof ApiError ? error : null
  const status = apiError?.status
  const code = apiError?.code ?? 'Error'
  const message = error instanceof Error ? error.message : 'Something went wrong.'

  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      <div className="font-medium">
        {status ? `${status} ` : ''}
        {code}
      </div>
      <div>{message}</div>
      {apiError?.details && apiError.details.length > 0 && (
        <ul className="mt-1 list-inside list-disc">
          {apiError.details.map((d) => (
            <li key={d.path}>
              {d.path}: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
