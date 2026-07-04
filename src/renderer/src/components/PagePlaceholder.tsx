interface PagePlaceholderProps {
  title: string
  description: string
}

/** Temporary page shell — the frontend agent replaces these with real screens. */
export default function PagePlaceholder({
  title,
  description
}: PagePlaceholderProps): React.JSX.Element {
  return (
    <div className="px-10 py-8">
      <h2 className="text-xl font-semibold tracking-tight text-zinc-100">{title}</h2>
      <p className="mt-1 max-w-xl text-sm text-zinc-400">{description}</p>
      <div className="mt-8 flex h-48 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40">
        <p className="text-sm text-zinc-600">Coming soon</p>
      </div>
    </div>
  )
}
